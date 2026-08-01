import type { Readable } from "node:stream";
import type { Platform } from "../../shared/types/platform.type";

export interface ChapterRange {
  startChapter: number;
  endChapter: number;
}

export interface BookDownloadRequest {
  externalBookId: string;
  range: ChapterRange | null;
}

export interface DownloadTaskContext {
  id: string;
  startedAt: Date | null;
}

export type BookDownloadJobState =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "canceled";

export interface BookDownloadJob {
  id: string;
  externalBookId: string;
  title: string | null;
  author: string | null;
  state: BookDownloadJobState;
  message: string | null;
  progress: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
}

export interface BookDownloadJobRef {
  id: string;
}

export interface ArtifactSource {
  stream: Readable;
  contentType: string;
}

export interface BookDownloadRunner {
  readonly platform: Platform;
  initialize(): Promise<void>;
  listJobs(): Promise<BookDownloadJob[]>;
  createJob(request: BookDownloadRequest): Promise<BookDownloadJobRef>;
  getJob(jobId: string): Promise<BookDownloadJob | null>;
  cancelJob(jobId: string): Promise<void>;
  openArtifact(
    jobId: string,
    task: DownloadTaskContext,
    signal: AbortSignal,
  ): Promise<ArtifactSource>;
  releaseJob(jobId: string): Promise<void>;
}
