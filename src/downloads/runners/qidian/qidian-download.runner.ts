import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { QidianChapterCrawler } from "../../../crawlers/qidian/chapters/qidian-chapter.crawler";
import { QidianChapterCrawlerError } from "../../../crawlers/qidian/chapters/qidian-chapter.error";
import type { QidianCatalogChapter } from "../../../crawlers/qidian/chapters/qidian-catalog.parser";
import { BookDownloadRunnerError } from "../book-download-runner.interface";
import type {
  ArtifactSource,
  BookDownloadJob,
  BookDownloadJobRef,
  BookDownloadRequest,
  BookDownloadRunner,
  BookDownloadJobState,
  DownloadTaskContext,
} from "../book-download-runner.interface";

interface RunningQidianJob {
  id: string;
  request: BookDownloadRequest;
  state: BookDownloadJobState;
  controller: AbortController;
  title: string | null;
  author: string | null;
  progress: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  parts: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

@Injectable()
export class QidianDownloadRunner implements BookDownloadRunner {
  readonly platform = "qidian" as const;
  private readonly jobs = new Map<string, RunningQidianJob>();

  constructor(private readonly crawler: QidianChapterCrawler) {}

  async initialize(): Promise<void> {}

  async listJobs(): Promise<BookDownloadJob[]> {
    return [...this.jobs.values()].map((job) => this.toJob(job));
  }

  async createJob(request: BookDownloadRequest): Promise<BookDownloadJobRef> {
    const id = randomUUID();
    const now = Date.now();
    const job: RunningQidianJob = {
      id,
      request,
      state: "queued",
      controller: new AbortController(),
      title: null,
      author: null,
      progress: null,
      error: null,
      parts: [],
      createdAtMs: now,
      updatedAtMs: now,
    };
    this.jobs.set(id, job);
    void this.execute(job);
    return { id };
  }

  async getJob(jobId: string): Promise<BookDownloadJob | null> {
    const job = this.jobs.get(jobId);
    return job === undefined ? null : this.toJob(job);
  }

  async cancelJob(jobId: string): Promise<void> {
    this.jobs.get(jobId)?.controller.abort();
  }

  async openArtifact(
    jobId: string,
    _task: DownloadTaskContext,
    _signal: AbortSignal,
  ): Promise<ArtifactSource> {
    void _task;
    void _signal;
    const job = this.jobs.get(jobId);
    if (job === undefined || job.state !== "done") {
      throw new BookDownloadRunnerError(
        "ARTIFACT_NOT_FOUND",
        "Qidian artifact was not found",
      );
    }
    return {
      stream: Readable.from(job.parts),
      contentType: "text/plain; charset=utf-8",
    };
  }

  async releaseJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  private async execute(job: RunningQidianJob): Promise<void> {
    job.state = "running";
    job.updatedAtMs = Date.now();
    try {
      const catalog = await this.crawler.fetchCatalog(
        job.request.externalBookId,
        job.controller.signal,
      );
      const chapters = this.selectRange(catalog.chapters, job.request.range);
      job.title = catalog.title;
      job.author = catalog.author;
      job.parts.push(`${catalog.title}\n\u4f5c\u8005\uff1a${catalog.author}\n`);
      job.progress = {
        chapterTotal: chapters.length,
        savedChapters: 0,
        savePhase: "crawling",
      };
      const firstVip = catalog.chapters.find((chapter) => chapter.isVip);
      if (
        firstVip !== undefined &&
        (job.request.range === null ||
          job.request.range.endChapter >= firstVip.index)
      ) {
        this.stopAtVip(job, firstVip);
      }

      let savedChapters = 0;
      for (const chapter of chapters) {
        this.throwIfAborted(job);
        const content = await this.crawler.fetchChapter(
          catalog.bookId,
          chapter.chapterId,
          job.controller.signal,
        );
        this.throwIfAborted(job);

        if (content.isVip) {
          this.stopAtVip(job, chapter);
          break;
        }

        savedChapters += 1;
        job.parts.push(`\n${chapter.title}\n\n${content.content}\n`);
        job.progress = {
          ...(job.progress ?? {}),
          chapterTotal: chapters.length,
          savedChapters,
          savePhase: "crawling",
        };
        job.updatedAtMs = Date.now();
      }

      if (savedChapters === 0) {
        throw new QidianChapterCrawlerError(
          "QIDIAN_RANGE_UNAVAILABLE",
          "\u8d77\u70b9\u7ae0\u8282\u4e3aVIP\u6216\u4e0d\u53ef\u4e0b\u8f7d",
        );
      }

      job.progress = {
        ...(job.progress ?? {}),
        savePhase: "completed",
      };
      job.state = "done";
      job.updatedAtMs = Date.now();
    } catch (error) {
      if (job.controller.signal.aborted) {
        job.state = "canceled";
        job.error = null;
      } else {
        job.state = "failed";
        job.error = normalizeError(error);
      }
      job.updatedAtMs = Date.now();
    }
  }

  private selectRange(
    chapters: QidianCatalogChapter[],
    range: BookDownloadRequest["range"],
  ): QidianCatalogChapter[] {
    const firstVipIndex =
      chapters.find((chapter) => chapter.isVip)?.index ?? null;
    let endIndex =
      firstVipIndex === null ? chapters.length : firstVipIndex - 1;

    if (range !== null) {
      if (range.startChapter < 1 || range.endChapter > chapters.length) {
        throw new QidianChapterCrawlerError(
          "QIDIAN_RANGE_INVALID",
          "\u8d77\u70b9\u7ae0\u8282\u8303\u56f4\u8d85\u51fa\u76ee\u5f55",
        );
      }
      endIndex = Math.min(endIndex, range.endChapter);
      if (range.startChapter > endIndex) {
        throw new QidianChapterCrawlerError(
          "QIDIAN_RANGE_UNAVAILABLE",
          `\u8d77\u70b9\u7b2c${range.startChapter}\u7ae0\u4e3aVIP\u6216\u4e0d\u53ef\u4e0b\u8f7d`,
        );
      }
      return chapters.filter(
        (chapter) =>
          chapter.index >= range.startChapter &&
          chapter.index <= endIndex,
      );
    }

    if (endIndex < 1) {
      throw new QidianChapterCrawlerError(
        "QIDIAN_RANGE_UNAVAILABLE",
        "\u8be5\u8d77\u70b9\u4e66\u7c4d\u6ca1\u6709\u53ef\u4e0b\u8f7d\u7684\u514d\u8d39\u7ae0\u8282",
      );
    }
    return chapters.filter((chapter) => chapter.index <= endIndex);
  }

  private stopAtVip(
    job: RunningQidianJob,
    chapter: QidianCatalogChapter,
  ): void {
    job.progress = {
      ...(job.progress ?? {}),
      stoppedAtChapter: chapter.index,
      stopReason: "CHAPTER_VIP",
    };
    job.updatedAtMs = Date.now();
  }

  private throwIfAborted(job: RunningQidianJob): void {
    if (job.controller.signal.aborted) {
      throw new QidianChapterCrawlerError(
        "QIDIAN_JOB_CANCELED",
        "\u8d77\u70b9\u4e0b\u8f7d\u4efb\u52a1\u5df2\u53d6\u6d88",
      );
    }
  }

  private toJob(job: RunningQidianJob): BookDownloadJob {
    return {
      id: job.id,
      externalBookId: job.request.externalBookId,
      title: job.title,
      author: job.author,
      state: job.state,
      message: job.error?.message ?? null,
      progress: job.progress,
      error: job.error,
      createdAtMs: job.createdAtMs,
      updatedAtMs: job.updatedAtMs,
    };
  }
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof QidianChapterCrawlerError) {
    return { code: error.code, message: error.message };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("QIDIAN_")
  ) {
    return {
      code: error.code,
      message: error instanceof Error ? error.message : String(error.code),
    };
  }
  return {
    code: "QIDIAN_CHAPTER_FETCH_FAILED",
    message: error instanceof Error ? error.message : "\u8d77\u70b9\u7ae0\u8282\u6293\u53d6\u5931\u8d25",
  };
}
