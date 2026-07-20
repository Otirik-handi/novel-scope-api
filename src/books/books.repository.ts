import { Injectable } from "@nestjs/common";
import type { BookDetail, Prisma } from "@prisma/client";
import type {
  CrawledBook,
  CrawlerJsonObject,
} from "../crawlers/interfaces";
import { PrismaService } from "../shared/database/prisma.service";
import type { Platform } from "../shared/types/platform.type";
import type { StoredBookDetail } from "./interfaces/book.interface";

@Injectable()
export class BooksRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findDetail(
    platform: Platform,
    externalBookId: string,
  ): Promise<StoredBookDetail | null> {
    const book = await this.prisma.book.findUnique({
      where: {
        platform_externalBookId: { platform, externalBookId },
      },
      include: { detail: true },
    });

    if (book === null || book.detail === null) {
      return null;
    }

    return this.toStoredDetail(
      book.id,
      book.platform as Platform,
      book.externalBookId,
      book.detail,
    );
  }

  upsertDetail(
    crawledBook: CrawledBook,
    expiresAt: Date,
  ): Promise<StoredBookDetail> {
    return this.prisma.$transaction(async (transaction) => {
      const book = await transaction.book.upsert({
        where: {
          platform_externalBookId: {
            platform: crawledBook.platform,
            externalBookId: crawledBook.externalBookId,
          },
        },
        create: {
          platform: crawledBook.platform,
          externalBookId: crawledBook.externalBookId,
        },
        update: {},
        select: { id: true, platform: true, externalBookId: true },
      });
      const detailData = this.detailData(crawledBook, expiresAt);
      const detail = await transaction.bookDetail.upsert({
        where: { bookId: book.id },
        create: { bookId: book.id, ...detailData },
        update: detailData,
      });

      return this.toStoredDetail(
        book.id,
        book.platform as Platform,
        book.externalBookId,
        detail,
      );
    });
  }

  private detailData(
    crawledBook: CrawledBook,
    expiresAt: Date,
  ): Prisma.BookDetailUncheckedCreateWithoutBookInput {
    return {
      title: crawledBook.title,
      author: crawledBook.author,
      description: crawledBook.description,
      coverUrl: crawledBook.coverUrl,
      genres: crawledBook.genres,
      bookStatus: crawledBook.bookStatus,
      wordCount: crawledBook.wordCount,
      metadata: crawledBook.metadata as Prisma.InputJsonValue,
      sourceUrl: crawledBook.sourceUrl,
      fetchedAt: crawledBook.fetchedAt,
      expiresAt,
    };
  }

  private toStoredDetail(
    bookId: string,
    platform: Platform,
    externalBookId: string,
    detail: BookDetail,
  ): StoredBookDetail {
    return {
      bookId,
      platform,
      externalBookId,
      title: detail.title,
      author: detail.author,
      description: detail.description,
      coverUrl: detail.coverUrl,
      genres: detail.genres,
      bookStatus: detail.bookStatus,
      wordCount: detail.wordCount,
      metadata: detail.metadata as CrawlerJsonObject,
      sourceUrl: detail.sourceUrl,
      fetchedAt: detail.fetchedAt,
      expiresAt: detail.expiresAt,
    };
  }
}
