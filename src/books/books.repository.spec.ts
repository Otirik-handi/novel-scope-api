import type { PrismaService } from "../shared/database/prisma.service";
import type { CrawledBook } from "../crawlers/interfaces";
import { BooksRepository } from "./books.repository";

const crawledBook: CrawledBook = {
  platform: "qidian",
  externalBookId: "1031940621",
  title: "测试作品",
  author: "测试作者",
  description: "测试简介",
  coverUrl: null,
  genres: ["玄幻"],
  bookStatus: "连载",
  wordCount: 123_456,
  metadata: { recommendationCount: 1234 },
  sourceUrl: "https://www.qidian.com/book/1031940621/",
  fetchedAt: new Date("2026-07-20T12:00:00.000Z"),
};

describe("BooksRepository", () => {
  it("finds one detail by platform and external book ID", async () => {
    const detail = {
      bookId: "book-1",
      title: crawledBook.title,
      author: crawledBook.author,
      description: crawledBook.description,
      coverUrl: crawledBook.coverUrl,
      genres: crawledBook.genres,
      bookStatus: crawledBook.bookStatus,
      wordCount: crawledBook.wordCount,
      metadata: crawledBook.metadata,
      sourceUrl: crawledBook.sourceUrl,
      fetchedAt: crawledBook.fetchedAt,
      expiresAt: new Date("2026-07-20T15:00:00.000Z"),
    };
    const findUnique = jest.fn().mockResolvedValue({
      id: "book-1",
      platform: "qidian",
      externalBookId: "1031940621",
      detail,
    });
    const repository = new BooksRepository({
      book: { findUnique },
    } as unknown as PrismaService);

    await expect(
      repository.findDetail("qidian", "1031940621"),
    ).resolves.toEqual({
      ...crawledBook,
      bookId: "book-1",
      expiresAt: detail.expiresAt,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        platform_externalBookId: {
          platform: "qidian",
          externalBookId: "1031940621",
        },
      },
      include: { detail: true },
    });
  });

  it.each([null, { id: "book-1", detail: null }])(
    "returns null when no complete stored detail exists (%p)",
    async (stored) => {
      const repository = new BooksRepository({
        book: { findUnique: jest.fn().mockResolvedValue(stored) },
      } as unknown as PrismaService);

      await expect(
        repository.findDetail("qidian", "1031940621"),
      ).resolves.toBeNull();
    },
  );

  it("atomically upserts the Book and its latest BookDetail", async () => {
    const expiresAt = new Date("2026-07-20T15:00:00.000Z");
    const bookUpsert = jest.fn().mockResolvedValue({
      id: "book-1",
      platform: "qidian",
      externalBookId: "1031940621",
    });
    const detailUpsert = jest.fn().mockResolvedValue({
      bookId: "book-1",
      title: crawledBook.title,
      author: crawledBook.author,
      description: crawledBook.description,
      coverUrl: crawledBook.coverUrl,
      genres: crawledBook.genres,
      bookStatus: crawledBook.bookStatus,
      wordCount: crawledBook.wordCount,
      metadata: crawledBook.metadata,
      sourceUrl: crawledBook.sourceUrl,
      fetchedAt: crawledBook.fetchedAt,
      expiresAt,
    });
    const transactionClient = {
      book: { upsert: bookUpsert },
      bookDetail: { upsert: detailUpsert },
    };
    const transaction = jest.fn(async (callback) =>
      callback(transactionClient),
    );
    const repository = new BooksRepository({
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(
      repository.upsertDetail(crawledBook, expiresAt),
    ).resolves.toEqual({
      ...crawledBook,
      bookId: "book-1",
      expiresAt,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(bookUpsert).toHaveBeenCalledWith({
      where: {
        platform_externalBookId: {
          platform: "qidian",
          externalBookId: "1031940621",
        },
      },
      create: { platform: "qidian", externalBookId: "1031940621" },
      update: {},
      select: { id: true, platform: true, externalBookId: true },
    });
    const expectedDetailData = {
      title: crawledBook.title,
      author: crawledBook.author,
      description: crawledBook.description,
      coverUrl: crawledBook.coverUrl,
      genres: crawledBook.genres,
      bookStatus: crawledBook.bookStatus,
      wordCount: crawledBook.wordCount,
      metadata: crawledBook.metadata,
      sourceUrl: crawledBook.sourceUrl,
      fetchedAt: crawledBook.fetchedAt,
      expiresAt,
    };
    expect(detailUpsert).toHaveBeenCalledWith({
      where: { bookId: "book-1" },
      create: { bookId: "book-1", ...expectedDetailData },
      update: expectedDetailData,
    });
  });
});
