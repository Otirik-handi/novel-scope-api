import { Logger } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import appConfig from "../config/app.config";
import type { CrawlersService } from "../crawlers/crawlers.service";
import type { CrawledBook } from "../crawlers/interfaces";
import type { BooksRepository } from "./books.repository";
import {
  BOOK_REFRESH_FAILED,
  BookRefreshError,
  BooksService,
} from "./books.service";

const now = new Date("2026-07-20T12:30:00.000Z");

const crawledBook: CrawledBook = {
  platform: "qidian",
  externalBookId: "1031940621",
  title: "测试作品",
  author: "测试作者",
  description: "测试简介",
  coverUrl: "https://bookcover.yuewen.com/qdbimg/349573/1031940621/180.webp",
  genres: ["玄幻", "东方玄幻"],
  bookStatus: "连载",
  wordCount: 1_234_567,
  metadata: { recommendationCount: 1234 },
  sourceUrl: "https://www.qidian.com/book/1031940621/",
  fetchedAt: new Date("2026-07-20T12:00:00.000Z"),
};

const storedBook = {
  ...crawledBook,
  bookId: "1c22a340-ff4b-4c2d-a57c-207d75b4c72d",
  expiresAt: new Date("2026-07-20T15:00:00.000Z"),
};

const invalidCrawledBooks: Array<[string, CrawledBook]> = [
  [
    "a different platform",
    {
      ...crawledBook,
      platform: "other" as unknown as CrawledBook["platform"],
    },
  ],
  [
    "a different external book ID",
    { ...crawledBook, externalBookId: "9999999999" },
  ],
  ["a blank title", { ...crawledBook, title: "   " }],
  ["a blank author", { ...crawledBook, author: "\t" }],
  ["a blank source URL", { ...crawledBook, sourceUrl: "" }],
  ["an unparsable source URL", { ...crawledBook, sourceUrl: "not-a-url" }],
  [
    "a non-HTTP source URL",
    { ...crawledBook, sourceUrl: "ftp://www.qidian.com/book/1031940621/" },
  ],
  [
    "a credential-bearing source URL",
    {
      ...crawledBook,
      sourceUrl: "https://user:secret@www.qidian.com/book/1031940621/",
    },
  ],
  [
    "an invalid fetchedAt",
    { ...crawledBook, fetchedAt: new Date(Number.NaN) },
  ],
];

function expectSafeLog(
  loggerError: { mock: { calls: unknown[][] } },
  context: string,
): void {
  expect(loggerError.mock.calls.length).toBe(1);expect(loggerError.mock.calls.length).toBe(1);
    expect(loggerError.mock.calls[0][0]).toContain(context);    expect(loggerError.mock.calls[0][0]).toContain(context);
  const serialized = JSON.stringify(loggerError.mock.calls).toLowerCase();
  expect(serialized).not.toContain("secret");
  expect(serialized).not.toContain("token");
  expect(serialized).not.toContain("c:\\deploy");
}

function createSubject(currentTime = now) {
  const repository = {
    findDetail: jest.fn(),
    upsertDetail: jest.fn(),
  };
  const bookCrawler = { crawl: jest.fn() };
  const crawlersService = {
    getBookCrawler: jest.fn(() => bookCrawler),
  };
  const config = {
    bookDetailTtlHours: 3,
  } as ConfigType<typeof appConfig>;
  const clock = { now: jest.fn(() => currentTime) };

  return {
    service: new BooksService(
      repository as unknown as BooksRepository,
      crawlersService as unknown as CrawlersService,
      config,
      clock,
    ),
    repository,
    bookCrawler,
    crawlersService,
    clock,
  };
}

describe("BooksService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns an unexpired stored detail without selecting or calling a crawler", async () => {
    const { service, repository, crawlersService, bookCrawler } =
      createSubject();
    repository.findDetail.mockResolvedValue(storedBook);

    await expect(service.getDetail("qidian", "1031940621")).resolves.toEqual({
      ...storedBook,
      stale: false,
    });
    expect(repository.findDetail).toHaveBeenCalledWith(
      "qidian",
      "1031940621",
    );
    expect(crawlersService.getBookCrawler).not.toHaveBeenCalled();
    expect(bookCrawler.crawl).not.toHaveBeenCalled();
    expect(repository.upsertDetail).not.toHaveBeenCalled();
  });

  it("crawls and stores a detail when none exists", async () => {
    const { service, repository, crawlersService, bookCrawler } =
      createSubject();
    repository.findDetail.mockResolvedValue(null);
    bookCrawler.crawl.mockResolvedValue(crawledBook);
    repository.upsertDetail.mockResolvedValue(storedBook);

    await expect(service.getDetail("qidian", "1031940621")).resolves.toEqual({
      ...storedBook,
      stale: false,
    });
    expect(crawlersService.getBookCrawler).toHaveBeenCalledWith("qidian");
    expect(bookCrawler.crawl).toHaveBeenCalledWith("1031940621");
    expect(repository.upsertDetail).toHaveBeenCalledWith(
      crawledBook,
      new Date("2026-07-20T15:00:00.000Z"),
    );
  });

  it("refreshes a detail when now equals expiresAt", async () => {
    const expiredBook = {
      ...storedBook,
      title: "旧标题",
      expiresAt: now,
    };
    const { service, repository, bookCrawler } = createSubject(now);
    repository.findDetail.mockResolvedValue(expiredBook);
    bookCrawler.crawl.mockResolvedValue(crawledBook);
    repository.upsertDetail.mockResolvedValue(storedBook);

    await expect(service.getDetail("qidian", "1031940621")).resolves.toEqual({
      ...storedBook,
      stale: false,
    });
    expect(bookCrawler.crawl).toHaveBeenCalledWith("1031940621");
    expect(repository.upsertDetail).toHaveBeenCalledWith(
      crawledBook,
      new Date("2026-07-20T15:00:00.000Z"),
    );
  });

  it.each([
    new Error(
      "crawler failed with postgres://admin:secret@db/internal at C:\\deploy\\token.txt",
    ),
    "non-error crawler failure token=secret",
  ])(
    "returns the unchanged expired detail as stale when refresh throws %p",
    async (refreshError) => {
      const expiredBook = {
        ...storedBook,
        title: "最近一次成功标题",
        fetchedAt: new Date("2026-07-20T08:00:00.000Z"),
        expiresAt: new Date("2026-07-20T11:00:00.000Z"),
      };
      const originalBook = structuredClone(expiredBook);
      const { service, repository, bookCrawler } = createSubject();
      const loggerError = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation();
      repository.findDetail.mockResolvedValue(expiredBook);
      bookCrawler.crawl.mockRejectedValue(refreshError);

      const result = await service.getDetail("qidian", "1031940621");

      expect(result).toEqual({ ...originalBook, stale: true });
      expect(JSON.stringify(result)).not.toContain("secret");
      expect(expiredBook).toEqual(originalBook);
      expect(repository.upsertDetail).not.toHaveBeenCalled();
      expectSafeLog(
        loggerError,
        "Failed to refresh book qidian/1031940621; serving stale detail",
      );
    },
  );

  it("returns the unchanged expired detail when persistence refresh fails", async () => {
    const expiredBook = {
      ...storedBook,
      title: "最近一次成功标题",
      fetchedAt: new Date("2026-07-20T08:00:00.000Z"),
      expiresAt: new Date("2026-07-20T11:00:00.000Z"),
    };
    const originalBook = structuredClone(expiredBook);
    const { service, repository, bookCrawler } = createSubject();
    const loggerError = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation();
    repository.findDetail.mockResolvedValue(expiredBook);
    bookCrawler.crawl.mockResolvedValue(crawledBook);
    repository.upsertDetail.mockRejectedValue(
      new Error("transaction failed with token=secret at C:\\deploy\\db.log"),
    );

    await expect(
      service.getDetail("qidian", "1031940621"),
    ).resolves.toEqual({ ...originalBook, stale: true });
    expect(expiredBook).toEqual(originalBook);
    expect(repository.upsertDetail).toHaveBeenCalledTimes(1);
    expectSafeLog(
      loggerError,
      "Failed to refresh book qidian/1031940621; serving stale detail",
    );
  });

  it.each(invalidCrawledBooks)(
    "rejects a first crawl result with %s without persisting it",
    async (_reason, invalidBook) => {
      const { service, repository, bookCrawler } = createSubject();
      const loggerError = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation();
      repository.findDetail.mockResolvedValue(null);
      bookCrawler.crawl.mockResolvedValue(invalidBook);

      await expect(
        service.getDetail("qidian", "1031940621"),
      ).rejects.toMatchObject({
        name: "BookRefreshError",
        message: BOOK_REFRESH_FAILED,
      });
      expect(repository.upsertDetail).not.toHaveBeenCalled();
      expectSafeLog(
        loggerError,
        "Failed to fetch book qidian/1031940621",
      );
    },
  );

  it("serves the unchanged expired detail when the refreshed result is invalid", async () => {
    const expiredBook = {
      ...storedBook,
      title: "最近一次成功标题",
      fetchedAt: new Date("2026-07-20T08:00:00.000Z"),
      expiresAt: new Date("2026-07-20T11:00:00.000Z"),
    };
    const originalBook = structuredClone(expiredBook);
    const { service, repository, bookCrawler } = createSubject();
    const loggerError = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation();
    repository.findDetail.mockResolvedValue(expiredBook);
    bookCrawler.crawl.mockResolvedValue({
      ...crawledBook,
      externalBookId: "9999999999",
    });

    await expect(
      service.getDetail("qidian", "1031940621"),
    ).resolves.toEqual({ ...originalBook, stale: true });
    expect(expiredBook).toEqual(originalBook);
    expect(repository.upsertDetail).not.toHaveBeenCalled();
    expectSafeLog(
      loggerError,
      "Failed to refresh book qidian/1031940621; serving stale detail",
    );
  });

  it("propagates an initial database lookup failure without selecting a crawler", async () => {
    const lookupError = new Error("database lookup failed");
    const { service, repository, crawlersService, bookCrawler } =
      createSubject();
    repository.findDetail.mockRejectedValue(lookupError);

    await expect(
      service.getDetail("qidian", "1031940621"),
    ).rejects.toBe(lookupError);
    expect(crawlersService.getBookCrawler).not.toHaveBeenCalled();
    expect(bookCrawler.crawl).not.toHaveBeenCalled();
    expect(repository.upsertDetail).not.toHaveBeenCalled();
  });

  it.each([
    new Error("crawler failed with axios error at C:\\deploy\\crawler.log"),
    "non-error first crawl failure",
  ])(
    "propagates the first crawl failure %p without persisting a partial detail",
    async (refreshError) => {
      const { service, repository, bookCrawler } = createSubject();
      const loggerError = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation();
      repository.findDetail.mockResolvedValue(null);
      bookCrawler.crawl.mockRejectedValue(refreshError);

      await expect(
        service.getDetail("qidian", "1031940621"),
      ).rejects.toBeInstanceOf(BookRefreshError);
      expect(repository.upsertDetail).not.toHaveBeenCalled();
      expectSafeLog(
        loggerError,
        "Failed to fetch book qidian/1031940621",
      );
    },
  );
});
