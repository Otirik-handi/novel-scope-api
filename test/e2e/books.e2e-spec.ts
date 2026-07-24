import request from "supertest";
import { BooksRepository } from "../../src/books/books.repository";
import type { BookCrawler, CrawledBook } from "../../src/crawlers/interfaces";
import type { CrawlersService } from "../../src/crawlers/crawlers.service";
import { createE2eApplication, type E2eApplication } from "../setup-env";

describe("Books API (e2e)", () => {
  const crawlBook: jest.MockedFunction<BookCrawler["crawl"]> = jest.fn();
  const crawlersService: Pick<
    CrawlersService,
    "getRankingCatalog" | "getRankingCrawler" | "getBookCrawler"
  > = {
    getRankingCatalog: () => {
      throw new Error("Unexpected ranking catalog access in books E2E");
    },
    getRankingCrawler: () => {
      throw new Error("Unexpected ranking crawler access in books E2E");
    },
    getBookCrawler: (platform) => {
      if (platform !== "qidian" && platform !== "fanqie") {
        throw new Error(`Unexpected book platform: ${String(platform)}`);
      }
      return { crawl: crawlBook };
    },
  };
  let context: E2eApplication | undefined;
  let repository: BooksRepository;

  beforeAll(async () => {
    const initializedContext = await createE2eApplication(crawlersService);
    context = initializedContext;
    repository = initializedContext.app.get(BooksRepository);
  });

  beforeEach(async () => {
    crawlBook.mockReset();
    crawlBook.mockRejectedValue(new Error("Unexpected book crawl"));
    await cleanBookData();
  });

  afterEach(async () => {
    await cleanBookData();
  });

  afterAll(async () => {
    await context?.close();
  });

  async function cleanBookData(): Promise<void> {
    if (context === undefined) {
      return;
    }

    await context.prisma.rankingSnapshot.deleteMany({
      where: { platform: { in: ["qidian", "fanqie"] } },
    });
    await context.prisma.book.deleteMany({
      where: { platform: { in: ["qidian", "fanqie"] } },
    });
  }

  function requireContext(): E2eApplication {
    if (context === undefined) {
      throw new Error("Books E2E application was not initialized");
    }

    return context;
  }

  function makeBook(externalBookId: string, overrides: Partial<CrawledBook> = {}): CrawledBook {
    return {
      platform: "qidian",
      externalBookId,
      title: `测试作品 ${externalBookId}`,
      author: "测试作者",
      description: "规范化后的作品简介",
      coverUrl: null,
      genres: ["玄幻", "东方玄幻"],
      bookStatus: "连载",
      wordCount: 123456,
      metadata: { score: 9.8 },
      sourceUrl: `https://www.qidian.com/book/${externalBookId}/`,
      fetchedAt: new Date(),
      ...overrides,
    };
  }

  function makeFanqieBook(
    externalBookId: string,
    overrides: Partial<CrawledBook> = {},
  ): CrawledBook {
    return makeBook(externalBookId, {
      platform: "fanqie",
      sourceUrl: `https://fanqienovel.com/page/${externalBookId}`,
      ...overrides,
    });
  }

  async function seedDetail(
    externalBookId: string,
    expiresAt: Date,
    overrides: Partial<CrawledBook> = {},
  ) {
    return repository.upsertDetail(makeBook(externalBookId, overrides), expiresAt);
  }

  async function seedFanqieDetail(
    externalBookId: string,
    expiresAt: Date,
    overrides: Partial<CrawledBook> = {},
  ) {
    return repository.upsertDetail(makeFanqieBook(externalBookId, overrides), expiresAt);
  }

  it.each(["/v1/books/unknown/1031940621", "/v1/books/qidian/not-a-number"])(
    "returns 400 for invalid route parameters: %s",
    async (path) => {
      await request(requireContext().app.getHttpServer()).get(path).expect(400);
      expect(crawlBook).not.toHaveBeenCalled();
    },
  );

  it("serves a fresh cached detail without crawling", async () => {
    const externalBookId = "9900010001";
    const stored = await seedDetail(externalBookId, new Date(Date.now() + 60_000));

    const response = await request(requireContext().app.getHttpServer())
      .get(`/v1/books/qidian/${externalBookId}`)
      .expect(200);

    expect(crawlBook).not.toHaveBeenCalled();
    expect(response.body).not.toHaveProperty("data");
    expect(response.body).toMatchObject({
      bookId: stored.bookId,
      externalBookId,
      title: stored.title,
      stale: false,
    });
  });

  it("crawls and persists a missing detail, then serves it from cache", async () => {
    const externalBookId = "9900010002";
    crawlBook.mockResolvedValueOnce(makeBook(externalBookId));

    const first = await request(requireContext().app.getHttpServer())
      .get(`/v1/books/qidian/${externalBookId}`)
      .expect(200);
    const second = await request(requireContext().app.getHttpServer())
      .get(`/v1/books/qidian/${externalBookId}`)
      .expect(200);

    expect(crawlBook).toHaveBeenCalledTimes(1);
    expect(crawlBook).toHaveBeenCalledWith(externalBookId);
    expect(first.body).toMatchObject({
      externalBookId,
      title: `测试作品 ${externalBookId}`,
      stale: false,
    });
    expect(second.body).toEqual(first.body);
    await expect(
      requireContext().prisma.bookDetail.count({
        where: { book: { platform: "qidian", externalBookId } },
      }),
    ).resolves.toBe(1);
  });

  it("refreshes and replaces an expired detail", async () => {
    const externalBookId = "9900010003";
    await seedDetail(externalBookId, new Date(Date.now() - 60_000), {
      title: "旧标题",
      fetchedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    });
    crawlBook.mockResolvedValueOnce(makeBook(externalBookId, { title: "刷新后的标题" }));

    const response = await request(requireContext().app.getHttpServer())
      .get(`/v1/books/qidian/${externalBookId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      externalBookId,
      title: "刷新后的标题",
      stale: false,
    });
    await expect(repository.findDetail("qidian", externalBookId)).resolves.toMatchObject({
      title: "刷新后的标题",
    });
  });

  it("returns an unchanged expired detail as stale when refresh fails", async () => {
    const externalBookId = "9900010004";
    const oldFetchedAt = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const stored = await seedDetail(externalBookId, new Date(Date.now() - 60_000), {
      title: "保留的旧标题",
      fetchedAt: oldFetchedAt,
    });
    crawlBook.mockRejectedValueOnce(new Error("private crawler failure"));

    const response = await request(requireContext().app.getHttpServer())
      .get(`/v1/books/qidian/${externalBookId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      bookId: stored.bookId,
      externalBookId,
      title: "保留的旧标题",
      stale: true,
    });
    expect(JSON.stringify(response.body)).not.toContain("private crawler failure");
    await expect(repository.findDetail("qidian", externalBookId)).resolves.toMatchObject({
      title: "保留的旧标题",
      fetchedAt: oldFetchedAt,
      expiresAt: stored.expiresAt,
    });
  });

  it("returns a safe 502 when the first crawl fails", async () => {
    const externalBookId = "9900010005";
    crawlBook.mockRejectedValueOnce(new Error("axios failed with private-upstream-token"));

    const response = await request(requireContext().app.getHttpServer())
      .get(`/v1/books/qidian/${externalBookId}`)
      .expect(502);

    expect(response.body).toMatchObject({
      statusCode: 502,
      message: "Failed to fetch book detail",
    });
    expect(JSON.stringify(response.body)).not.toContain("private-upstream-token");
    await expect(
      requireContext().prisma.book.count({
        where: { platform: "qidian", externalBookId },
      }),
    ).resolves.toBe(0);
  });

  it("collects a missing Fanqie detail and then serves the cached value", async () => {
    const externalBookId = "7621419029625834501";
    crawlBook.mockResolvedValueOnce(makeFanqieBook(externalBookId));

    const first = await request(requireContext().app.getHttpServer())
      .get(`/v1/books/fanqie/${externalBookId}`)
      .expect(200);
    const second = await request(requireContext().app.getHttpServer())
      .get(`/v1/books/fanqie/${externalBookId}`)
      .expect(200);

    expect(crawlBook).toHaveBeenCalledTimes(1);
    expect(first.body).toMatchObject({
      platform: "fanqie",
      externalBookId,
      stale: false,
    });
    expect(second.body).toEqual(first.body);
  });

  it("refreshes an expired Fanqie detail", async () => {
    const externalBookId = "7621419029625834502";
    await seedFanqieDetail(externalBookId, new Date(Date.now() - 60_000), {
      title: "番茄旧标题",
      fetchedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    });
    crawlBook.mockResolvedValueOnce(makeFanqieBook(externalBookId, { title: "番茄刷新标题" }));

    const response = await request(requireContext().app.getHttpServer())
      .get(`/v1/books/fanqie/${externalBookId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      platform: "fanqie",
      title: "番茄刷新标题",
      stale: false,
    });
    await expect(repository.findDetail("fanqie", externalBookId)).resolves.toMatchObject({
      title: "番茄刷新标题",
    });
  });

  it("serves an unchanged expired Fanqie detail as stale after failure", async () => {
    const externalBookId = "7621419029625834503";
    const oldFetchedAt = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const stored = await seedFanqieDetail(externalBookId, new Date(Date.now() - 60_000), {
      title: "番茄保留标题",
      fetchedAt: oldFetchedAt,
    });
    crawlBook.mockRejectedValueOnce(new Error("private fanqie failure"));

    const response = await request(requireContext().app.getHttpServer())
      .get(`/v1/books/fanqie/${externalBookId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      title: "番茄保留标题",
      stale: true,
    });
    expect(JSON.stringify(response.body)).not.toContain("private fanqie failure");
    await expect(repository.findDetail("fanqie", externalBookId)).resolves.toMatchObject({
      title: "番茄保留标题",
      fetchedAt: oldFetchedAt,
      expiresAt: stored.expiresAt,
    });
  });

  it("forces a successful Fanqie refresh even while the cache is fresh", async () => {
    const externalBookId = "7621419029625834504";
    await seedFanqieDetail(externalBookId, new Date(Date.now() + 60_000), {
      title: "番茄有效缓存",
    });
    crawlBook.mockResolvedValueOnce(
      makeFanqieBook(externalBookId, {
        title: "番茄强刷标题",
        fetchedAt: new Date(Date.now() + 1_000),
      }),
    );

    const response = await request(requireContext().app.getHttpServer())
      .post(`/v1/books/fanqie/${externalBookId}/refresh`)
      .expect(201);

    expect(crawlBook).toHaveBeenCalledWith(externalBookId);
    expect(response.body).toMatchObject({
      title: "番茄强刷标题",
      stale: false,
    });
  });

  it("returns a safe 502 for a failed forced Fanqie refresh and keeps the old row", async () => {
    const externalBookId = "7621419029625834505";
    const stored = await seedFanqieDetail(externalBookId, new Date(Date.now() + 60_000), {
      title: "番茄强刷前标题",
    });
    crawlBook.mockRejectedValueOnce(new Error("fanqie failure with private-token"));

    const response = await request(requireContext().app.getHttpServer())
      .post(`/v1/books/fanqie/${externalBookId}/refresh`)
      .expect(502);

    expect(response.body).toMatchObject({
      statusCode: 502,
      message: "Failed to fetch book detail",
    });
    expect(JSON.stringify(response.body)).not.toContain("private-token");
    await expect(repository.findDetail("fanqie", externalBookId)).resolves.toMatchObject({
      bookId: stored.bookId,
      title: "番茄强刷前标题",
      fetchedAt: stored.fetchedAt,
      expiresAt: stored.expiresAt,
    });
  });
});
