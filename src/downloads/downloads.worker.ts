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
} from "./tomato-downloader/tomato-downloader.client";
import {
  TOMATO_DOWNLOADER_SUPPORTED_VERSION,
  type DownloaderJob,
} from "./tomato-downloader/tomato-downloader.contract";

export interface DownloadsWorkerClock {
  now(): Date;
}

export interface DownloadsWorkerSleeper {
  sleep(milliseconds: number): Promise<void>;
}

export interface DownloadsWorkerOptions {
  pollIntervalMs: number;
  taskTimeoutMs: number;
}

export class DownloadsWorkerStartupError extends Error {
  override readonly name = "DownloadsWorkerStartupError";
}

const FAILURE_MESSAGES = {
  DOWNLOADER_REJECTED: "Downloader rejected the task",
  DOWNSTREAM_TASK_LOST: "Downloader task was lost",
  DOWNLOAD_TIMEOUT: "Download task timed out",
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
  private stopping = false;
  private loopPromise: Promise<void> | null = null;

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
    if (recoverable.length > 1) {
      throw new DownloadsWorkerStartupError(
        "Multiple active NovelScope download tasks were found",
      );
    }

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

    const task = recoverable[0];
    if (!task) {
      this.activeTaskId = null;
      return;
    }
    if (
      task.downstreamJobId !== null &&
      !downstreamJobs.some((job) => job.id === task.downstreamJobId)
    ) {
      await this.repository.fail(task.id, {
        code: "DOWNSTREAM_TASK_LOST",
        message: FAILURE_MESSAGES.DOWNSTREAM_TASK_LOST,
        finishedAt: this.clock.now(),
      });
      this.activeTaskId = null;
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
    }

    if (this.hasTimedOut(task)) {
      await this.timeout(task);
      return;
    }

    if (task.downstreamJobId === null) {
      const downstream = await this.client.createJob(
        task.book.externalBookId,
        task.startChapter === null || task.endChapter === null
          ? null
          : {
              startChapter: task.startChapter,
              endChapter: task.endChapter,
            },
      );
      const updated = await this.repository.setDownstreamJobId(
        task.id,
        downstream.id,
      );
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
      await this.fail(task, "DOWNSTREAM_TASK_LOST");
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
          await this.sleeper.sleep(this.options.pollIntervalMs);
        }
      } catch (error) {
        if (
          error instanceof TomatoDownloaderClientError &&
          error.code === "UNAVAILABLE"
        ) {
          this.logger.warn("Downloader is unavailable; pausing download queue");
          if (!this.stopping) await this.sleeper.sleep(unavailableDelay);
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
        this.logger.error(
          `Download worker iteration failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!this.stopping) await this.sleeper.sleep(this.options.pollIntervalMs);
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
    const item = await this.findArtifact(job.title, task.startedAt);
    if (item === null) {
      await this.fail(task, "ARTIFACT_NOT_FOUND");
      return;
    }
    try {
      const source = await this.client.openArtifact(item.relativePath);
      const stored = await this.artifacts.store(
        task.id,
        source.stream,
        source.contentType,
      );
      await this.repository.succeed(task.id, {
        artifactPath: stored.relativePath,
        filename: displayFilename(job.title, task),
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        finishedAt: this.clock.now(),
      });
      this.activeTaskId = null;
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string" &&
        error.code in FAILURE_MESSAGES
          ? (error.code as keyof typeof FAILURE_MESSAGES)
          : "ARTIFACT_STORE_FAILED";
      await this.fail(task, code);
    }
  }

  private async findArtifact(
    title: string,
    startedAt: Date | null,
  ): Promise<Awaited<ReturnType<TomatoDownloaderClient["scanLibrary"]>>["items"][number] | null> {
    let scan = await this.client.scanLibrary(true);
    while (scan.running) {
      await this.sleeper.sleep(this.options.pollIntervalMs);
      scan = await this.client.scanLibrary(false);
    }
    const expected = `${downloaderSafeFsName(title)}.txt`;
    const earliest = (startedAt ?? this.clock.now()).getTime() - 5_000;
    const candidates = scan.items.filter(
      (item) =>
        item.kind === "file" &&
        item.extension.toLowerCase() === "txt" &&
        item.name === expected &&
        item.modifiedAtMs !== null &&
        item.modifiedAtMs >= earliest,
    );
    return candidates.length === 1 ? candidates[0]! : null;
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
}

function displayFilename(title: string, task: StoredBookDownload): string {
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, "_").trim() || "fanqie-novel";
  if (task.startChapter !== null && task.endChapter !== null) {
    return `${safeTitle}_第${task.startChapter}-${task.endChapter}章.txt`;
  }
  return `${safeTitle}.txt`;
}

function downloaderSafeFsName(name: string): string {
  const replacements: Record<string, string> = {
    ":": "\uFF1A",
    '"': "\uFF02",
    "<": "\u300A",
    ">": "\u300B",
    "/": "\u3001",
    "\\": "\u3001",
    "|": "\uFF5C",
    "?": "\uFF1F",
    "*": "\uFF0A",
  };
  let cleaned = [...name]
    .map((character) =>
      character.charCodeAt(0) < 32
        ? "_"
        : (replacements[character] ?? character),
    )
    .join("");
  cleaned = cleaned.replace(/[ .]+$/g, "");
  if (cleaned.length === 0) cleaned = "unnamed";
  const reserved = new Set([
    "CON", "PRN", "AUX", "NUL",
    ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
    ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
  ]);
  if (reserved.has(cleaned.toUpperCase())) cleaned = `_${cleaned}`;
  while (Buffer.byteLength(cleaned, "utf8") > 120) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned.replace(/[ .]+$/g, "") || "unnamed";
}

