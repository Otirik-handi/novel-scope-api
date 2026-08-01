import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { QidianChapterCrawler } from "../../../crawlers/qidian/chapters/qidian-chapter.crawler";
import { QidianChapterCrawlerError } from "../../../crawlers/qidian/chapters/qidian-chapter.error";
import type { QidianCatalogChapter } from "../../../crawlers/qidian/chapters/qidian-catalog.parser";
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
      throw new Error("ARTIFACT_NOT_FOUND");
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
      );
      const chapters = this.selectRange(catalog.chapters, job.request.range);
      job.title = catalog.title;
      job.author = catalog.author;
      job.parts.push(`${catalog.title}\nAuthor: ${catalog.author}\n`);
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
          "No downloadable free chapters in range",
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
          "Qidian chapter range is outside the catalog",
        );
      }
      endIndex = Math.min(endIndex, range.endChapter);
      if (range.startChapter > endIndex) {
        throw new QidianChapterCrawlerError(
          "QIDIAN_RANGE_UNAVAILABLE",
          `Qidian chapter ${range.startChapter} is VIP or not free`,
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
        "This qidian book has no downloadable free chapters",
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
        "Qidian download task was canceled",
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
  return {
    code: "QIDIAN_CHAPTER_FETCH_FAILED",
    message:
      error instanceof Error ? error.message : "Qidian chapter fetch failed",
  };
}
