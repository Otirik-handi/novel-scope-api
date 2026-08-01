import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { BookDownloadStatus } from "@prisma/client";
import { ArtifactStore } from "./artifact-store";
import {
  DownloadsRepository,
  type StoredBookDownload,
} from "./downloads.repository";
import {
  TomatoDownloaderClient,
  TomatoDownloaderClientError,
} from "./runners/fanqie/tomato-downloader/tomato-downloader.client";
import {
  TOMATO_DOWNLOADER_SUPPORTED_VERSION,
  type DownloaderJob,
} from "./runners/fanqie/tomato-downloader/tomato-downloader.contract";
import { downloaderSafeFsName } from "../utils/downloader-filename.util";

export interface DownloadsWorkerClock {
  now(): Date;
}

export interface DownloadsWorkerSleeper {
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export interface DownloadsWorkerOptions {
  pollIntervalMs: number;
  taskTimeoutMs: number;
}

export class DownloadsWorkerStartupError extends Error {
  override readonly name = "DownloadsWorkerStartupError";
}

class DownloadsWorkerStoppingError extends Error {
  override readonly name = "DownloadsWorkerStoppingError";
}

class DownloadsWorkerTaskTimeoutError extends Error {
  override readonly name = "DownloadsWorkerTaskTimeoutError";
}

const FAILURE_MESSAGES = {
  DOWNLOADER_REJECTED: "Downloader rejected the task",
  DOWNSTREAM_TASK_LOST: "Downloader task was lost",
  DOWNLOAD_TIMEOUT: "Download task timed out",
  NOT_FOUND: "Downloader artifact was not found",
  ARTIFACT_NOT_FOUND: "Downloader artifact was not found",
  ARTIFACT_TOO_LARGE: "Downloaded artifact exceeds the size limit",
  ARTIFACT_INVALID: "Downloader returned an invalid TXT artifact",
  ARTIFACT_STORE_FAILED: "Failed to store downloaded artifact",
} as const;

@Injectable()
export class DownloadsWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DownloadsWorker.name);
  private activeTaskId: string | null = null;
  private uncertainCreateTaskId: string | null = null;
  private uncertainCreateAfterMs = 0;
  private stopping = false;
  private loopPromise: Promise<void> | null = null;
  private readonly shutdown = new AbortController();

  constructor(
    private readonly repository: DownloadsRepository,
    private readonly client: TomatoDownloaderClient,
    private readonly artifacts: ArtifactStore,
    private readonly clock: DownloadsWorkerClock,
    private readonly sleeper: DownloadsWorkerSleeper,
    private readonly options: DownloadsWorkerOptions,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.initialize();
    this.loopPromise = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.shutdown.abort();
    await this.loopPromise;
  }

  async initialize(): Promise<void> {
    await this.artifacts.validateRoot();
    const [status, config, downstreamJobs, recoverable] = await Promise.all([
      this.client.getStatus(),
      this.client.getConfig(),
      this.client.listJobs(),
      this.repository.findRecoverable(),
    ]);
    this.assertContract(status.version, config);
    for (const task of recoverable) {
      if (task.downstreamJobId === null) {
        await this.finishMissingTask(task);
      }
    }
    if (recoverable.length > 1) {
      throw new DownloadsWorkerStartupError(
        "Multiple active NovelScope download tasks were found",
      );
    }

    const task = recoverable[0];
    const knownJobIds = new Set(
      recoverable
        .map((task) => task.downstreamJobId)
        .filter((value): value is string => value !== null),
    );
    const unknownActive = downstreamJobs.find(
      (job) =>
        (job.state === "queued" || job.state === "running") &&
        !knownJobIds.has(job.id),
    );
    if (unknownActive) {
      throw new DownloadsWorkerStartupError(
        "Downloader has an unknown active job",
      );
    }

    if (!task || task.downstreamJobId === null) {
      this.activeTaskId = null;
      return;
    }
    if (!downstreamJobs.some((job) => job.id === task.downstreamJobId)) {
      await this.finishMissingTask(task);
      return;
    }
    this.activeTaskId = task.id;
  }

  async processOnce(): Promise<void> {
    let task: StoredBookDownload | null;
    if (this.activeTaskId === null) {
      task = await this.repository.claimNextQueued(this.clock.now());
      if (task === null) return;
      this.activeTaskId = task.id;
    } else {
      task = await this.repository.findById(this.activeTaskId);
      if (task === null) {
        this.activeTaskId = null;
        return;
      }
      if (!isActiveDownload(task)) {
        this.activeTaskId = null;
        return;
      }
    }

    if (this.hasTimedOut(task)) {
      await this.timeout(task);
      return;
    }

    if (task.downstreamJobId === null) {
      let downstream =
        this.uncertainCreateTaskId === task.id
          ? await this.reconcileUncertainCreate(task)
          : null;
      if (downstream === null) {
        this.uncertainCreateTaskId = task.id;
        this.uncertainCreateAfterMs = this.clock.now().getTime() - 5_000;
        downstream = await this.client.createJob(
          task.book.externalBookId,
          task.startChapter === null || task.endChapter === null
            ? null
            : {
                startChapter: task.startChapter,
                endChapter: task.endChapter,
              },
        );
      }
      const updated = await this.repository.setDownstreamJobId(
        task.id,
        downstream.id,
      );
      this.uncertainCreateTaskId = null;
      if (updated === null) {
        this.activeTaskId = null;
        return;
      }
      task = updated;
    }

    const downstreamJobId = task.downstreamJobId;
    if (downstreamJobId === null) {
      await this.fail(task, "DOWNSTREAM_TASK_LOST");
      return;
    }
    if (task.status === BookDownloadStatus.CANCELING) {
      await this.client.cancelJob(downstreamJobId).catch(() => undefined);
    }

    const job = await this.client.getJob(downstreamJobId);
    if (job === null) {
      await this.finishMissingTask(task);
      return;
    }
    if (job.progress !== null) {
      await this.repository.updateProgress(task.id, { ...job.progress });
    }

    switch (job.state) {
      case "queued":
      case "running":
        return;
      case "done":
        await this.complete(task, job);
        return;
      case "failed":
        await this.fail(task, "DOWNLOADER_REJECTED");
        return;
      case "canceled":
        await this.repository.markCanceled(task.id, this.clock.now());
        this.activeTaskId = null;
    }
  }

  private async runLoop(): Promise<void> {
    let unavailableDelay = 1_000;
    while (!this.stopping) {
      try {
        await this.processOnce();
        unavailableDelay = 1_000;
        if (!this.stopping) {
          if (!(await this.sleep(this.options.pollIntervalMs))) return;
        }
      } catch (error) {
        if (
          error instanceof TomatoDownloaderClientError &&
          error.code === "UNAVAILABLE"
        ) {
          this.logger.warn("Downloader is unavailable; pausing download queue");
          if (!this.stopping) {
            if (!(await this.sleep(unavailableDelay))) return;
          }
          unavailableDelay = Math.min(unavailableDelay * 2, 30_000);
          continue;
        }
        if (
          error instanceof TomatoDownloaderClientError &&
          error.code === "REJECTED" &&
          this.activeTaskId !== null
        ) {
          const task = await this.repository.findById(this.activeTaskId);
          if (task) await this.fail(task, "DOWNLOADER_REJECTED");
          continue;
        }
        if (this.stopping) return;
        this.logger.error(
          `Download worker iteration failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!this.stopping) {
          if (!(await this.sleep(this.options.pollIntervalMs))) return;
        }
      }
    }
  }

  private assertContract(
    version: string,
    config: Awaited<ReturnType<TomatoDownloaderClient["getConfig"]>>,
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
      throw new DownloadsWorkerStartupError(
        "Downloader version or configuration does not satisfy the NovelScope contract",
      );
    }
  }

  private hasTimedOut(task: StoredBookDownload): boolean {
    return (
      task.startedAt !== null &&
      this.clock.now().getTime() - task.startedAt.getTime() >
        this.options.taskTimeoutMs
    );
  }

  private async timeout(task: StoredBookDownload): Promise<void> {
    if (task.downstreamJobId !== null) {
      await this.client.cancelJob(task.downstreamJobId).catch(() => undefined);
    }
    await this.repository.fail(task.id, {
      code: "DOWNLOAD_TIMEOUT",
      message: FAILURE_MESSAGES.DOWNLOAD_TIMEOUT,
      finishedAt: this.clock.now(),
    });
    this.activeTaskId = null;
  }

  private async complete(
    task: StoredBookDownload,
    job: DownloaderJob,
  ): Promise<void> {
    if (!job.title) {
      await this.fail(task, "ARTIFACT_NOT_FOUND");
      return;
    }
    let signal: AbortSignal | null = null;
    let stored: Awaited<ReturnType<ArtifactStore["store"]>> | null = null;
    try {
      signal = this.createTaskSignal(task);
      const item = await this.findArtifact(job.title, task, signal);
      if (item === null) {
        await this.fail(task, "ARTIFACT_NOT_FOUND");
        return;
      }
      const source = await this.client.openArtifact(item.relativePath, signal);
      stored = await this.artifacts.store(
        task.id,
        source.stream,
        source.contentType,
        signal,
      );
      this.assertWithinDeadline(task);
    } catch (error) {
      if (this.stopping || error instanceof DownloadsWorkerStoppingError) {
        throw new DownloadsWorkerStoppingError();
      }
      if (
        error instanceof DownloadsWorkerTaskTimeoutError ||
        signal?.aborted ||
        this.hasTimedOut(task)
      ) {
        if (stored !== null) {
          await this.artifacts.delete(stored.relativePath).catch(() => undefined);
        }
        await this.timeout(task);
        return;
      }
      const unavailable = findUnavailableError(error);
      if (unavailable !== null) throw unavailable;
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string" &&
        error.code in FAILURE_MESSAGES
          ? (error.code as keyof typeof FAILURE_MESSAGES)
          : "ARTIFACT_STORE_FAILED";
      await this.fail(task, code);
      return;
    }

    await this.publishArtifact(task, job.title, stored);
  }

  private async publishArtifact(
    task: StoredBookDownload,
    title: string,
    stored: Awaited<ReturnType<ArtifactStore["store"]>>,
  ): Promise<void> {
    let published: StoredBookDownload | null;
    try {
      published = await this.repository.succeed(task.id, {
        artifactPath: stored.relativePath,
        filename: displayFilename(title, task),
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        finishedAt: this.clock.now(),
      });
    } catch (error) {
      let current: StoredBookDownload | null;
      try {
        current = await this.repository.findById(task.id);
      } catch {
        throw error;
      }
      if (isPublishedArtifact(current, stored)) {
        this.activeTaskId = null;
        return;
      }
      await this.artifacts.delete(stored.relativePath);
      if (!isActiveDownload(current)) this.activeTaskId = null;
      throw error;
    }

    if (published !== null) {
      this.activeTaskId = null;
      return;
    }

    const current = await this.repository.findById(task.id);
    if (isPublishedArtifact(current, stored)) {
      this.activeTaskId = null;
      return;
    }
    await this.artifacts.delete(stored.relativePath);
    if (!isActiveDownload(current)) this.activeTaskId = null;
  }

  private async findArtifact(
    title: string,
    task: StoredBookDownload,
    signal: AbortSignal,
  ): Promise<Awaited<ReturnType<TomatoDownloaderClient["scanLibrary"]>>["items"][number] | null> {
    this.assertWithinDeadline(task);
    let scan = await this.client.scanLibrary(true, signal);
    while (scan.running) {
      this.assertWithinDeadline(task);
      if (!(await this.sleep(this.options.pollIntervalMs))) {
        throw new DownloadsWorkerStoppingError();
      }
      this.assertWithinDeadline(task);
      scan = await this.client.scanLibrary(false, signal);
    }
    const expected = `${downloaderSafeFsName(title)}.txt`;
    const earliest = (task.startedAt ?? this.clock.now()).getTime() - 5_000;
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

  private async reconcileUncertainCreate(
    task: StoredBookDownload,
  ): Promise<{ id: string } | null> {
    const candidates = (await this.client.listJobs()).filter(
      (job) =>
        job.bookId === task.book.externalBookId &&
        job.createdAtMs >= this.uncertainCreateAfterMs,
    );
    if (candidates.length > 1) {
      throw new DownloadsWorkerStartupError(
        "Downloader has multiple candidate jobs for an uncertain create request",
      );
    }
    if (candidates.length === 1) {
      return { id: candidates[0]!.id };
    }
    this.uncertainCreateTaskId = null;
    return null;
  }

  private assertWithinDeadline(task: StoredBookDownload): void {
    if (this.hasTimedOut(task)) {
      throw new DownloadsWorkerTaskTimeoutError();
    }
  }

  private createTaskSignal(task: StoredBookDownload): AbortSignal {
    this.assertWithinDeadline(task);
    const startedAt = task.startedAt ?? this.clock.now();
    const elapsed = this.clock.now().getTime() - startedAt.getTime();
    const remaining = Math.max(1, this.options.taskTimeoutMs - elapsed);
    return AbortSignal.any([
      this.shutdown.signal,
      AbortSignal.timeout(remaining),
    ]);
  }

  private async finishMissingTask(task: StoredBookDownload): Promise<void> {
    if (task.status === BookDownloadStatus.CANCELING) {
      await this.repository.markCanceled(task.id, this.clock.now());
      this.activeTaskId = null;
      return;
    }
    await this.fail(task, "DOWNSTREAM_TASK_LOST");
  }

  private async fail(
    task: StoredBookDownload,
    code: keyof typeof FAILURE_MESSAGES,
  ): Promise<void> {
    await this.repository.fail(task.id, {
      code,
      message: FAILURE_MESSAGES[code],
      finishedAt: this.clock.now(),
    });
    this.activeTaskId = null;
  }

  private async sleep(milliseconds: number): Promise<boolean> {
    try {
      await this.sleeper.sleep(milliseconds, this.shutdown.signal);
      return !this.stopping;
    } catch (error) {
      if (!this.stopping) throw error;
      return false;
    }
  }
}

function findUnavailableError(
  error: unknown,
): TomatoDownloaderClientError | null {
  const seen = new Set<unknown>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    if (
      current instanceof TomatoDownloaderClientError &&
      current.code === "UNAVAILABLE"
    ) {
      return current;
    }
    seen.add(current);
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

function isActiveDownload(task: StoredBookDownload | null): boolean {
  return (
    task !== null &&
    (task.status === BookDownloadStatus.RUNNING ||
      task.status === BookDownloadStatus.CANCELING)
  );
}

function isPublishedArtifact(
  task: StoredBookDownload | null,
  stored: Awaited<ReturnType<ArtifactStore["store"]>>,
): boolean {
  return (
    task?.status === BookDownloadStatus.SUCCEEDED &&
    task.artifactPath === stored.relativePath &&
    task.artifactSizeBytes === stored.sizeBytes &&
    task.artifactSha256 === stored.sha256
  );
}

function displayFilename(title: string, task: StoredBookDownload): string {
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_").trim() || "fanqie-novel";
  if (task.startChapter !== null && task.endChapter !== null) {
    return `${safeTitle}_第${task.startChapter}-${task.endChapter}章.txt`;
  }
  return `${safeTitle}.txt`;
}
