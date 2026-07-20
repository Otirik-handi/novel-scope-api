import request from "supertest";
import { BooksRepository } from "../../src/books/books.repository";
import type {
  BookCrawler,
  CrawledBook,
} from "../../src/crawlers/interfaces";
import type { CrawlersService } from "../../src/crawlers/crawlers.service";
import {
  createE2eApplication,
  type E2eApplication,
} from "../setup-env";

describe("Books API (e2e)", () => {
  const crawlBook: jest.MockedFunction<BookCrawler["crawl"]> = jest.fn();
  const crawlersService: Pick<
    CrawlersService,
    "getRankingCrawler" | "getBookCrawler"
  > = {
    getRankingCrawler: () => {
      throw new Error("Unexpected ranking crawler access in books E2E");
    },
    getBookCrawler: (platform) => {
      if (platform !== "qidian") {
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
    await cleanQidianData();
  });

  afterEach(async () => {
    await cleanQidianData();
  });

  afterAll(async () => {
    await context?.close();
  });

  async function cleanQidianData(): Promise<void> {
    if (context === undefined) {
      return;
    }

    await context.prisma.rankingSnapshot.deleteMany({
      where: { platform: "qidian" },
    });
    await context.prisma.book.deleteMany({
      where: { platform: "qidian" },
    });
  }

  function requireContext(): E2eApplication {
    if (context === undefined) {
      throw new Error("Books E2E application was not initialized");
    }

    return context;
  }

  function makeBook(
    externalBookId: string,
    overrides: Partial<CrawledBook> = {},
  ): CrawledBook {
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

  async function seedDetail(
    externalBookId: string,
    expiresAt: Date,
    overrides: Partial<CrawledBook> = {},
  ) {
    return repository.upsertDetail(
      makeBook(externalBookId, overrides),
      expiresAt,
    );
  }

  it.each([
    "/v1/books/unknown/1031940621",
    "/v1/books/qidian/not-a-number",
  ])("returns 400 for invalid route parameters: %s", async (path) => {
    await request(requireContext().app.getHttpServer()).get(path).expect(400);
    expect(crawlBook).not.toHaveBeenCalled();
  });

  it("serves a fresh cached detail without crawling", async () => {
    const externalBookId = "9900010001";
    const stored = await seedDetail(
      externalBookId,
      new Date(Date.now() + 60_000),
    );

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
    await seedDetail(
      externalBookId,
      new Date(Date.now() - 60_000),
      {
        title: "旧标题",
        fetchedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
      },
    );
    crawlBook.mockResolvedValueOnce(
      makeBook(externalBookId, { title: "刷新后的标题" }),
    );

    const response = await request(requireContext().app.getHttpServer())
      .get(`/v1/books/qidian/${externalBookId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      externalBookId,
      title: "刷新后的标题",
      stale: false,
    });
    await expect(
      repository.findDetail("qidian", externalBookId),
    ).resolves.toMatchObject({ title: "刷新后的标题" });
  });

  it("returns an unchanged expired detail as stale when refresh fails", async () => {
    const externalBookId = "9900010004";
    const oldFetchedAt = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const stored = await seedDetail(
      externalBookId,
      new Date(Date.now() - 60_000),
      { title: "保留的旧标题", fetchedAt: oldFetchedAt },
    );
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
    expect(JSON.stringify(response.body)).not.toContain(
      "private crawler failure",
    );
    await expect(
      repository.findDetail("qidian", externalBookId),
    ).resolves.toMatchObject({
      title: "保留的旧标题",
      fetchedAt: oldFetchedAt,
      expiresAt: stored.expiresAt,
    });
  });

  it("returns a safe 502 when the first crawl fails", async () => {
    const externalBookId = "9900010005";
    crawlBook.mockRejectedValueOnce(
      new Error("axios failed with private-upstream-token"),
    );

    const response = await request(requireContext().app.getHttpServer())
      .get(`/v1/books/qidian/${externalBookId}`)
      .expect(502);

    expect(response.body).toMatchObject({
      statusCode: 502,
      message: "Failed to fetch book detail",
    });
    expect(JSON.stringify(response.body)).not.toContain(
      "private-upstream-token",
    );
    await expect(
      requireContext().prisma.book.count({
        where: { platform: "qidian", externalBookId },
      }),
    ).resolves.toBe(0);
  });
});
