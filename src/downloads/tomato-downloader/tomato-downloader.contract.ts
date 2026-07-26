export const TOMATO_DOWNLOADER_SUPPORTED_VERSION = "2.4.13";

export interface ChapterRange {
  startChapter: number;
  endChapter: number;
}

export interface DownloaderStatus {
  version: string;
  locked: boolean;
  saveDirectory: string;
}

export interface DownloaderConfig {
  useOfficialApi: boolean;
  novelFormat: string;
  bulkFiles: boolean;
  enableSegmentComments: boolean;
  enableAudiobook: boolean;
  autoOpenDownloadedFiles: boolean;
  askFormatAfterDownload: boolean;
  preferredBookNameField: string;
  allowOverwriteFiles: boolean;
}

export type DownloaderJobState =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "canceled";

export interface DownloaderProgress {
  chapterTotal: number;
  savedChapters: number;
  groupTotal: number;
  groupDone: number;
  savePhase: string | null;
}

export interface DownloaderJob {
  id: string;
  bookId: string;
  title: string | null;
  author: string | null;
  state: DownloaderJobState;
  message: string | null;
  progress: DownloaderProgress | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface DownloaderJobRef {
  id: string;
}

export interface DownloaderLibraryItem {
  kind: "file" | "dir";
  name: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  modifiedAtMs: number | null;
}

export interface DownloaderLibraryScan {
  running: boolean;
  items: DownloaderLibraryItem[];
}
