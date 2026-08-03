import type { Readable } from "node:stream";
import type { Platform } from "../../shared/types/platform.type";

export type DownloadStatus =
  | "queued"
  | "running"
  | "canceling"
  | "succeeded"
  | "failed"
  | "canceled";

export interface DownloadRangeResource {
  startChapter: number;
  endChapter: number;
}

export interface DownloadArtifactResource {
  filename: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
}

export interface DownloadErrorResource {
  code: string;
  message: string;
}

export interface DownloadResource {
  id: string;
  platform: Platform;
  externalBookId: string;
  format: "txt";
  range: DownloadRangeResource | null;
  status: DownloadStatus;
  progress: Record<string, unknown>;
  artifact: DownloadArtifactResource | null;
  error: DownloadErrorResource | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
}

export interface OpenDownloadFile {
  stream: Readable;
  filename: string;
  sizeBytes: number;
}

export interface DownloadsClock {
  now(): Date;
}
