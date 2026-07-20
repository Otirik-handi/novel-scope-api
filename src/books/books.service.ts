import { Inject, Injectable, Logger } from "@nestjs/common";
import { type ConfigType } from "@nestjs/config";
import appConfig from "../config/app.config";
import { CrawlersService } from "../crawlers/crawlers.service";
import type { CrawledBook } from "../crawlers/interfaces";
import type { Platform } from "../shared/types/platform.type";
import type {
  BookDetailResource,
  BooksClock,
  StoredBookDetail,
} from "./interfaces/book.interface";
import { BooksRepository } from "./books.repository";

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

export const BOOKS_CLOCK = Symbol("BOOKS_CLOCK");
export const BOOK_REFRESH_FAILED = "Failed to fetch book detail";

export class BookRefreshError extends Error {
  override readonly name = "BookRefreshError";

  constructor(cause: unknown) {
    super(BOOK_REFRESH_FAILED, { cause });
  }
}

@Injectable()
export class BooksService {
  private readonly logger = new Logger(BooksService.name);
  private readonly ttlMilliseconds: number;

  constructor(
    private readonly repository: BooksRepository,
    private readonly crawlersService: CrawlersService,
    @Inject(appConfig.KEY)
    config: ConfigType<typeof appConfig>,
    @Inject(BOOKS_CLOCK) private readonly clock: BooksClock,
  ) {
    this.ttlMilliseconds = config.bookDetailTtlHours * MILLISECONDS_PER_HOUR;

    if (!Number.isSafeInteger(this.ttlMilliseconds)) {
      throw new Error("BOOK_DETAIL_TTL_HOURS is too large");
    }
  }

  async getDetail(
    platform: Platform,
    externalBookId: string,
  ): Promise<BookDetailResource> {
    const stored = await this.repository.findDetail(platform, externalBookId);

    if (stored !== null && this.isFresh(stored)) {
      return { ...stored, stale: false };
    }

    try {
      const crawler = this.crawlersService.getBookCrawler(platform);
      const crawled = await crawler.crawl(externalBookId);
      this.assertValidCrawledBook(crawled, platform, externalBookId);
      const expiresAt = this.calculateExpiresAt(crawled.fetchedAt);
      const saved = await this.repository.upsertDetail(crawled, expiresAt);

      return { ...saved, stale: false };
    } catch (error) {
      if (stored !== null) {
        this.logger.error(
          `Failed to refresh book ${platform}/${externalBookId}; serving stale detail`,
          error instanceof Error ? error.stack : undefined,
        );
        return { ...stored, stale: true };
      }

      this.logger.error(
        `Failed to fetch book ${platform}/${externalBookId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BookRefreshError(error);
    }
  }

  private isFresh(detail: StoredBookDetail): boolean {
    return detail.expiresAt.getTime() > this.clock.now().getTime();
  }

  private calculateExpiresAt(fetchedAt: Date): Date {
    const expiresAtMilliseconds =
      fetchedAt.getTime() + this.ttlMilliseconds;
    const expiresAt = new Date(expiresAtMilliseconds);

    if (
      !Number.isFinite(fetchedAt.getTime()) ||
      Number.isNaN(expiresAt.getTime())
    ) {
      throw new Error("Cannot calculate book detail expiration");
    }

    return expiresAt;
  }

  private assertValidCrawledBook(
    crawledBook: CrawledBook,
    platform: Platform,
    externalBookId: string,
  ): void {
    if (
      crawledBook.platform !== platform ||
      crawledBook.externalBookId !== externalBookId
    ) {
      throw new Error("Crawler returned a different book");
    }

    if (
      typeof crawledBook.title !== "string" ||
      crawledBook.title.trim() === "" ||
      typeof crawledBook.author !== "string" ||
      crawledBook.author.trim() === "" ||
      typeof crawledBook.sourceUrl !== "string" ||
      crawledBook.sourceUrl.trim() === ""
    ) {
      throw new Error("Crawler returned an incomplete book detail");
    }

    if (
      !(crawledBook.fetchedAt instanceof Date) ||
      !Number.isFinite(crawledBook.fetchedAt.getTime())
    ) {
      throw new Error("Crawler returned an invalid fetch time");
    }

    let sourceUrl: URL;

    try {
      sourceUrl = new URL(crawledBook.sourceUrl);
    } catch {
      throw new Error("Crawler returned an invalid source URL");
    }

    if (
      (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:") ||
      sourceUrl.username !== "" ||
      sourceUrl.password !== ""
    ) {
      throw new Error("Crawler returned an invalid source URL");
    }
  }
}
