import { BookDownloadStatus } from "@prisma/client";
import { Readable } from "node:stream";
import { ArtifactStoreError, type ArtifactStore } from "./artifact-store";
import type { DownloadsRepository } from "./downloads.repository";
import {
  DownloadsWorker,
  DownloadsWorkerStartupError,
} from "./downloads.worker";
import {
  TomatoDownloaderClientError,
  type TomatoDownloaderClient,
} from "./runners/fanqie/tomato-downloader/tomato-downloader.client";

const startedAt = new Date("2026-07-26T12:00:00.000Z");

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    bookId: "book-1",
    startChapter: 20,
    endChapter: 30,
    status: BookDownloadStatus.RUNNING,
    downstreamJobId: null,
    progress: {},
    artifactPath: null,
    artifactFilename: null,
    artifactSizeBytes: null,
    artifactSha256: null,
    errorCode: null,
    errorMessage: null,
    createdAt: startedAt,
    startedAt,
    finishedAt: null,
    updatedAt: startedAt,
    book: {
      id: "book-1",
      platform: "fanqie",
      externalBookId: "7069948840148732967",
      createdAt: startedAt,
      updatedAt: startedAt,
    },
    ...overrides,
  };
}

function downstreamJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "42",
    bookId: "7069948840148732967",
    title: "书",
    author: null,
    state: "running",
    message: null,
    progress: null,
    createdAtMs: startedAt.getTime(),
    updatedAtMs: startedAt.getTime(),
    ...overrides,
  };
}

function createSubject(overrides: {
  repository?: Record<string, unknown>;
  client?: Record<string, unknown>;
  artifacts?: Record<string, unknown>;
  sleeper?: { sleep: jest.Mock };
  clock?: { now: jest.Mock };
  now?: Date;
} = {}) {
  const repository = {
    findRecoverable: jest.fn().mockResolvedValue([]),
    claimNextQueued: jest.fn().mockResolvedValue(null),
    findById: jest.fn(),
    setDownstreamJobId: jest.fn(),
    updateProgress: jest.fn(),
    succeed: jest.fn(),
    fail: jest.fn(),
    markCanceled: jest.fn(),
    ...overrides.repository,
  };
  const client = {
    getStatus: jest.fn().mockResolvedValue({
      version: "2.4.13",
      locked: false,
      saveDirectory: "C:/downloads",
    }),
    getConfig: jest.fn().mockResolvedValue({
      useOfficialApi: true,
      novelFormat: "txt",
      bulkFiles: false,
      enableSegmentComments: false,
      enableAudiobook: false,
      autoOpenDownloadedFiles: false,
      askFormatAfterDownload: false,
      preferredBookNameField: "book_name",
      allowOverwriteFiles: true,
    }),
    listJobs: jest.fn().mockResolvedValue([]),
    createJob: jest.fn(),
    getJob: jest.fn(),
    cancelJob: jest.fn(),
    scanLibrary: jest.fn(),
    openArtifact: jest.fn(),
    ...overrides.client,
  };
  const artifacts = {
    validateRoot: jest.fn().mockResolvedValue(undefined),
    store: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
    ...overrides.artifacts,
  };
  const now = overrides.now ?? startedAt;
  const clock = overrides.clock ?? { now: jest.fn(() => now) };
  const sleeper = overrides.sleeper ?? {
    sleep: jest.fn().mockResolvedValue(undefined),
  };
  const worker = new DownloadsWorker(
    repository as unknown as DownloadsRepository,
    client as unknown as TomatoDownloaderClient,
    artifacts as unknown as ArtifactStore,
    clock,
    sleeper,
    { pollIntervalMs: 1_000, taskTimeoutMs: 7_200_000 },
  );
  return { worker, repository, client, artifacts, sleeper };
}

describe("DownloadsWorker", () => {
  it("validates the dedicated v2.4.13 TXT contract at startup", async () => {
    const { worker, client, artifacts } = createSubject();
    await expect(worker.initialize()).resolves.toBeUndefined();
    expect(artifacts.validateRoot).toHaveBeenCalledTimes(1);
    expect(client.getStatus).toHaveBeenCalledTimes(1);
    expect(client.getConfig).toHaveBeenCalledTimes(1);
    expect(client.listJobs).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsupported Downloader version", async () => {
    const { worker } = createSubject({
      client: {
        getStatus: jest.fn().mockResolvedValue({
          version: "2.4.14",
          locked: false,
          saveDirectory: "C:/downloads",
        }),
      },
    });
    await expect(worker.initialize()).rejects.toBeInstanceOf(
      DownloadsWorkerStartupError,
    );
  });

  it("rejects startup when Downloader has an unknown active job", async () => {
    const { worker } = createSubject({
      client: {
        listJobs: jest.fn().mockResolvedValue([
          {
            id: "99",
            bookId: "other",
            title: null,
            author: null,
            state: "running",
            message: null,
            progress: null,
            createdAtMs: 1,
            updatedAtMs: 1,
          },
        ]),
      },
    });
    await expect(worker.initialize()).rejects.toBeInstanceOf(
      DownloadsWorkerStartupError,
    );
  });

  it("marks a recoverable task failed when its downstream job disappeared", async () => {
    const running = task({ downstreamJobId: "42" });
    const fail = jest.fn().mockResolvedValue(task({ status: BookDownloadStatus.FAILED }));
    const { worker } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        fail,
      },
    });

    await worker.initialize();
    expect(fail).toHaveBeenCalledWith(running.id, {
      code: "DOWNSTREAM_TASK_LOST",
      message: "Downloader task was lost",
      finishedAt: startedAt,
    });
  });

  it("marks a recoverable CANCELING task canceled when the sidecar removed its job", async () => {
    const canceling = task({
      status: BookDownloadStatus.CANCELING,
      downstreamJobId: "42",
    });
    const markCanceled = jest.fn();
    const fail = jest.fn();
    const { worker } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([canceling]),
        markCanceled,
        fail,
      },
    });

    await worker.initialize();

    expect(markCanceled).toHaveBeenCalledWith(canceling.id, startedAt);
    expect(fail).not.toHaveBeenCalled();
  });

  it("fails a recoverable task without a downstream job instead of resubmitting it", async () => {
    const running = task();
    const fail = jest
      .fn()
      .mockResolvedValue(task({ status: BookDownloadStatus.FAILED }));
    const { worker, client } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        fail,
      },
    });

    await worker.initialize();

    expect(fail).toHaveBeenCalledWith(running.id, {
      code: "DOWNSTREAM_TASK_LOST",
      message: "Downloader task was lost",
      finishedAt: startedAt,
    });
    expect(client.createJob).not.toHaveBeenCalled();
  });

  it("fails a null-job recovery before rejecting an unowned active downstream job", async () => {
    const running = task();
    const fail = jest.fn();
    const { worker, client } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        fail,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([
          downstreamJob({ id: "orphan", state: "running" }),
        ]),
      },
    });

    await expect(worker.initialize()).rejects.toBeInstanceOf(
      DownloadsWorkerStartupError,
    );

    expect(fail).toHaveBeenCalledWith(running.id, {
      code: "DOWNSTREAM_TASK_LOST",
      message: "Downloader task was lost",
      finishedAt: startedAt,
    });
    expect(client.createJob).not.toHaveBeenCalled();
  });

  it("settles every null-job recovery before rejecting multiple active tasks", async () => {
    const running = task();
    const canceling = task({
      id: "22222222-2222-4222-8222-222222222222",
      status: BookDownloadStatus.CANCELING,
    });
    const fail = jest.fn();
    const markCanceled = jest.fn();
    const { worker, client } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running, canceling]),
        fail,
        markCanceled,
      },
    });

    await expect(worker.initialize()).rejects.toBeInstanceOf(
      DownloadsWorkerStartupError,
    );

    expect(fail).toHaveBeenCalledTimes(1);
    expect(fail).toHaveBeenCalledWith(running.id, {
      code: "DOWNSTREAM_TASK_LOST",
      message: "Downloader task was lost",
      finishedAt: startedAt,
    });
    expect(markCanceled).toHaveBeenCalledWith(canceling.id, startedAt);
    expect(client.createJob).not.toHaveBeenCalled();
  });

  it("claims a range task, creates a downstream job and persists normalized progress", async () => {
    const running = task();
    const withJob = task({ downstreamJobId: "42" });
    const updateProgress = jest.fn().mockResolvedValue(withJob);
    const { worker, client, repository } = createSubject({
      repository: {
        claimNextQueued: jest.fn().mockResolvedValue(running),
        setDownstreamJobId: jest.fn().mockResolvedValue(withJob),
        updateProgress,
      },
      client: {
        createJob: jest.fn().mockResolvedValue({ id: "42" }),
        getJob: jest.fn().mockResolvedValue({
          id: "42",
          bookId: running.book.externalBookId,
          title: "测试小说",
          author: "作者",
          state: "running",
          message: null,
          progress: {
            chapterTotal: 11,
            savedChapters: 3,
            groupTotal: 2,
            groupDone: 1,
            savePhase: "Downloading",
          },
          createdAtMs: startedAt.getTime(),
          updatedAtMs: startedAt.getTime(),
        }),
      },
    });

    await worker.processOnce();
    expect(client.createJob).toHaveBeenCalledWith(running.book.externalBookId, {
      startChapter: 20,
      endChapter: 30,
    });
    expect(repository.setDownstreamJobId).toHaveBeenCalledWith(running.id, "42");
    expect(updateProgress).toHaveBeenCalledWith(running.id, {
      chapterTotal: 11,
      savedChapters: 3,
      groupTotal: 2,
      groupDone: 1,
      savePhase: "Downloading",
    });
  });

  it("copies a completed TXT and marks the task succeeded", async () => {
    const running = task({ downstreamJobId: "42" });
    const succeed = jest.fn();
    const { worker, client, artifacts } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById: jest.fn().mockResolvedValue(running),
        succeed,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([
          {
            id: "42",
            bookId: running.book.externalBookId,
            title: "测试:小说?",
            author: "作者",
            state: "done",
            message: null,
            progress: null,
            createdAtMs: startedAt.getTime(),
            updatedAtMs: startedAt.getTime(),
          },
        ]),
        getJob: jest.fn().mockResolvedValue({
          id: "42",
          bookId: running.book.externalBookId,
          title: "测试:小说?",
          author: "作者",
          state: "done",
          message: null,
          progress: null,
          createdAtMs: startedAt.getTime(),
          updatedAtMs: startedAt.getTime(),
        }),
        scanLibrary: jest.fn().mockResolvedValue({
          running: false,
          items: [
            {
              kind: "file",
              name: "测试：小说？.txt",
              relativePath: "测试小说.txt",
              extension: "txt",
              sizeBytes: 100,
              modifiedAtMs: startedAt.getTime(),
            },
          ],
        }),
        openArtifact: jest.fn().mockResolvedValue({
          stream: Readable.from(["完整正文"]),
          contentType: "text/plain; charset=utf-8",
        }),
      },
      artifacts: {
        store: jest.fn().mockResolvedValue({
          relativePath: `${running.id}.txt`,
          sizeBytes: 12,
          sha256: "abc",
        }),
      },
    });

    await worker.initialize();
    await worker.processOnce();

    expect(client.openArtifact).toHaveBeenCalledWith(
      "测试小说.txt",
      expect.any(AbortSignal),
    );
    expect(artifacts.store).toHaveBeenCalledWith(
      running.id,
      expect.any(Readable),
      "text/plain; charset=utf-8",
      expect.any(AbortSignal),
    );
    expect(succeed).toHaveBeenCalledWith(running.id, {
      artifactPath: `${running.id}.txt`,
      filename: "测试_小说__第20-30章.txt",
      sizeBytes: 12,
      sha256: "abc",
      finishedAt: startedAt,
    });
  });

  it.each(["library scan", "artifact open", "artifact transfer"])(
    "keeps the task active when Downloader disconnects during %s",
    async (stage) => {
      const running = task({ downstreamJobId: "42" });
      const doneJob = downstreamJob({ state: "done" });
      const unavailable = new TomatoDownloaderClientError(
        "UNAVAILABLE",
        "Downloader is unavailable",
      );
      const fail = jest.fn();
      const scanLibrary =
        stage === "library scan"
          ? jest.fn().mockRejectedValue(unavailable)
          : jest.fn().mockResolvedValue({
              running: false,
              items: [
                {
                  kind: "file",
                  name: "书.txt",
                  relativePath: "book.txt",
                  extension: "txt",
                  sizeBytes: 1,
                  modifiedAtMs: startedAt.getTime(),
                },
              ],
            });
      const openArtifact =
        stage === "artifact open"
          ? jest.fn().mockRejectedValue(unavailable)
          : jest.fn().mockResolvedValue({
              stream: Readable.from(["x"]),
              contentType: "text/plain",
            });
      const store =
        stage === "artifact transfer"
          ? jest.fn().mockRejectedValue(
              new ArtifactStoreError(
                "ARTIFACT_STORE_FAILED",
                "Failed to store downloaded artifact",
                { cause: unavailable },
              ),
            )
          : jest.fn();
      const { worker } = createSubject({
        repository: {
          findRecoverable: jest.fn().mockResolvedValue([running]),
          findById: jest.fn().mockResolvedValue(running),
          fail,
        },
        client: {
          listJobs: jest.fn().mockResolvedValue([doneJob]),
          getJob: jest.fn().mockResolvedValue(doneJob),
          scanLibrary,
          openArtifact,
        },
        artifacts: { store },
      });

      await worker.initialize();
      await expect(worker.processOnce()).rejects.toBe(unavailable);

      expect(fail).not.toHaveBeenCalled();
    },
  );

  it("removes an unpublished artifact and retries when success persistence fails", async () => {
    const running = task({ downstreamJobId: "42" });
    const doneJob = downstreamJob({ state: "done" });
    const persistenceError = new Error("database unavailable");
    const findById = jest
      .fn()
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running);
    const fail = jest.fn();
    const deleteArtifact = jest.fn().mockResolvedValue(undefined);
    const { worker } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById,
        succeed: jest.fn().mockRejectedValue(persistenceError),
        fail,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([doneJob]),
        getJob: jest.fn().mockResolvedValue(doneJob),
        scanLibrary: jest.fn().mockResolvedValue({
          running: false,
          items: [
            {
              kind: "file",
              name: "书.txt",
              relativePath: "book.txt",
              extension: "txt",
              sizeBytes: 1,
              modifiedAtMs: startedAt.getTime(),
            },
          ],
        }),
        openArtifact: jest.fn().mockResolvedValue({
          stream: Readable.from(["x"]),
          contentType: "text/plain",
        }),
      },
      artifacts: {
        store: jest.fn().mockResolvedValue({
          relativePath: `${running.id}.txt`,
          sizeBytes: 1,
          sha256: "x",
        }),
        delete: deleteArtifact,
      },
    });

    await worker.initialize();
    await expect(worker.processOnce()).rejects.toBe(persistenceError);

    expect(findById).toHaveBeenCalledTimes(2);
    expect(deleteArtifact).toHaveBeenCalledWith(`${running.id}.txt`);
    expect(fail).not.toHaveBeenCalled();
  });

  it("keeps an artifact when success persistence committed before its response failed", async () => {
    const running = task({ downstreamJobId: "42" });
    const doneJob = downstreamJob({ state: "done" });
    const succeeded = task({
      status: BookDownloadStatus.SUCCEEDED,
      downstreamJobId: "42",
      artifactPath: `${running.id}.txt`,
      artifactFilename: "书_第20-30章.txt",
      artifactSizeBytes: 1,
      artifactSha256: "x",
      finishedAt: startedAt,
    });
    const persistenceError = new Error("database response lost");
    const findById = jest
      .fn()
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(succeeded);
    const fail = jest.fn();
    const deleteArtifact = jest.fn().mockResolvedValue(undefined);
    const { worker } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById,
        succeed: jest.fn().mockRejectedValue(persistenceError),
        fail,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([doneJob]),
        getJob: jest.fn().mockResolvedValue(doneJob),
        scanLibrary: jest.fn().mockResolvedValue({
          running: false,
          items: [
            {
              kind: "file",
              name: "书.txt",
              relativePath: "book.txt",
              extension: "txt",
              sizeBytes: 1,
              modifiedAtMs: startedAt.getTime(),
            },
          ],
        }),
        openArtifact: jest.fn().mockResolvedValue({
          stream: Readable.from(["x"]),
          contentType: "text/plain",
        }),
      },
      artifacts: {
        store: jest.fn().mockResolvedValue({
          relativePath: `${running.id}.txt`,
          sizeBytes: 1,
          sha256: "x",
        }),
        delete: deleteArtifact,
      },
    });

    await worker.initialize();
    await expect(worker.processOnce()).resolves.toBeUndefined();

    expect(findById).toHaveBeenCalledTimes(2);
    expect(deleteArtifact).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it("preserves an ambiguous artifact until a later read confirms publication", async () => {
    const running = task({ downstreamJobId: "42" });
    const doneJob = downstreamJob({ state: "done" });
    const succeeded = task({
      status: BookDownloadStatus.SUCCEEDED,
      downstreamJobId: "42",
      artifactPath: `${running.id}.txt`,
      artifactFilename: "书_第20-30章.txt",
      artifactSizeBytes: 1,
      artifactSha256: "x",
      finishedAt: startedAt,
    });
    const persistenceError = new Error("database response lost");
    const readbackError = new Error("database still unavailable");
    const findById = jest
      .fn()
      .mockResolvedValueOnce(running)
      .mockRejectedValueOnce(readbackError)
      .mockResolvedValueOnce(succeeded);
    const fail = jest.fn();
    const deleteArtifact = jest.fn().mockResolvedValue(undefined);
    const getJob = jest.fn().mockResolvedValue(doneJob);
    const { worker } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById,
        succeed: jest.fn().mockRejectedValue(persistenceError),
        fail,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([doneJob]),
        getJob,
        scanLibrary: jest.fn().mockResolvedValue({
          running: false,
          items: [
            {
              kind: "file",
              name: "书.txt",
              relativePath: "book.txt",
              extension: "txt",
              sizeBytes: 1,
              modifiedAtMs: startedAt.getTime(),
            },
          ],
        }),
        openArtifact: jest.fn().mockResolvedValue({
          stream: Readable.from(["x"]),
          contentType: "text/plain",
        }),
      },
      artifacts: {
        store: jest.fn().mockResolvedValue({
          relativePath: `${running.id}.txt`,
          sizeBytes: 1,
          sha256: "x",
        }),
        delete: deleteArtifact,
      },
    });

    await worker.initialize();
    await expect(worker.processOnce()).rejects.toBe(persistenceError);
    await expect(worker.processOnce()).resolves.toBeUndefined();

    expect(findById).toHaveBeenCalledTimes(3);
    expect(getJob).toHaveBeenCalledTimes(1);
    expect(deleteArtifact).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it("removes an unpublished artifact when the success update loses its state race", async () => {
    const running = task({ downstreamJobId: "42" });
    const doneJob = downstreamJob({ state: "done" });
    const canceled = task({
      status: BookDownloadStatus.CANCELED,
      downstreamJobId: "42",
      finishedAt: startedAt,
    });
    const findById = jest
      .fn()
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(canceled);
    const fail = jest.fn();
    const deleteArtifact = jest.fn().mockResolvedValue(undefined);
    const { worker } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById,
        succeed: jest.fn().mockResolvedValue(null),
        fail,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([doneJob]),
        getJob: jest.fn().mockResolvedValue(doneJob),
        scanLibrary: jest.fn().mockResolvedValue({
          running: false,
          items: [
            {
              kind: "file",
              name: "书.txt",
              relativePath: "book.txt",
              extension: "txt",
              sizeBytes: 1,
              modifiedAtMs: startedAt.getTime(),
            },
          ],
        }),
        openArtifact: jest.fn().mockResolvedValue({
          stream: Readable.from(["x"]),
          contentType: "text/plain",
        }),
      },
      artifacts: {
        store: jest.fn().mockResolvedValue({
          relativePath: `${running.id}.txt`,
          sizeBytes: 1,
          sha256: "x",
        }),
        delete: deleteArtifact,
      },
    });

    await worker.initialize();
    await expect(worker.processOnce()).resolves.toBeUndefined();

    expect(findById).toHaveBeenCalledTimes(2);
    expect(deleteArtifact).toHaveBeenCalledWith(`${running.id}.txt`);
    expect(fail).not.toHaveBeenCalled();
  });

  it("marks a downstream canceled task canceled", async () => {
    const running = task({ downstreamJobId: "42" });
    const markCanceled = jest.fn();
    const { worker } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById: jest.fn().mockResolvedValue(running),
        markCanceled,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([
          {
            id: "42",
            bookId: running.book.externalBookId,
            title: "????",
            author: null,
            state: "canceled",
            message: null,
            progress: null,
            createdAtMs: startedAt.getTime(),
            updatedAtMs: startedAt.getTime(),
          },
        ]),
        getJob: jest.fn().mockResolvedValue({
          id: "42",
          bookId: running.book.externalBookId,
          title: "????",
          author: null,
          state: "canceled",
          message: null,
          progress: null,
          createdAtMs: startedAt.getTime(),
          updatedAtMs: startedAt.getTime(),
        }),
      },
    });
    await worker.initialize();
    await worker.processOnce();
    expect(markCanceled).toHaveBeenCalledWith(running.id, startedAt);
  });

  it("pauses the queue with a one-second backoff when Downloader disconnects", async () => {
    const running = task();
    let releaseSleep!: () => void;
    const sleepStarted = new Promise<void>((resolve) => {
      releaseSleep = resolve;
    });
    const sleeper = {
      sleep: jest.fn().mockImplementation(
        () => new Promise<void>((resolve) => {
          releaseSleep = () => { resolve(); };
          sleepStarted.then(() => undefined);
        }),
      ),
    };
    const repository = {
      findRecoverable: jest.fn().mockResolvedValue([]),
      claimNextQueued: jest.fn().mockResolvedValue(running),
      findById: jest.fn(),
    };
    const client = {
      getStatus: jest.fn().mockResolvedValue({
        version: "2.4.13",
        locked: false,
        saveDirectory: "C:/downloads",
      }),
      getConfig: jest.fn().mockResolvedValue({
        useOfficialApi: true,
        novelFormat: "txt",
        bulkFiles: false,
        enableSegmentComments: false,
        enableAudiobook: false,
        autoOpenDownloadedFiles: false,
        askFormatAfterDownload: false,
        preferredBookNameField: "book_name",
        allowOverwriteFiles: true,
      }),
      listJobs: jest.fn().mockResolvedValue([]),
      createJob: jest.fn().mockRejectedValue(
        new TomatoDownloaderClientError("UNAVAILABLE", "unavailable"),
      ),
    };
    const artifacts = { validateRoot: jest.fn().mockResolvedValue(undefined) };
    const worker = new DownloadsWorker(
      repository as unknown as DownloadsRepository,
      client as unknown as TomatoDownloaderClient,
      artifacts as unknown as ArtifactStore,
      { now: () => startedAt },
      sleeper,
      { pollIntervalMs: 500, taskTimeoutMs: 7_200_000 },
    );

    await worker.onApplicationBootstrap();
    while (sleeper.sleep.mock.calls.length === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const closing = worker.onModuleDestroy();
    releaseSleep();
    await closing;
    expect(sleeper.sleep).toHaveBeenCalledWith(
      1_000,
      expect.any(AbortSignal),
    );
  });

  it("backs off for 1, 2, 4, 8, 16 and at most 30 seconds while unavailable", async () => {
    const running = task();
    const releases: Array<() => void> = [];
    const sleeper = {
      sleep: jest.fn((_: number, signal?: AbortSignal) => {
        return new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(new Error("sleep aborted"));
          signal?.addEventListener("abort", onAbort, { once: true });
          releases.push(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          });
        });
      }),
    };
    const { worker } = createSubject({
      sleeper,
      repository: {
        claimNextQueued: jest.fn().mockResolvedValue(running),
        findById: jest.fn().mockResolvedValue(running),
      },
      client: {
        createJob: jest.fn().mockRejectedValue(
          new TomatoDownloaderClientError("UNAVAILABLE", "unavailable"),
        ),
      },
    });
    const expectedDelays = [
      1_000,
      2_000,
      4_000,
      8_000,
      16_000,
      30_000,
      30_000,
    ];

    await worker.onApplicationBootstrap();
    for (let index = 0; index < expectedDelays.length; index += 1) {
      for (let attempt = 0; sleeper.sleep.mock.calls.length <= index; attempt += 1) {
        if (attempt === 50) throw new Error("Worker did not enter backoff sleep");
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (index < expectedDelays.length - 1) releases[index]!();
    }

    expect(sleeper.sleep.mock.calls.map(([delay]) => delay)).toEqual(
      expectedDelays,
    );
    await expect(worker.onModuleDestroy()).resolves.toBeUndefined();
  });

  it("creates a whole-book downstream job with a null range", async () => {
    const running = task({ startChapter: null, endChapter: null });
    const withJob = task({
      startChapter: null,
      endChapter: null,
      downstreamJobId: "42",
    });
    const { worker, client } = createSubject({
      repository: {
        claimNextQueued: jest.fn().mockResolvedValue(running),
        setDownstreamJobId: jest.fn().mockResolvedValue(withJob),
      },
      client: {
        createJob: jest.fn().mockResolvedValue({ id: "42" }),
        getJob: jest.fn().mockResolvedValue(downstreamJob({ state: "queued" })),
      },
    });

    await worker.processOnce();

    expect(client.createJob).toHaveBeenCalledWith(
      running.book.externalBookId,
      null,
    );
  });

  it("maps a failed downstream job to DOWNLOADER_REJECTED", async () => {
    const running = task({ downstreamJobId: "42" });
    const failedJob = downstreamJob({ state: "failed" });
    const fail = jest.fn();
    const { worker } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById: jest.fn().mockResolvedValue(running),
        fail,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([failedJob]),
        getJob: jest.fn().mockResolvedValue(failedJob),
      },
    });

    await worker.initialize();
    await worker.processOnce();

    expect(fail).toHaveBeenCalledWith(running.id, {
      code: "DOWNLOADER_REJECTED",
      message: "Downloader rejected the task",
      finishedAt: startedAt,
    });
  });

  it("reconciles an accepted job after the create response is lost without resubmitting", async () => {
    const running = task();
    const withJob = task({ downstreamJobId: "42" });
    const activeJob = downstreamJob({
      bookId: running.book.externalBookId,
      state: "running",
    });
    const unavailable = new TomatoDownloaderClientError(
      "UNAVAILABLE",
      "unavailable",
    );
    const createJob = jest.fn().mockRejectedValueOnce(unavailable);
    const setDownstreamJobId = jest.fn().mockResolvedValue(withJob);
    const { worker } = createSubject({
      repository: {
        claimNextQueued: jest.fn().mockResolvedValue(running),
        findById: jest.fn().mockResolvedValue(running),
        setDownstreamJobId,
      },
      client: {
        createJob,
        listJobs: jest.fn().mockResolvedValue([activeJob]),
        getJob: jest.fn().mockResolvedValue(activeJob),
      },
    });

    await expect(worker.processOnce()).rejects.toBe(unavailable);
    await worker.processOnce();

    expect(createJob).toHaveBeenCalledTimes(1);
    expect(setDownstreamJobId).toHaveBeenCalledWith(running.id, "42");
  });

  it("reconciles an accepted job when persisting its id fails without resubmitting", async () => {
    const running = task();
    const withJob = task({ downstreamJobId: "42" });
    const activeJob = downstreamJob({
      bookId: running.book.externalBookId,
      state: "running",
    });
    const persistenceError = new Error("database unavailable");
    const createJob = jest.fn().mockResolvedValue({ id: "42" });
    const setDownstreamJobId = jest
      .fn()
      .mockRejectedValueOnce(persistenceError)
      .mockResolvedValueOnce(withJob);
    const { worker } = createSubject({
      repository: {
        claimNextQueued: jest.fn().mockResolvedValue(running),
        findById: jest.fn().mockResolvedValue(running),
        setDownstreamJobId,
      },
      client: {
        createJob,
        listJobs: jest.fn().mockResolvedValue([activeJob]),
        getJob: jest.fn().mockResolvedValue(activeJob),
      },
    });

    await expect(worker.processOnce()).rejects.toBe(persistenceError);
    await worker.processOnce();

    expect(createJob).toHaveBeenCalledTimes(1);
    expect(setDownstreamJobId).toHaveBeenCalledTimes(2);
    expect(setDownstreamJobId).toHaveBeenLastCalledWith(running.id, "42");
  });

  it("completes a CANCELING task when the downstream job won the race and finished", async () => {
    const canceling = task({
      status: BookDownloadStatus.CANCELING,
      downstreamJobId: "42",
    });
    const doneJob = downstreamJob({ state: "done" });
    const succeed = jest.fn();
    const cancelJob = jest.fn().mockResolvedValue(undefined);
    const { worker } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([canceling]),
        findById: jest.fn().mockResolvedValue(canceling),
        succeed,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([doneJob]),
        cancelJob,
        getJob: jest.fn().mockResolvedValue(doneJob),
        scanLibrary: jest.fn().mockResolvedValue({
          running: false,
          items: [
            {
              kind: "file",
              name: "书.txt",
              relativePath: "book.txt",
              extension: "txt",
              sizeBytes: 1,
              modifiedAtMs: startedAt.getTime(),
            },
          ],
        }),
        openArtifact: jest.fn().mockResolvedValue({
          stream: Readable.from(["x"]),
          contentType: "text/plain",
        }),
      },
      artifacts: {
        store: jest.fn().mockResolvedValue({
          relativePath: `${canceling.id}.txt`,
          sizeBytes: 1,
          sha256: "x",
        }),
      },
    });

    await worker.initialize();
    await worker.processOnce();

    expect(cancelJob).toHaveBeenCalledWith("42");
    expect(succeed).toHaveBeenCalledWith(
      canceling.id,
      expect.objectContaining({ artifactPath: `${canceling.id}.txt` }),
    );
  });

  it("marks a CANCELING task canceled when cancel removes it from the sidecar job store", async () => {
    const canceling = task({
      status: BookDownloadStatus.CANCELING,
      downstreamJobId: "42",
    });
    const activeJob = downstreamJob({ state: "running" });
    const markCanceled = jest.fn();
    const fail = jest.fn();
    const { worker } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([canceling]),
        findById: jest.fn().mockResolvedValue(canceling),
        markCanceled,
        fail,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([activeJob]),
        cancelJob: jest.fn().mockResolvedValue(undefined),
        getJob: jest.fn().mockResolvedValue(null),
      },
    });

    await worker.initialize();
    await worker.processOnce();

    expect(markCanceled).toHaveBeenCalledWith(canceling.id, startedAt);
    expect(fail).not.toHaveBeenCalled();
  });

  it.each([
    {
      caseName: "multiple matching candidates",
      items: [
        {
          kind: "file",
          name: "书.txt",
          relativePath: "a.txt",
          extension: "txt",
          sizeBytes: 1,
          modifiedAtMs: startedAt.getTime(),
        },
        {
          kind: "file",
          name: "书.txt",
          relativePath: "b.txt",
          extension: "txt",
          sizeBytes: 1,
          modifiedAtMs: startedAt.getTime(),
        },
      ],
    },
    {
      caseName: "only a stale candidate",
      items: [
        {
          kind: "file",
          name: "书.txt",
          relativePath: "old.txt",
          extension: "txt",
          sizeBytes: 1,
          modifiedAtMs: startedAt.getTime() - 5_001,
        },
      ],
    },
    {
      caseName: "only a nested candidate",
      items: [
        {
          kind: "file",
          name: "书.txt",
          relativePath: "nested/书.txt",
          extension: "txt",
          sizeBytes: 1,
          modifiedAtMs: startedAt.getTime(),
        },
      ],
    },
  ])("fails with ARTIFACT_NOT_FOUND for $caseName", async ({ items }) => {
    const running = task({ downstreamJobId: "42" });
    const doneJob = downstreamJob({ state: "done" });
    const fail = jest.fn();
    const { worker, client } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById: jest.fn().mockResolvedValue(running),
        fail,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([doneJob]),
        getJob: jest.fn().mockResolvedValue(doneJob),
        scanLibrary: jest.fn().mockResolvedValue({ running: false, items }),
      },
    });

    await worker.initialize();
    await worker.processOnce();

    expect(fail).toHaveBeenCalledWith(running.id, {
      code: "ARTIFACT_NOT_FOUND",
      message: "Downloader artifact was not found",
      finishedAt: startedAt,
    });
    expect(client.openArtifact).not.toHaveBeenCalled();
  });

  it("maps a missing artifact downloader 404 to ARTIFACT_NOT_FOUND", async () => {
    const running = task({ downstreamJobId: "42" });
    const doneJob = downstreamJob({ state: "done" });
    const fail = jest.fn();
    const { worker } = createSubject({
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById: jest.fn().mockResolvedValue(running),
        fail,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([doneJob]),
        getJob: jest.fn().mockResolvedValue(doneJob),
        scanLibrary: jest.fn().mockResolvedValue({
          running: false,
          items: [
            {
              kind: "file",
              name: "书.txt",
              relativePath: "book.txt",
              extension: "txt",
              sizeBytes: 1,
              modifiedAtMs: startedAt.getTime(),
            },
          ],
        }),
        openArtifact: jest.fn().mockRejectedValue(
          new TomatoDownloaderClientError(
            "NOT_FOUND",
            "Downloader artifact was not found",
          ),
        ),
      },
    });

    await worker.initialize();
    await worker.processOnce();

    expect(fail).toHaveBeenCalledWith(running.id, {
      code: "ARTIFACT_NOT_FOUND",
      message: "Downloader artifact was not found",
      finishedAt: startedAt,
    });
  });

  it("interrupts the current sleep during shutdown without canceling the downstream job", async () => {
    let releaseSleep!: () => void;
    let sleepStarted!: () => void;
    const startedSleeping = new Promise<void>((resolve) => {
      sleepStarted = resolve;
    });
    const sleeper = {
      sleep: jest.fn(
        (_milliseconds: number, signal?: AbortSignal) =>
          new Promise<void>((resolve, reject) => {
            releaseSleep = resolve;
            signal?.addEventListener(
              "abort",
              () => reject(new Error("sleep aborted")),
              { once: true },
            );
            sleepStarted();
          }),
      ),
    };
    const { worker, client } = createSubject({ sleeper });

    await worker.onApplicationBootstrap();
    await startedSleeping;
    let closed = false;
    let closeError: unknown;
    const closing = worker.onModuleDestroy().then(
      () => {
        closed = true;
      },
      (error: unknown) => {
        closeError = error;
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    const closedWithoutRelease = closed;
    releaseSleep();
    await closing;

    expect(closedWithoutRelease).toBe(true);
    expect(closeError).toBeUndefined();
    expect(client.cancelJob).not.toHaveBeenCalled();
  });

  it("stops an artifact library scan after interrupting its sleep", async () => {
    const running = task({ downstreamJobId: "42" });
    const doneJob = downstreamJob({ state: "done" });
    let sleepStarted!: () => void;
    const startedSleeping = new Promise<void>((resolve) => {
      sleepStarted = resolve;
    });
    const sleeper = {
      sleep: jest.fn(
        (_milliseconds: number, signal?: AbortSignal) =>
          new Promise<void>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new Error("sleep aborted")),
              { once: true },
            );
            sleepStarted();
          }),
      ),
    };
    const scanLibrary = jest
      .fn()
      .mockResolvedValueOnce({ running: true, items: [] })
      .mockResolvedValue({ running: false, items: [] });
    const fail = jest.fn();
    const { worker, client } = createSubject({
      sleeper,
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById: jest.fn().mockResolvedValue(running),
        fail,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([doneJob]),
        getJob: jest.fn().mockResolvedValue(doneJob),
        scanLibrary,
      },
    });

    await worker.onApplicationBootstrap();
    await startedSleeping;
    await worker.onModuleDestroy();

    expect(scanLibrary).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
    expect(client.cancelJob).not.toHaveBeenCalled();
  });

  it("enforces the task deadline while the artifact library scan is still running", async () => {
    const running = task({ downstreamJobId: "42" });
    const doneJob = downstreamJob({ state: "done" });
    const timedOut = new Date(startedAt.getTime() + 7_200_001);
    const clock = {
      now: jest.fn().mockReturnValueOnce(startedAt).mockReturnValue(timedOut),
    };
    const fail = jest.fn();
    const cancelJob = jest.fn().mockResolvedValue(undefined);
    const { worker } = createSubject({
      clock,
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById: jest.fn().mockResolvedValue(running),
        fail,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([doneJob]),
        getJob: jest.fn().mockResolvedValue(doneJob),
        cancelJob,
        scanLibrary: jest
          .fn()
          .mockResolvedValueOnce({ running: true, items: [] })
          .mockResolvedValue({ running: false, items: [] }),
      },
    });

    await worker.initialize();
    await worker.processOnce();

    expect(cancelJob).toHaveBeenCalledWith("42");
    expect(fail).toHaveBeenCalledWith(running.id, {
      code: "DOWNLOAD_TIMEOUT",
      message: "Download task timed out",
      finishedAt: timedOut,
    });
  });

  it("does not publish an artifact when the task deadline expires during transfer", async () => {
    const running = task({ downstreamJobId: "42" });
    const doneJob = downstreamJob({ state: "done" });
    const timedOut = new Date(startedAt.getTime() + 7_200_001);
    let currentTime = startedAt;
    const clock = { now: jest.fn(() => currentTime) };
    const fail = jest.fn();
    const succeed = jest.fn();
    const deleteArtifact = jest.fn().mockResolvedValue(undefined);
    const store = jest.fn(
      async (
        _taskId: string,
        _stream: Readable,
        _contentType: string,
        signal?: AbortSignal,
      ) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal?.aborted).toBe(false);
        currentTime = timedOut;
        return {
          relativePath: `${running.id}.txt`,
          sizeBytes: 1,
          sha256: "x",
        };
      },
    );
    const { worker } = createSubject({
      clock,
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById: jest.fn().mockResolvedValue(running),
        fail,
        succeed,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([doneJob]),
        getJob: jest.fn().mockResolvedValue(doneJob),
        cancelJob: jest.fn().mockResolvedValue(undefined),
        scanLibrary: jest.fn().mockResolvedValue({
          running: false,
          items: [
            {
              kind: "file",
              name: "书.txt",
              relativePath: "book.txt",
              extension: "txt",
              sizeBytes: 1,
              modifiedAtMs: startedAt.getTime(),
            },
          ],
        }),
        openArtifact: jest.fn().mockResolvedValue({
          stream: Readable.from(["x"]),
          contentType: "text/plain",
        }),
      },
      artifacts: { store, delete: deleteArtifact },
    });

    await worker.initialize();
    await worker.processOnce();

    expect(succeed).not.toHaveBeenCalled();
    expect(deleteArtifact).toHaveBeenCalledWith(`${running.id}.txt`);
    expect(fail).toHaveBeenCalledWith(running.id, {
      code: "DOWNLOAD_TIMEOUT",
      message: "Download task timed out",
      finishedAt: timedOut,
    });
  });

  it("cancels and fails a task after the two-hour timeout", async () => {
    const running = task({ downstreamJobId: "42" });
    const timedOut = new Date(startedAt.getTime() + 7_200_001);
    const fail = jest.fn();
    const cancelJob = jest.fn().mockResolvedValue(undefined);
    const { worker } = createSubject({
      now: timedOut,
      repository: {
        findRecoverable: jest.fn().mockResolvedValue([running]),
        findById: jest.fn().mockResolvedValue(running),
        fail,
      },
      client: {
        listJobs: jest.fn().mockResolvedValue([
          {
            id: "42",
            bookId: running.book.externalBookId,
            title: "测试小说",
            author: null,
            state: "running",
            message: null,
            progress: null,
            createdAtMs: startedAt.getTime(),
            updatedAtMs: startedAt.getTime(),
          },
        ]),
        cancelJob,
      },
    });

    await worker.initialize();
    await worker.processOnce();
    expect(cancelJob).toHaveBeenCalledWith("42");
    expect(fail).toHaveBeenCalledWith(running.id, {
      code: "DOWNLOAD_TIMEOUT",
      message: "Download task timed out",
      finishedAt: timedOut,
    });
  });
});
