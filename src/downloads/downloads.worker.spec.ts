import { BookDownloadStatus } from "@prisma/client";
import { Readable } from "node:stream";
import type { ArtifactStore } from "./artifact-store";
import type { DownloadsRepository } from "./downloads.repository";
import {
  DownloadsWorker,
  DownloadsWorkerStartupError,
} from "./downloads.worker";
import {
  TomatoDownloaderClientError,
  type TomatoDownloaderClient,
} from "./tomato-downloader/tomato-downloader.client";

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

function createSubject(overrides: {
  repository?: Record<string, unknown>;
  client?: Record<string, unknown>;
  artifacts?: Record<string, unknown>;
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
    ...overrides.artifacts,
  };
  const now = overrides.now ?? startedAt;
  const sleeper = { sleep: jest.fn().mockResolvedValue(undefined) };
  const worker = new DownloadsWorker(
    repository as unknown as DownloadsRepository,
    client as unknown as TomatoDownloaderClient,
    artifacts as unknown as ArtifactStore,
    { now: () => now },
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

    expect(client.openArtifact).toHaveBeenCalledWith("测试小说.txt");
    expect(artifacts.store).toHaveBeenCalledWith(
      running.id,
      expect.any(Readable),
      "text/plain; charset=utf-8",
    );
    expect(succeed).toHaveBeenCalledWith(running.id, {
      artifactPath: `${running.id}.txt`,
      filename: "测试_小说__第20-30章.txt",
      sizeBytes: 12,
      sha256: "abc",
      finishedAt: startedAt,
    });
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
    expect(sleeper.sleep).toHaveBeenCalledWith(1_000);
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


