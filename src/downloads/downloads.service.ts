import { Injectable } from "@nestjs/common";
import { BookDownloadStatus } from "@prisma/client";
import type { ArtifactStore } from "./artifact-store";
import type {
  DownloadResource,
  DownloadsClock,
  OpenDownloadFile,
} from "./interfaces/download.interface";
import {
  DownloadsRepository,
  type StoredBookDownload,
} from "./downloads.repository";
import type { TomatoDownloaderClient } from "./tomato-downloader/tomato-downloader.client";
import type { ChapterRange } from "./tomato-downloader/tomato-downloader.contract";

export class DownloadNotFoundError extends Error {
  override readonly name = "DownloadNotFoundError";
  constructor() {
    super("Download task was not found");
  }
}

export class DownloadConflictError extends Error {
  override readonly name = "DownloadConflictError";
  constructor() {
    super("Download task state does not allow this operation");
  }
}

export class DownloadArtifactGoneError extends Error {
  override readonly name = "DownloadArtifactGoneError";
  constructor() {
    super("Downloaded artifact is no longer available");
  }
}

@Injectable()
export class DownloadsService {
  constructor(
    private readonly repository: DownloadsRepository,
    private readonly client: TomatoDownloaderClient,
    private readonly artifacts: ArtifactStore,
    private readonly clock: DownloadsClock,
  ) {}

  async create(
    externalBookId: string,
    range: Partial<ChapterRange>,
  ): Promise<DownloadResource> {
    const normalizedRange =
      range.startChapter !== undefined && range.endChapter !== undefined
        ? {
            startChapter: range.startChapter,
            endChapter: range.endChapter,
          }
        : null;
    return this.toResource(
      await this.repository.createQueued(externalBookId, normalizedRange),
    );
  }

  async get(id: string): Promise<DownloadResource> {
    return this.toResource(await this.requireTask(id));
  }

  async cancel(id: string): Promise<DownloadResource> {
    const task = await this.requireTask(id);
    if (task.status === BookDownloadStatus.QUEUED) {
      const canceled = await this.repository.cancelQueued(id, this.clock.now());
      if (canceled === null) throw new DownloadConflictError();
      return this.toResource(canceled);
    }
    if (task.status === BookDownloadStatus.CANCELING) {
      return this.toResource(task);
    }
    if (task.status !== BookDownloadStatus.RUNNING) {
      throw new DownloadConflictError();
    }
    const canceling = await this.repository.markCanceling(id);
    if (canceling === null) throw new DownloadConflictError();
    if (task.downstreamJobId !== null) {
      await Promise.resolve(this.client.cancelJob(task.downstreamJobId)).catch(
        () => undefined,
      );
    }
    return this.toResource(canceling);
  }

  async openFile(id: string): Promise<OpenDownloadFile> {
    const task = await this.requireTask(id);
    if (task.status !== BookDownloadStatus.SUCCEEDED) {
      throw new DownloadConflictError();
    }
    if (
      task.artifactPath === null ||
      task.artifactFilename === null ||
      task.artifactSizeBytes === null
    ) {
      throw new DownloadArtifactGoneError();
    }
    try {
      return {
        stream: await this.artifacts.open(task.artifactPath),
        filename: task.artifactFilename,
        sizeBytes: task.artifactSizeBytes,
      };
    } catch {
      throw new DownloadArtifactGoneError();
    }
  }

  async delete(id: string): Promise<void> {
    const task = await this.requireTask(id);
    if (
      task.status !== BookDownloadStatus.SUCCEEDED &&
      task.status !== BookDownloadStatus.FAILED &&
      task.status !== BookDownloadStatus.CANCELED
    ) {
      throw new DownloadConflictError();
    }
    if (task.artifactPath !== null) {
      await this.artifacts.delete(task.artifactPath);
    }
    if (!(await this.repository.deleteTerminal(id))) {
      throw new DownloadConflictError();
    }
  }

  private async requireTask(id: string): Promise<StoredBookDownload> {
    const task = await this.repository.findById(id);
    if (task === null) throw new DownloadNotFoundError();
    return task;
  }

  private toResource(task: StoredBookDownload): DownloadResource {
    const progress = isObject(task.progress) ? task.progress : {};
    const artifact =
      task.status === BookDownloadStatus.SUCCEEDED &&
      task.artifactFilename !== null &&
      task.artifactSizeBytes !== null &&
      task.artifactSha256 !== null
        ? {
            filename: task.artifactFilename,
            sizeBytes: task.artifactSizeBytes,
            sha256: task.artifactSha256,
            downloadUrl: `/v1/downloads/${task.id}/file`,
          }
        : null;
    const error =
      task.status === BookDownloadStatus.FAILED &&
      task.errorCode !== null &&
      task.errorMessage !== null
        ? { code: task.errorCode, message: task.errorMessage }
        : null;
    return {
      id: task.id,
      platform: "fanqie",
      externalBookId: task.book.externalBookId,
      format: "txt",
      range:
        task.startChapter === null || task.endChapter === null
          ? null
          : {
              startChapter: task.startChapter,
              endChapter: task.endChapter,
            },
      status: task.status.toLowerCase() as DownloadResource["status"],
      progress,
      artifact,
      error,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      updatedAt: task.updatedAt,
    };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
