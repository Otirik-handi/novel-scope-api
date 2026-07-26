import { BookDownloadStatus } from "@prisma/client";
import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import request from "supertest";
import type { CrawlersService } from "../../src/crawlers/crawlers.service";
import { DownloadsRepository } from "../../src/downloads/downloads.repository";
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

describe("Downloads API (e2e)", () => {
  let context: E2eApplication | undefined;
  let repository: DownloadsRepository;

  beforeAll(async () => {
    context = await createE2eApplication(crawlersService);
    repository = context.app.get(DownloadsRepository);
  });

  beforeEach(clean);
  afterEach(clean);
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
    const text = "第一章\n完整正文";
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
