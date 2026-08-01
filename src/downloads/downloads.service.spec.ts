import { BookDownloadStatus } from "@prisma/client";
import { Readable } from "node:stream";
import type { ArtifactStore } from "./artifact-store";
import type { DownloadsRepository } from "./downloads.repository";
import {
  DownloadArtifactGoneError,
  DownloadConflictError,
  DownloadNotFoundError,
  DownloadsService,
} from "./downloads.service";
import type { TomatoDownloaderClient } from "./runners/fanqie/tomato-downloader/tomato-downloader.client";

const now = new Date("2026-07-26T12:00:00.000Z");

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    bookId: "book-1",
    startChapter: null,
    endChapter: null,
    status: BookDownloadStatus.QUEUED,
    downstreamJobId: null,
    progress: {},
    artifactPath: null,
    artifactFilename: null,
    artifactSizeBytes: null,
    artifactSha256: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
    book: {
      id: "book-1",
      platform: "fanqie",
      externalBookId: "7069948840148732967",
      createdAt: now,
      updatedAt: now,
    },
    ...overrides,
  };
}

function createSubject(overrides: {
  repository?: Partial<DownloadsRepository>;
  client?: Partial<TomatoDownloaderClient>;
  artifacts?: Partial<ArtifactStore>;
} = {}) {
  const repository = {
    createQueued: jest.fn(),
    findById: jest.fn(),
    cancelQueued: jest.fn(),
    markCanceling: jest.fn(),
    deleteTerminal: jest.fn(),
    ...overrides.repository,
  };
  const client = { cancelJob: jest.fn(), ...overrides.client };
  const artifacts = {
    open: jest.fn(),
    delete: jest.fn(),
    ...overrides.artifacts,
  };
  return {
    service: new DownloadsService(
      repository as unknown as DownloadsRepository,
      client as unknown as TomatoDownloaderClient,
      artifacts as unknown as ArtifactStore,
      { now: () => now },
    ),
    repository,
    client,
    artifacts,
  };
}

describe("DownloadsService", () => {
  it("creates and maps an independent queued range task", async () => {
    const stored = task({ startChapter: 20, endChapter: 30 });
    const { service, repository } = createSubject({
      repository: { createQueued: jest.fn().mockResolvedValue(stored) },
    });

    await expect(
      service.create("7069948840148732967", {
        startChapter: 20,
        endChapter: 30,
      }),
    ).resolves.toMatchObject({
      id: stored.id,
      platform: "fanqie",
      externalBookId: "7069948840148732967",
      format: "txt",
      range: { startChapter: 20, endChapter: 30 },
      status: "queued",
      artifact: null,
      error: null,
    });
    expect(repository.createQueued).toHaveBeenCalledWith(
      "7069948840148732967",
      { startChapter: 20, endChapter: 30 },
    );
  });

  it("throws a stable not-found error", async () => {
    const { service } = createSubject({
      repository: { findById: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.get("missing")).rejects.toBeInstanceOf(
      DownloadNotFoundError,
    );
  });

  it("cancels a queued task atomically", async () => {
    const canceled = task({ status: BookDownloadStatus.CANCELED, finishedAt: now });
    const { service, repository, client } = createSubject({
      repository: {
        findById: jest.fn().mockResolvedValue(task()),
        cancelQueued: jest.fn().mockResolvedValue(canceled),
      },
    });

    await expect(service.cancel(task().id)).resolves.toMatchObject({
      status: "canceled",
    });
    expect(repository.cancelQueued).toHaveBeenCalledWith(task().id, now);
    expect(client.cancelJob).not.toHaveBeenCalled();
  });

  it("marks a running task canceling before calling Downloader", async () => {
    const running = task({
      status: BookDownloadStatus.RUNNING,
      downstreamJobId: "42",
      startedAt: now,
    });
    const canceling = task({
      ...running,
      status: BookDownloadStatus.CANCELING,
    });
    const { service, repository, client } = createSubject({
      repository: {
        findById: jest.fn().mockResolvedValue(running),
        markCanceling: jest.fn().mockResolvedValue(canceling),
      },
    });

    await expect(service.cancel(running.id)).resolves.toMatchObject({
      status: "canceling",
    });
    expect(repository.markCanceling).toHaveBeenCalledWith(running.id);
    expect(client.cancelJob).toHaveBeenCalledWith("42");
  });

  it("rejects canceling a terminal task", async () => {
    const { service } = createSubject({
      repository: {
        findById: jest
          .fn()
          .mockResolvedValue(task({ status: BookDownloadStatus.SUCCEEDED })),
      },
    });
    await expect(service.cancel(task().id)).rejects.toBeInstanceOf(
      DownloadConflictError,
    );
  });

  it("opens a successful artifact with its download filename", async () => {
    const stream = Readable.from(["正文"]);
    const succeeded = task({
      status: BookDownloadStatus.SUCCEEDED,
      artifactPath: `${task().id}.txt`,
      artifactFilename: "测试小说.txt",
      artifactSizeBytes: 6,
      artifactSha256: "abc",
      finishedAt: now,
    });
    const { service, artifacts } = createSubject({
      repository: { findById: jest.fn().mockResolvedValue(succeeded) },
      artifacts: { open: jest.fn().mockResolvedValue(stream) },
    });

    await expect(service.openFile(succeeded.id)).resolves.toEqual({
      stream,
      filename: "测试小说.txt",
      sizeBytes: 6,
    });
    expect(artifacts.open).toHaveBeenCalledWith(`${task().id}.txt`);
  });

  it("reports a gone artifact when a successful record has no file", async () => {
    const succeeded = task({
      status: BookDownloadStatus.SUCCEEDED,
      artifactPath: `${task().id}.txt`,
      artifactFilename: "测试小说.txt",
    });
    const { service } = createSubject({
      repository: { findById: jest.fn().mockResolvedValue(succeeded) },
      artifacts: { open: jest.fn().mockRejectedValue(new Error("missing")) },
    });
    await expect(service.openFile(succeeded.id)).rejects.toBeInstanceOf(
      DownloadArtifactGoneError,
    );
  });

  it("deletes a terminal artifact and record", async () => {
    const succeeded = task({
      status: BookDownloadStatus.SUCCEEDED,
      artifactPath: `${task().id}.txt`,
    });
    const { service, artifacts, repository } = createSubject({
      repository: {
        findById: jest.fn().mockResolvedValue(succeeded),
        deleteTerminal: jest.fn().mockResolvedValue(true),
      },
    });

    await expect(service.delete(succeeded.id)).resolves.toBeUndefined();
    expect(artifacts.delete).toHaveBeenCalledWith(`${task().id}.txt`);
    expect(repository.deleteTerminal).toHaveBeenCalledWith(succeeded.id);
  });
});
