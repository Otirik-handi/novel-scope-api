import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BookDetailSnapshot, FetchedBookDetail } from './domain/book-detail.types';

export type BookDetailCrawl = { status: 'success' | 'failed' | 'skipped'; errorCode?: 'UPSTREAM_ERROR' | 'TIMEOUT' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR'; errorMessage?: string };

@Injectable()
export class BookDetailStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async read(bookId: string): Promise<BookDetailSnapshot | undefined> {
    const detail = await this.prisma.bookDetail.findFirst({ where: { book: { platform: 'qidian', externalBookId: bookId } }, include: { book: true } });
    return detail ? this.toSnapshot(detail) : undefined;
  }

  async writeFresh(bookId: string, fetched: FetchedBookDetail, fetchedAt: Date, expiresAt: Date): Promise<BookDetailSnapshot> {
    const { bookId: _ignoredBookId, ...data } = fetched;
    const detail = await this.prisma.$transaction(async (tx) => {
      const book = await tx.book.upsert({ where: { platform_externalBookId: { platform: 'qidian', externalBookId: bookId } }, create: { platform: 'qidian', externalBookId: bookId }, update: {} });
      return tx.bookDetail.upsert({
        where: { bookId: book.id },
        create: { bookId: book.id, ...data, fetchedAt, expiresAt, status: 'fresh', lastError: null },
        update: { ...data, fetchedAt, expiresAt, status: 'fresh', lastError: null },
        include: { book: true },
      });
    });
    return this.toSnapshot(detail);
  }

  async markStale(bookId: string, error: string): Promise<BookDetailSnapshot | undefined> {
    const existing = await this.prisma.bookDetail.findFirst({ where: { book: { platform: 'qidian', externalBookId: bookId } }, include: { book: true } });
    if (!existing) return undefined;
    const detail = await this.prisma.bookDetail.update({ where: { id: existing.id }, data: { status: 'stale', lastError: error }, include: { book: true } });
    return this.toSnapshot(detail);
  }

  async recordCrawl(bookId: string, startedAt: Date, status: BookDetailCrawl['status'], error?: Pick<BookDetailCrawl, 'errorCode' | 'errorMessage'>): Promise<void> {
    await this.prisma.crawlLog.create({ data: {
      targetType: 'book_detail', targetKey: bookId, platform: 'qidian', startedAt, finishedAt: new Date(), status,
      ...(error?.errorMessage ? { errorMessage: error.errorMessage } : {}),
    } });
  }

  async latestCrawl(bookId: string, completedSince: Date): Promise<BookDetailCrawl | undefined> {
    const crawl = await this.prisma.crawlLog.findFirst({ where: { targetType: 'book_detail', targetKey: bookId, platform: 'qidian', status: 'failed', finishedAt: { gte: completedSince } }, orderBy: { finishedAt: 'desc' } });
    if (!crawl || (crawl.status !== 'success' && crawl.status !== 'failed' && crawl.status !== 'skipped')) return undefined;
    const errorCode = crawl.errorMessage?.match(/^(UPSTREAM_ERROR|TIMEOUT|NETWORK_ERROR|UNKNOWN_ERROR):/)?.[1] as BookDetailCrawl['errorCode'];
    return { status: crawl.status, ...(errorCode ? { errorCode } : {}) };
  }

  private toSnapshot(detail: any): BookDetailSnapshot {
    return { bookId: detail.book.externalBookId, title: detail.title, author: detail.author, genres: Array.isArray(detail.genres) ? detail.genres.filter((genre: unknown): genre is string => typeof genre === 'string') : [], description: detail.description,
      bookStatus: detail.bookStatus, wordCount: detail.wordCount, totalRecCount: detail.totalRecCount, chaptersNum: detail.chaptersNum, monthCount: detail.monthCount, recCount: detail.recCount, rewardNum: detail.rewardNum,
      sourceUrl: detail.sourceUrl, fetchedAt: detail.fetchedAt.toISOString(), expiresAt: detail.expiresAt.toISOString(), status: detail.status === 'fresh' ? 'fresh' : 'stale', lastError: detail.lastError, stale: detail.status !== 'fresh' };
  }
}
