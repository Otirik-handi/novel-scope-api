import { BookDownloadStatus } from "@prisma/client";
import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import type { CrawlersService } from "../../src/crawlers/crawlers.service";
import { DownloadsRepository } from "../../src/downloads/downloads.repository";
import type { TomatoDownloaderClient } from "../../src/downloads/runners/fanqie/tomato-downloader/tomato-downloader.client";
import type { DownloaderJob } from "../../src/downloads/runners/fanqie/tomato-downloader/tomato-downloader.contract";
import { createE2eApplication, type E2eApplication } from "../setup-env";

const crawlersService: Pick<
  CrawlersService,
  "getRankingCatalog" | "getRankingCrawler" | "getBookCrawler"
> = {
  getRankingCatalog: () => {
    throw new Error("Unexpected crawler access in downloads E2E");
  },
  getRankingCrawler: () => {
    throw new Error("Unexpected crawler access in downloads E2E");
  },
  getBookCrawler: () => {
    throw new Error("Unexpected crawler access in downloads E2E");
  },
};

function createDownloaderFake() {
  let jobs: DownloaderJob[] = [];
  const unexpected = () => {
    throw new Error("Unexpected Downloader access in downloads E2E");
  };
  const client = {
    getStatus: jest.fn().mockResolvedValue({
      version: "2.4.13",
      locked: false,
      saveDirectory: "test",
    }),
    getConfig: jest.fn().mockResolvedValue({
      useOfficialApi: true,
      novelFormat: "txt",
      bulkFiles: false,
      enableSegmentComments: false,
      enableAudiobook: false,
      autoOpenDownloadedFiles: false,
      askFormatAfterDownload: false,
      preferredBookNameField: "book_name",
      allowOverwriteFiles: true,
    }),
    listJobs: jest.fn(async () => jobs),
    getJob: jest.fn(async (jobId: string) =>
      jobs.find((job) => job.id === jobId) ?? null,
    ),
    createJob: jest.fn(unexpected),
    cancelJob: jest.fn(unexpected),
    scanLibrary: jest.fn(unexpected),
    openArtifact: jest.fn(unexpected),
  };
  return {
    client: client as unknown as TomatoDownloaderClient,
    unexpectedCalls: [
      client.createJob,
      client.cancelJob,
      client.scanLibrary,
      client.openArtifact,
    ],
    setJobs(value: DownloaderJob[]) {
      jobs = value;
    },
  };
}

describe("Downloads API (e2e)", () => {
  let context: E2eApplication | undefined;
  let repository: DownloadsRepository;
  const downloader = createDownloaderFake();

  beforeAll(async () => {
    context = await createE2eApplication(crawlersService, {
      tomatoDownloaderClient: downloader.client,
    });
    repository = context.app.get(DownloadsRepository);
  });

  beforeEach(async () => {
    downloader.setJobs([]);
    for (const call of downloader.unexpectedCalls) call.mockClear();
    await clean();
  });
  afterEach(async () => {
    await clean();
    for (const call of downloader.unexpectedCalls) {
      expect(call).not.toHaveBeenCalled();
    }
  });
  afterAll(async () => context?.close());

  function requireContext(): E2eApplication {
    if (!context) throw new Error("Downloads E2E application was not initialized");
    return context;
  }

  async function clean(): Promise<void> {
    if (!context) return;
    await context.prisma.bookDownload.deleteMany();
    await context.prisma.book.deleteMany({ where: { platform: "fanqie" } });
    for (const name of await readdir(context.artifactDirectory)) {
      await rm(join(context.artifactDirectory, name), {
        recursive: true,
        force: true,
      });
    }
  }

  async function restartApplication(): Promise<void> {
    await requireContext().close();
    context = await createE2eApplication(crawlersService, {
      tomatoDownloaderClient: downloader.client,
    });
    repository = context.app.get(DownloadsRepository);
  }

  async function seedRunningTask(downstreamJobId: string) {
    const book = await requireContext().prisma.book.upsert({
      where: {
        platform_externalBookId: {
          platform: "fanqie",
          externalBookId: "7069948840148732967",
        },
      },
      create: {
        platform: "fanqie",
        externalBookId: "7069948840148732967",
      },
      update: {},
    });
    return requireContext().prisma.bookDownload.create({
      data: {
        bookId: book.id,
        status: BookDownloadStatus.RUNNING,
        downstreamJobId,
        startedAt: new Date(),
      },
    });
  }

  async function waitForProgress(id: string): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const stored = await requireContext().prisma.bookDownload.findUnique({
        where: { id },
      });
      if (
        typeof stored?.progress === "object" &&
        stored.progress !== null &&
        "savedChapters" in stored.progress
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Worker did not reconnect to the downstream job");
  }

  async function createDownload(body: Record<string, unknown> = {}) {
    return request(requireContext().app.getHttpServer())
      .post("/v1/books/fanqie/7069948840148732967/downloads")
      .send(body)
      .expect(202);
  }

  it("claims persisted tasks in FIFO order through the real repository", async () => {
    const first = await repository.createQueued("7069948840148732967", null);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await repository.createQueued("7069948840148732968", {
      startChapter: 2,
      endChapter: 3,
    });

    const claimed = await repository.claimNextQueued(new Date());
    expect(claimed?.id).toBe(first.id);
    await expect(repository.findById(second.id)).resolves.toMatchObject({
      status: BookDownloadStatus.QUEUED,
    });
  });

  it("reconnects a persisted RUNNING task to its existing job after restart", async () => {
    const running = await seedRunningTask("42");
    downloader.setJobs([
      {
        id: "42",
        bookId: "7069948840148732967",
        title: "书",
        author: null,
        state: "running",
        message: null,
        progress: {
          chapterTotal: 2,
          savedChapters: 1,
          groupTotal: 1,
          groupDone: 0,
          savePhase: "x",
        },
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      },
    ]);

    await restartApplication();
    await waitForProgress(running.id);

    await expect(repository.findById(running.id)).resolves.toMatchObject({
      status: BookDownloadStatus.RUNNING,
      downstreamJobId: "42",
      progress: { savedChapters: 1 },
    });
    expect(
      (downloader.client as unknown as { getJob: jest.Mock }).getJob,
    ).toHaveBeenCalledWith("42");
  });

  it("marks a RUNNING task failed when its persisted job is missing after restart", async () => {
    const running = await seedRunningTask("missing");

    await restartApplication();

    await expect(repository.findById(running.id)).resolves.toMatchObject({
      status: BookDownloadStatus.FAILED,
      errorCode: "DOWNSTREAM_TASK_LOST",
      errorMessage: "Downloader task was lost",
    });
  });

  it("creates and queries a persisted range task", async () => {
    const created = await createDownload({ startChapter: 20, endChapter: 30 });
    expect(created.body).toMatchObject({
      platform: "fanqie",
      externalBookId: "7069948840148732967",
      format: "txt",
      range: { startChapter: 20, endChapter: 30 },
      status: "queued",
      artifact: null,
      error: null,
    });

    const response = await request(requireContext().app.getHttpServer())
      .get(`/v1/downloads/${created.body.id}`)
      .expect(200);
    expect(response.body).toMatchObject({ id: created.body.id, status: "queued" });
    await expect(
      requireContext().prisma.bookDownload.findUnique({
        where: { id: created.body.id },
      }),
    ).resolves.toMatchObject({ startChapter: 20, endChapter: 30 });
  });

  it.each([
    { startChapter: 1 },
    { endChapter: 1 },
    { startChapter: 0, endChapter: 1 },
    { startChapter: 2, endChapter: 1 },
    { startChapter: 1.5, endChapter: 2 },
  ])("returns 400 for an invalid range %p", async (body) => {
    await request(requireContext().app.getHttpServer())
      .post("/v1/books/fanqie/7069948840148732967/downloads")
      .send(body)
      .expect(400);
  });

  it("cancels and deletes a queued task", async () => {
    const created = await createDownload();
    await request(requireContext().app.getHttpServer())
      .post(`/v1/downloads/${created.body.id}/cancel`)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe("canceled"));
    await request(requireContext().app.getHttpServer())
      .delete(`/v1/downloads/${created.body.id}`)
      .expect(204);
    await request(requireContext().app.getHttpServer())
      .get(`/v1/downloads/${created.body.id}`)
      .expect(404);
  });

  it("returns 409 when downloading or deleting an active task", async () => {
    const created = await createDownload();
    await request(requireContext().app.getHttpServer())
      .get(`/v1/downloads/${created.body.id}/file`)
      .expect(409);
    await request(requireContext().app.getHttpServer())
      .delete(`/v1/downloads/${created.body.id}`)
      .expect(409);
  });

  it("streams an artifact and deletes it with the terminal record", async () => {
    const created = await createDownload();
    const text = "x";
    const artifactPath = `${created.body.id}.txt`;
    await writeFile(
      join(requireContext().artifactDirectory, artifactPath),
      text,
      "utf8",
    );
    await requireContext().prisma.bookDownload.update({
      where: { id: created.body.id },
      data: {
        status: BookDownloadStatus.SUCCEEDED,
        artifactPath,
        artifactFilename: "测试小说.txt",
        artifactSizeBytes: Buffer.byteLength(text),
        artifactSha256: "test-sha256",
        finishedAt: new Date(),
      },
    });

    const status = await request(requireContext().app.getHttpServer())
      .get(`/v1/downloads/${created.body.id}`)
      .expect(200);
    expect(status.body.artifact).toMatchObject({
      filename: "测试小说.txt",
      sizeBytes: Buffer.byteLength(text),
      sha256: "test-sha256",
      downloadUrl: `/v1/downloads/${created.body.id}/file`,
    });

    const file = await request(requireContext().app.getHttpServer())
      .get(`/v1/downloads/${created.body.id}/file`)
      .expect("Content-Type", /text\/plain/)
      .expect(200);
    expect(file.text).toBe(text);

    await request(requireContext().app.getHttpServer())
      .delete(`/v1/downloads/${created.body.id}`)
      .expect(204);
    await expect(
      requireContext().prisma.bookDownload.findUnique({
        where: { id: created.body.id },
      }),
    ).resolves.toBeNull();
  });

  it("returns 410 when successful artifact metadata points to a missing file", async () => {
    const created = await createDownload();
    await requireContext().prisma.bookDownload.update({
      where: { id: created.body.id },
      data: {
        status: BookDownloadStatus.SUCCEEDED,
        artifactPath: `${created.body.id}.txt`,
        artifactFilename: "测试小说.txt",
        artifactSizeBytes: 100,
        artifactSha256: "missing",
        finishedAt: new Date(),
      },
    });

    await request(requireContext().app.getHttpServer())
      .get(`/v1/downloads/${created.body.id}/file`)
      .expect(410);
  });
});
