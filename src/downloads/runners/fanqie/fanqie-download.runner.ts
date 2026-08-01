import { Injectable } from "@nestjs/common";
import { setTimeout as sleep } from "node:timers/promises";
import { TomatoDownloaderClient } from "./tomato-downloader/tomato-downloader.client";
import {
  TOMATO_DOWNLOADER_SUPPORTED_VERSION,
  type DownloaderConfig,
  type DownloaderJob,
  type DownloaderLibraryItem,
} from "./tomato-downloader/tomato-downloader.contract";
import type {
  ArtifactSource,
  BookDownloadJob,
  BookDownloadJobRef,
  BookDownloadRequest,
  BookDownloadRunner,
  DownloadTaskContext,
} from "../book-download-runner.interface";
import { BookDownloadRunnerError } from "../book-download-runner.interface";
import { downloaderSafeFsName } from "../../../utils/downloader-filename.util";

@Injectable()
export class FanqieDownloadRunner implements BookDownloadRunner {
  readonly platform = "fanqie" as const;

  constructor(private readonly client: TomatoDownloaderClient) {}

  async initialize(): Promise<void> {
    const [status, config] = await Promise.all([
      this.client.getStatus(),
      this.client.getConfig(),
    ]);
    this.assertContract(status.version, config);
  }

  async listJobs(): Promise<BookDownloadJob[]> {
    return (await this.client.listJobs()).map(toBookDownloadJob);
  }

  async createJob(
    request: BookDownloadRequest,
  ): Promise<BookDownloadJobRef> {
    return this.client.createJob(request.externalBookId, request.range);
  }

  async getJob(jobId: string): Promise<BookDownloadJob | null> {
    const job = await this.client.getJob(jobId);
    return job === null ? null : toBookDownloadJob(job);
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.client.cancelJob(jobId);
  }

  async openArtifact(
    jobId: string,
    task: DownloadTaskContext,
    signal: AbortSignal,
  ): Promise<ArtifactSource> {
    const job = await this.getJob(jobId);
    if (!job || job.state !== "done" || !job.title) {
      throw new BookDownloadRunnerError(
        "ARTIFACT_NOT_FOUND",
        "Downloader artifact was not found",
      );
    }
    const item = await this.findArtifact(job.title, task, signal);
    if (item === null) {
      throw new BookDownloadRunnerError(
        "ARTIFACT_NOT_FOUND",
        "Downloader artifact was not found",
      );
    }
    return this.client.openArtifact(item.relativePath, signal);
  }

  async releaseJob(_jobId: string): Promise<void> {
    void _jobId;
  }

  private async findArtifact(
    title: string,
    task: DownloadTaskContext,
    signal: AbortSignal,
  ): Promise<DownloaderLibraryItem | null> {
    let scan = await this.client.scanLibrary(true, signal);
    while (scan.running) {
      await sleep(1_000, undefined, { signal });
      scan = await this.client.scanLibrary(false, signal);
    }
    const expected = `${downloaderSafeFsName(title)}.txt`;
    const earliest = (task.startedAt ?? new Date()).getTime() - 5_000;
    const candidates = scan.items.filter(
      (item) =>
        item.kind === "file" &&
        !/[\\/]/.test(item.relativePath) &&
        item.extension.toLowerCase() === "txt" &&
        item.name === expected &&
        item.modifiedAtMs !== null &&
        item.modifiedAtMs >= earliest,
    );
    return candidates.length === 1 ? candidates[0]! : null;
  }

  private assertContract(
    version: string,
    config: DownloaderConfig,
  ): void {
    const valid =
      version === TOMATO_DOWNLOADER_SUPPORTED_VERSION &&
      config.useOfficialApi &&
      config.novelFormat === "txt" &&
      !config.bulkFiles &&
      !config.enableSegmentComments &&
      !config.enableAudiobook &&
      !config.autoOpenDownloadedFiles &&
      !config.askFormatAfterDownload &&
      config.preferredBookNameField !== "ask_after_download" &&
      config.allowOverwriteFiles;
    if (!valid) {
      throw new Error(
        "Downloader version or configuration does not satisfy the NovelScope contract",
      );
    }
  }
}

function toBookDownloadJob(job: DownloaderJob): BookDownloadJob {
  return {
    id: job.id,
    externalBookId: job.bookId,
    title: job.title,
    author: job.author,
    state: job.state,
    message: job.message,
    progress: job.progress === null ? null : { ...job.progress },
    error:
      job.state === "failed"
        ? {
            code: "DOWNLOADER_REJECTED",
            message: job.message ?? "Downloader rejected the task",
          }
        : null,
    createdAtMs: job.createdAtMs,
    updatedAtMs: job.updatedAtMs,
  };
}
