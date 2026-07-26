import { Readable } from "node:stream";
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import {
  TomatoDownloaderClient,
  TomatoDownloaderClientError,
} from "./tomato-downloader.client";

function response(
  config: AxiosRequestConfig,
  data: unknown,
  status = 200,
  headers: Record<string, string> = { "content-type": "application/json" },
): AxiosResponse {
  return { config: config as never, data, status, statusText: "OK", headers };
}

function createAdapter(handler: (config: AxiosRequestConfig) => AxiosResponse | Promise<AxiosResponse>) {
  const requests: AxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    requests.push(config);
    return handler(config);
  };
  return { adapter, requests };
}

function createClient(adapter: AxiosAdapter, password: string | null = null) {
  return new TomatoDownloaderClient({
    adapter,
    baseUrl: "http://127.0.0.1:18423",
    password,
    requestTimeoutMs: 10_000,
  });
}

describe("TomatoDownloaderClient", () => {
  it("reads and normalizes status with the password header", async () => {
    const { adapter, requests } = createAdapter((config) =>
      response(config, {
        version: "2.4.13",
        bind_addr: "127.0.0.1:18423",
        locked: true,
        save_dir: "C:/downloads",
      }),
    );

    await expect(createClient(adapter, "secret").getStatus()).resolves.toEqual({
      version: "2.4.13",
      locked: true,
      saveDirectory: "C:/downloads",
    });
    expect(requests[0]).toMatchObject({
      method: "get",
      url: "/api/status",
      maxRedirects: 0,
      timeout: 10_000,
    });
    expect(requests[0]?.headers).toMatchObject({
      "x-tomato-password": "secret",
    });
  });

  it("normalizes the full configuration contract", async () => {
    const { adapter } = createAdapter((config) =>
      response(config, {
        use_official_api: true,
        novel_format: "txt",
        bulk_files: false,
        enable_segment_comments: false,
        enable_audiobook: false,
        auto_open_downloaded_files: false,
        ask_format_after_download: false,
        preferred_book_name_field: "book_name",
        allow_overwrite_files: true,
      }),
    );

    await expect(createClient(adapter).getConfig()).resolves.toEqual({
      useOfficialApi: true,
      novelFormat: "txt",
      bulkFiles: false,
      enableSegmentComments: false,
      enableAudiobook: false,
      autoOpenDownloadedFiles: false,
      askFormatAfterDownload: false,
      preferredBookNameField: "book_name",
      allowOverwriteFiles: true,
    });
  });

  it("creates a ranged job and normalizes its string id", async () => {
    const { adapter, requests } = createAdapter((config) =>
      response(config, { id: 42, book_id: "7069948840148732967", state: "queued" }),
    );

    await expect(
      createClient(adapter).createJob("7069948840148732967", {
        startChapter: 20,
        endChapter: 30,
      }),
    ).resolves.toEqual({ id: "42" });
    expect(JSON.parse(String(requests[0]?.data))).toEqual({
      book_id: "7069948840148732967",
      range_start: 20,
      range_end: 30,
    });
  });

  it("normalizes job progress and returns null for a missing job", async () => {
    const { adapter } = createAdapter((config) =>
      response(config, {
        items: config.url?.includes("id=2")
          ? []
          : [
              {
                id: 1,
                book_id: "7069948840148732967",
                title: "测试小说",
                state: "running",
                created_ms: 1000,
                updated_ms: 2000,
                progress: {
                  chapter_total: 10,
                  saved_chapters: 3,
                  group_total: 2,
                  group_done: 1,
                  save_phase: "Downloading",
                },
              },
            ],
      }),
    );

    await expect(createClient(adapter).getJob("1")).resolves.toMatchObject({
      id: "1",
      title: "测试小说",
      state: "running",
      progress: {
        chapterTotal: 10,
        savedChapters: 3,
        groupTotal: 2,
        groupDone: 1,
        savePhase: "Downloading",
      },
    });
    await expect(createClient(adapter).getJob("2")).resolves.toBeNull();
  });

  it("scans the library until complete and opens a TXT stream", async () => {
    const { adapter } = createAdapter((config) => {
      if (config.url?.startsWith("/api/library")) {
        return response(config, {
          running: false,
          items: [
            {
              kind: "file",
              name: "测试小说.txt",
              rel_path: "测试小说.txt",
              ext: "txt",
              size: 123,
              modified_ms: 456,
            },
          ],
        });
      }
      return response(
        config,
        Readable.from([Buffer.from("正文")]),
        200,
        { "content-type": "text/plain; charset=utf-8" },
      );
    });

    await expect(createClient(adapter).scanLibrary(true)).resolves.toEqual({
      running: false,
      items: [
        {
          kind: "file",
          name: "测试小说.txt",
          relativePath: "测试小说.txt",
          extension: "txt",
          sizeBytes: 123,
          modifiedAtMs: 456,
        },
      ],
    });
    const artifact = await createClient(adapter).openArtifact("测试小说.txt");
    expect(artifact.contentType).toBe("text/plain; charset=utf-8");
    expect(artifact.stream).toBeInstanceOf(Readable);
  });

  it("rejects a JSON endpoint with the wrong Content-Type", async () => {
    const { adapter } = createAdapter((config) =>
      response(
        config,
        { version: "2.4.13", locked: false, save_dir: "C:/downloads" },
        200,
        { "content-type": "text/html" },
      ),
    );

    await expect(createClient(adapter).getStatus()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("rejects malformed responses with a stable safe error", async () => {
    const { adapter } = createAdapter((config) => response(config, { version: 2413 }));

    await expect(createClient(adapter).getStatus()).rejects.toMatchObject({
      name: "TomatoDownloaderClientError",
      code: "INVALID_RESPONSE",
    });
  });

  it("does not expose a password from Axios failures", async () => {
    const adapter: AxiosAdapter = async (config) => {
      throw new AxiosError(
        "request failed with secret-password",
        "ECONNREFUSED",
        config,
      );
    };

    const error = await createClient(adapter, "secret-password")
      .getStatus()
      .catch((received: unknown) => received);

    expect(error).toBeInstanceOf(TomatoDownloaderClientError);
    expect(JSON.stringify(error)).not.toContain("secret-password");
    expect((error as Error).message).not.toContain("secret-password");
  });
});
