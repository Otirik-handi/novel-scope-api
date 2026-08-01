import { PassThrough, Readable } from "node:stream";
import axios, {
  type AxiosAdapter,
  type AxiosInstance,
  isAxiosError,
} from "axios";
import type {
  ChapterRange,
  DownloaderConfig,
  DownloaderJob,
  DownloaderJobRef,
  DownloaderJobState,
  DownloaderLibraryItem,
  DownloaderLibraryScan,
  DownloaderProgress,
  DownloaderStatus,
} from "./tomato-downloader.contract";

export type TomatoDownloaderClientErrorCode =
  | "UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "REJECTED"
  | "NOT_FOUND";

export class TomatoDownloaderClientError extends Error {
  override readonly name = "TomatoDownloaderClientError";

  constructor(
    readonly code: TomatoDownloaderClientErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface TomatoDownloaderClientOptions {
  adapter?: AxiosAdapter;
  baseUrl: string;
  password: string | null;
  requestTimeoutMs: number;
}

interface ArtifactResponse {
  stream: Readable;
  contentType: string;
}

const JOB_STATES = new Set<DownloaderJobState>([
  "queued",
  "running",
  "done",
  "failed",
  "canceled",
]);

export class TomatoDownloaderClient {
  private readonly http: AxiosInstance;

  constructor(private readonly options: TomatoDownloaderClientOptions) {
    this.http = axios.create({
      adapter: options.adapter,
      baseURL: options.baseUrl,
      maxRedirects: 0,
      timeout: options.requestTimeoutMs,
    });
  }

  async getStatus(): Promise<DownloaderStatus> {
    const data = await this.requestJson("get", "/api/status");
    return {
      version: requiredString(data, "version"),
      locked: requiredBoolean(data, "locked"),
      saveDirectory: requiredString(data, "save_dir"),
    };
  }

  async getConfig(): Promise<DownloaderConfig> {
    const data = await this.requestJson("get", "/api/config/full");
    return {
      useOfficialApi: requiredBoolean(data, "use_official_api"),
      novelFormat: requiredString(data, "novel_format"),
      bulkFiles: requiredBoolean(data, "bulk_files"),
      enableSegmentComments: requiredBoolean(data, "enable_segment_comments"),
      enableAudiobook: requiredBoolean(data, "enable_audiobook"),
      autoOpenDownloadedFiles: requiredBoolean(data, "auto_open_downloaded_files"),
      askFormatAfterDownload: requiredBoolean(data, "ask_format_after_download"),
      preferredBookNameField: requiredString(data, "preferred_book_name_field"),
      allowOverwriteFiles: requiredBoolean(data, "allow_overwrite_files"),
    };
  }

  async listJobs(): Promise<DownloaderJob[]> {
    const data = await this.requestJson("get", "/api/jobs?all=true");
    return requiredArray(data, "items").map((item) => parseJob(item));
  }

  async createJob(
    bookId: string,
    range: ChapterRange | null,
  ): Promise<DownloaderJobRef> {
    const payload: Record<string, string | number> = { book_id: bookId };
    if (range !== null) {
      payload.range_start = range.startChapter;
      payload.range_end = range.endChapter;
    }
    const data = await this.requestJson("post", "/api/jobs", payload);
    return { id: requiredIdentifier(data, "id") };
  }

  async getJob(jobId: string): Promise<DownloaderJob | null> {
    const data = await this.requestJson(
      "get",
      `/api/jobs?id=${encodeURIComponent(jobId)}&all=true`,
    );
    const items = requiredArray(data, "items");
    return items.length === 0 ? null : parseJob(items[0]);
  }

  async cancelJob(jobId: string): Promise<void> {
    await this.requestJson(
      "post",
      `/api/jobs/${encodeURIComponent(jobId)}/cancel`,
    );
  }

  async scanLibrary(
    start: boolean,
    signal?: AbortSignal,
  ): Promise<DownloaderLibraryScan> {
    const data = await this.requestJson(
      "get",
      `/api/library?start=${start ? "true" : "false"}`,
      undefined,
      signal,
    );
    return {
      running: requiredBoolean(data, "running"),
      items: requiredArray(data, "items").map((item) => parseLibraryItem(item)),
    };
  }

  async openArtifact(
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<ArtifactResponse> {
    const encodedPath = encodeRelativePath(relativePath);
    try {
      const response = await this.http.get<Readable>(`/download/${encodedPath}`, {
        headers: this.headers(),
        maxRedirects: 0,
        responseType: "stream",
        signal,
        timeout: this.options.requestTimeoutMs,
      });
      if (!(response.data instanceof Readable)) {
        throw new TomatoDownloaderClientError(
          "INVALID_RESPONSE",
          "Downloader returned an invalid artifact stream",
        );
      }
      const contentType = headerString(response.headers, "content-type");
      if (!contentType) {
        response.data.destroy();
        throw new TomatoDownloaderClientError(
          "INVALID_RESPONSE",
          "Downloader returned an artifact without Content-Type",
        );
      }
      const stream = new PassThrough();
      response.data.once("error", (error: unknown) => {
        stream.destroy(
          error instanceof TomatoDownloaderClientError
            ? error
            : new TomatoDownloaderClientError(
                "UNAVAILABLE",
                "Downloader is unavailable",
              ),
        );
      });
      stream.once("close", () => response.data.destroy());
      response.data.pipe(stream);
      return { stream, contentType };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  private async requestJson(
    method: "get" | "post",
    url: string,
    data?: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await this.http.request<unknown>({
        data,
        headers: this.headers(),
        maxRedirects: 0,
        method,
        signal,
        timeout: this.options.requestTimeoutMs,
        url,
      });
      const contentType = headerString(response.headers, "content-type");
      if (!contentType?.toLowerCase().includes("application/json")) {
        throw new TomatoDownloaderClientError(
          "INVALID_RESPONSE",
          "Downloader returned an invalid JSON Content-Type",
        );
      }
      return requiredObject(response.data);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  private headers(): Record<string, string> | undefined {
    return this.options.password === null
      ? undefined
      : { "x-tomato-password": this.options.password };
  }

  private normalizeError(error: unknown): TomatoDownloaderClientError {
    if (error instanceof TomatoDownloaderClientError) return error;
    if (isAxiosError(error)) {
      if (error.response?.status === 404) {
        return new TomatoDownloaderClientError(
          "NOT_FOUND",
          "Downloader artifact was not found",
        );
      }
      const code = error.response ? "REJECTED" : "UNAVAILABLE";
      return new TomatoDownloaderClientError(
        code,
        code === "REJECTED"
          ? "Downloader rejected the request"
          : "Downloader is unavailable",
      );
    }
    return new TomatoDownloaderClientError(
      "INVALID_RESPONSE",
      "Downloader returned an invalid response",
    );
  }
}

function requiredObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TomatoDownloaderClientError(
      "INVALID_RESPONSE",
      "Downloader returned an invalid response",
    );
  }
  return value as Record<string, unknown>;
}

function requiredString(object: Record<string, unknown>, key: string): string {
  const value = object[key];
  if (typeof value !== "string") invalidField(key);
  return value;
}

function nullableString(object: Record<string, unknown>, key: string): string | null {
  const value = object[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") invalidField(key);
  return value;
}

function requiredBoolean(object: Record<string, unknown>, key: string): boolean {
  const value = object[key];
  if (typeof value !== "boolean") invalidField(key);
  return value;
}

function requiredNumber(object: Record<string, unknown>, key: string): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value)) invalidField(key);
  return value;
}

function nullableNumber(object: Record<string, unknown>, key: string): number | null {
  const value = object[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) invalidField(key);
  return value;
}

function requiredArray(object: Record<string, unknown>, key: string): unknown[] {
  const value = object[key];
  if (!Array.isArray(value)) invalidField(key);
  return value;
}

function requiredIdentifier(object: Record<string, unknown>, key: string): string {
  const value = object[key];
  if (typeof value !== "string" && typeof value !== "number") invalidField(key);
  return String(value);
}

function parseJob(value: unknown): DownloaderJob {
  const object = requiredObject(value);
  const rawState = requiredString(object, "state");
  if (!JOB_STATES.has(rawState as DownloaderJobState)) invalidField("state");
  const rawProgress = object.progress;
  return {
    id: requiredIdentifier(object, "id"),
    bookId: requiredString(object, "book_id"),
    title: nullableString(object, "title"),
    author: nullableString(object, "author"),
    state: rawState as DownloaderJobState,
    message: nullableString(object, "message"),
    progress:
      rawProgress === null || rawProgress === undefined
        ? null
        : parseProgress(rawProgress),
    createdAtMs: requiredNumber(object, "created_ms"),
    updatedAtMs: requiredNumber(object, "updated_ms"),
  };
}

function parseProgress(value: unknown): DownloaderProgress {
  const object = requiredObject(value);
  return {
    chapterTotal: requiredNumber(object, "chapter_total"),
    savedChapters: requiredNumber(object, "saved_chapters"),
    groupTotal: requiredNumber(object, "group_total"),
    groupDone: requiredNumber(object, "group_done"),
    savePhase: nullableString(object, "save_phase"),
  };
}

function parseLibraryItem(value: unknown): DownloaderLibraryItem {
  const object = requiredObject(value);
  const kind = requiredString(object, "kind");
  if (kind !== "file" && kind !== "dir") invalidField("kind");
  return {
    kind,
    name: requiredString(object, "name"),
    relativePath: requiredString(object, "rel_path"),
    extension: requiredString(object, "ext"),
    sizeBytes: requiredNumber(object, "size"),
    modifiedAtMs: nullableNumber(object, "modified_ms"),
  };
}

function invalidField(key: string): never {
  throw new TomatoDownloaderClientError(
    "INVALID_RESPONSE",
    `Downloader returned an invalid ${key} field`,
  );
}

function encodeRelativePath(relativePath: string): string {
  const segments = relativePath.replaceAll("\\", "/").split("/");
  if (
    segments.length === 0 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TomatoDownloaderClientError(
      "INVALID_RESPONSE",
      "Downloader returned an invalid artifact path",
    );
  }
  return segments.map(encodeURIComponent).join("/");
}

function headerString(headers: unknown, key: string): string | null {
  if (typeof headers !== "object" || headers === null) return null;
  if ("get" in headers && typeof headers.get === "function") {
    const received = headers.get(key);
    if (typeof received === "string") return received;
  }
  const value = (headers as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  return null;
}
