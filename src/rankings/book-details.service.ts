import { BadGatewayException, GatewayTimeoutException, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookDetailStoreService } from '../db/book-detail-store.service';
import { BookDetailCrawl } from '../db/book-detail-store.service';
import { BookDetailSnapshot } from '../types/book-detail.types';
import { QidianBookDetailProvider } from './providers/qidian-book-detail.provider';
import { BOOK_DETAIL_LOCK, BookDetailLock } from '../db/book-detail-lock.service';
import { appLogger, CrawlErrorCode, StructuredLogger } from '../structured-logger';

export const BOOK_DETAILS_CLOCK = Symbol('BOOK_DETAILS_CLOCK');
export const BOOK_DETAILS_DELAY = Symbol('BOOK_DETAILS_DELAY');
export const BOOK_DETAIL_CRAWL_LOGGER = Symbol('BOOK_DETAIL_CRAWL_LOGGER');
type Delay = (milliseconds: number) => Promise<void>;

@Injectable()
export class BookDetailsService {
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  constructor(
    @Inject(BookDetailStoreService) private readonly store: Pick<BookDetailStoreService, 'read' | 'writeFresh' | 'markStale' | 'recordCrawl' | 'latestCrawl'>,
    @Inject(QidianBookDetailProvider) private readonly provider: Pick<QidianBookDetailProvider, 'fetch'>,
    @Inject(BOOK_DETAILS_CLOCK) private readonly now: () => Date,
    @Inject(BOOK_DETAIL_LOCK) private readonly lock: BookDetailLock,
    @Optional() config?: ConfigService,
    @Optional() @Inject(BOOK_DETAILS_DELAY) private readonly delay: Delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    @Optional() @Inject(BOOK_DETAIL_CRAWL_LOGGER) private readonly logger: Pick<StructuredLogger, 'crawlCompleted'> = appLogger,
  ) {
    this.ttlMs = (config?.get<number>('bookDetailTtlHours') ?? Number(process.env.BOOK_DETAIL_TTL_HOURS ?? 3)) * 3_600_000;
    this.timeoutMs = config?.get<number>('bookDetailRefreshTimeoutMs') ?? Number(process.env.BOOK_DETAIL_REFRESH_TIMEOUT_MS ?? 35_000);
  }

  async get(bookId: string): Promise<BookDetailSnapshot> {
    const deadline = this.now().getTime() + this.timeoutMs;
    const startedAt = this.now();
    const waitBeganAt = this.now();
    let initial: BookDetailSnapshot | undefined;
    try {
      initial = await this.withBudget(() => this.store.read(bookId), deadline);
    } catch (error: unknown) {
      const details = this.errorDetails(error);
      await this.recordBestEffort(bookId, startedAt, 'failed', details, deadline);
      throw this.fetchException(details.errorCode, bookId);
    }
    if (initial && !this.expired(initial)) return { ...initial, stale: initial.status !== 'fresh' };
    let workStarted = false;
    let locked: { acquired: boolean; value?: BookDetailSnapshot };
    try {
      locked = await this.lock.withLock(`qidian:book:${bookId}`, deadline, async () => {
      workStarted = true;
      let saved: BookDetailSnapshot | undefined;
      try {
        const current = await this.withBudget(() => this.store.read(bookId), deadline);
        if (current && !this.expired(current)) return current;
        const fetched = await this.withBudget(() => this.provider.fetch(bookId), deadline);
        const fetchedAt = this.now();
        saved = await this.withBudget(() => this.store.writeFresh(bookId, fetched, fetchedAt, new Date(fetchedAt.getTime() + this.ttlMs)), deadline);
        await this.record(bookId, startedAt, 'success', undefined, deadline);
        return saved;
      } catch (error: unknown) {
        const details = this.errorDetails(error);
        if (saved) {
          if (details.errorCode === 'TIMEOUT') throw error;
          return saved;
        }
        await this.recordBestEffort(bookId, startedAt, 'failed', details, deadline);
        const message = details.errorMessage;
        const stale = await this.markStaleBefore(bookId, message, deadline);
        if (stale) return stale;
        const fallback = this.persistInitialAsStale(bookId, initial, message);
        if (fallback) return fallback;
        throw this.fetchException(details.errorCode, bookId);
      }
      });
    } catch (error: unknown) {
      if (workStarted) throw error;
      const details = this.errorDetails(error);
      await this.recordBestEffort(bookId, startedAt, 'failed', details, deadline);
      const stale = await this.markStaleBefore(bookId, details.errorMessage, deadline);
      if (stale) return stale;
      const fallback = this.persistInitialAsStale(bookId, initial, details.errorMessage);
      if (fallback) return fallback;
      throw this.fetchException(details.errorCode, bookId);
    }
    if (locked.acquired && locked.value) return { ...locked.value, stale: locked.value.status !== 'fresh' };
    let current: BookDetailSnapshot | undefined;
    try {
      current = await this.withBudget(() => this.store.read(bookId), deadline);
    } catch (error: unknown) {
      const details = this.errorDetails(error);
      await this.recordBestEffort(bookId, startedAt, 'skipped', details, deadline);
      const stale = await this.markStaleBefore(bookId, details.errorMessage, deadline);
      if (stale) return stale;
      const fallback = this.persistInitialAsStale(bookId, initial, details.errorMessage);
      if (fallback) return fallback;
      throw this.fetchException(details.errorCode, bookId);
    }
    if (current && !this.expired(current)) return { ...current, stale: current.status !== 'fresh' };
    const timeout = { errorCode: 'TIMEOUT' as const, errorMessage: 'TIMEOUT: crawl failed' };
    let latest: BookDetailCrawl | undefined;
    try {
      latest = await this.withBudget(() => this.store.latestCrawl(bookId, waitBeganAt), deadline);
    } catch (error: unknown) {
      const details = this.errorDetails(error);
      await this.recordBestEffort(bookId, startedAt, 'skipped', details, deadline);
      const stale = await this.markStaleBefore(bookId, details.errorMessage, deadline);
      if (stale) return stale;
      const fallback = this.persistInitialAsStale(bookId, initial, details.errorMessage);
      if (fallback) return fallback;
      throw this.fetchException(details.errorCode, bookId);
    }
    const result = latest?.status === 'failed'
      ? { errorCode: latest.errorCode ?? 'UNKNOWN_ERROR', errorMessage: `${latest.errorCode ?? 'UNKNOWN_ERROR'}: crawl failed` }
      : timeout;
    await this.recordBestEffort(bookId, startedAt, 'skipped', result, deadline);
    if (current) {
      const stale = await this.markStaleBefore(bookId, result.errorMessage, deadline);
      if (stale) return stale;
    }
    if (latest?.status === 'failed') throw this.fetchException(result.errorCode, bookId);
    throw this.fetchException('TIMEOUT', bookId);
  }

  private expired(snapshot: BookDetailSnapshot): boolean { return new Date(snapshot.expiresAt).getTime() <= this.now().getTime(); }
  private async withBudget<T>(work: () => Promise<T>, deadline: number): Promise<T> {
    const remaining = deadline - this.now().getTime();
    if (remaining <= 0) throw new Error('BOOK_DETAIL_TIMEOUT');
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('BOOK_DETAIL_TIMEOUT')), remaining); });
    try { return await Promise.race([work(), timeout]); } finally { if (timer) clearTimeout(timer); }
  }
  private errorDetails(error: unknown): Required<Pick<BookDetailCrawl, 'errorCode' | 'errorMessage'>> {
    const message = error instanceof Error ? error.message : '';
    const errorCode: CrawlErrorCode = message === 'BOOK_DETAIL_TIMEOUT' ? 'TIMEOUT' : /(?:ECONNABORTED|ETIMEDOUT)/.test(message) ? 'TIMEOUT' : /(?:ECONN|ENOTFOUND|EAI_AGAIN)/.test(message) ? 'NETWORK_ERROR' : 'UPSTREAM_ERROR';
    return { errorCode, errorMessage: `${errorCode}: crawl failed` };
  }
  private fetchException(errorCode: CrawlErrorCode, bookId: string) {
    if (errorCode === 'TIMEOUT') return new GatewayTimeoutException({ code: 'BOOK_DETAIL_FETCH_TIMEOUT', message: 'Book detail refresh timed out', bookId });
    return new BadGatewayException({ code: 'BOOK_DETAIL_FETCH_FAILED', message: 'Book detail fetch failed', bookId });
  }
  private async record(bookId: string, startedAt: Date, result: BookDetailCrawl['status'], details: Pick<BookDetailCrawl, 'errorCode' | 'errorMessage'> | undefined, deadline: number): Promise<void> {
    await this.withBudget(() => this.store.recordCrawl(bookId, startedAt, result, details), deadline);
    this.logger.crawlCompleted({ targetType: 'book_detail', targetKey: bookId, platform: 'qidian', durationMs: Math.max(0, this.now().getTime() - startedAt.getTime()), status: result === 'success' ? 'success' : result === 'skipped' ? 'skipped' : 'failed', result, ...(details?.errorCode ? { errorCode: details.errorCode } : {}) });
  }
  private async recordBestEffort(bookId: string, startedAt: Date, result: BookDetailCrawl['status'], details: Pick<BookDetailCrawl, 'errorCode' | 'errorMessage'>, deadline: number): Promise<void> {
    try { await this.record(bookId, startedAt, result, details, deadline); } catch { /* The primary refresh result must not wait beyond its deadline for audit logging. */ }
  }
  private async markStaleBefore(bookId: string, error: string, deadline: number): Promise<BookDetailSnapshot | undefined> {
    try { return await this.withBudget(() => this.store.markStale(bookId, error), deadline); } catch { return undefined; }
  }
  private persistInitialAsStale(bookId: string, initial: BookDetailSnapshot | undefined, error: string): BookDetailSnapshot | undefined {
    if (!initial) return undefined;
    void this.store.markStale(bookId, error).catch(() => undefined);
    return { ...initial, status: 'stale', stale: true, lastError: error };
  }
}
