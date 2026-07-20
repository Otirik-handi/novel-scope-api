import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import { BookDetailsService } from './book-details.service';
import { BookDetailSnapshot, FetchedBookDetail } from './domain/book-detail.types';
import { StructuredLogger } from '../structured-logger';

const fetched: FetchedBookDetail = { bookId: '123', title: 'Test Book', author: 'Test Author', genres: [], description: null, bookStatus: null, wordCount: null, totalRecCount: null, chaptersNum: null, monthCount: null, recCount: null, rewardNum: null, sourceUrl: 'https://www.qidian.com/book/123/' };
const stored = (overrides: Partial<BookDetailSnapshot> = {}): BookDetailSnapshot => ({ ...fetched, fetchedAt: '2026-07-18T00:00:00.000Z', expiresAt: '2026-07-18T03:00:00.000Z', status: 'fresh', lastError: null, stale: false, ...overrides });
const lock = { withLock: jest.fn(async (_key, _deadline, work) => ({ acquired: true, value: await work() })) };

describe('BookDetailsService', () => {
  const clock = () => new Date('2026-07-18T01:00:00.000Z');
  const config = { get: (key: string) => key === 'bookDetailTtlHours' ? 3 : 35_000 } as never;

  it('returns a non-expired database record without crawling', async () => {
    const store = { read: jest.fn().mockResolvedValue(stored()), writeFresh: jest.fn(), markStale: jest.fn(), recordCrawl: jest.fn(), latestCrawl: jest.fn() };
    const provider = { fetch: jest.fn() };
    const service = new BookDetailsService(store, provider, clock, lock, config);
    await expect(service.get('123')).resolves.toMatchObject({ bookId: '123', stale: false, status: 'fresh' });
    expect(provider.fetch).not.toHaveBeenCalled();
  });

  it('atomically writes every fetched field with TTL expiry', async () => {
    const store = { read: jest.fn().mockResolvedValue(undefined), writeFresh: jest.fn().mockResolvedValue(stored()), markStale: jest.fn(), recordCrawl: jest.fn(), latestCrawl: jest.fn() };
    const service = new BookDetailsService(store, { fetch: jest.fn().mockResolvedValue(fetched) }, clock, lock, config);
    await service.get('123');
    expect(store.writeFresh).toHaveBeenCalledWith('123', fetched, new Date('2026-07-18T01:00:00.000Z'), new Date('2026-07-18T04:00:00.000Z'));
  });

  it('times out when persistence blocks after the provider returns without another crawl', async () => {
    jest.useFakeTimers();
    const shortConfig = { get: (key: string) => key === 'bookDetailTtlHours' ? 3 : 25 } as never;
    const store = {
      read: jest.fn().mockResolvedValue(undefined),
      writeFresh: jest.fn(() => new Promise(() => undefined)),
      markStale: jest.fn(),
      recordCrawl: jest.fn(),
      latestCrawl: jest.fn(),
    };
    const provider = { fetch: jest.fn().mockResolvedValue(fetched) };
    const service = new BookDetailsService(store, provider, () => new Date(Date.now()), lock, shortConfig);

    const result = service.get('123');
    const expected = expect(result).rejects.toBeInstanceOf(GatewayTimeoutException);
    await jest.advanceTimersByTimeAsync(25);

    await expected;
    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(store.markStale).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('keeps a successful snapshot fresh when success crawl logging fails', async () => {
    const store = {
      read: jest.fn().mockResolvedValue(undefined),
      writeFresh: jest.fn().mockResolvedValue(stored()),
      markStale: jest.fn(),
      recordCrawl: jest.fn().mockRejectedValue(new Error('crawl log unavailable')),
      latestCrawl: jest.fn(),
    };
    const logger = { crawlCompleted: jest.fn() } as unknown as StructuredLogger;
    const service = new BookDetailsService(store, { fetch: jest.fn().mockResolvedValue(fetched) }, clock, lock, config, undefined, logger);

    await expect(service.get('123')).resolves.toMatchObject({ status: 'fresh', stale: false });
    expect(store.markStale).not.toHaveBeenCalled();
  });

  it('marks and returns an old record stale after a failed refresh', async () => {
    const old = stored({ expiresAt: '2026-07-18T00:00:00.000Z' });
    const stale = stored({ ...old, status: 'stale', stale: true, lastError: 'UPSTREAM_ERROR: crawl failed' });
    const store = { read: jest.fn().mockResolvedValue(old), writeFresh: jest.fn(), markStale: jest.fn().mockResolvedValue(stale), recordCrawl: jest.fn(), latestCrawl: jest.fn() };
    const service = new BookDetailsService(store, { fetch: jest.fn().mockRejectedValue(new Error('upstream unavailable')) }, clock, lock, config);
    await expect(service.get('123')).resolves.toMatchObject({ stale: true, status: 'stale', lastError: 'UPSTREAM_ERROR: crawl failed' });
  });

  it('uses stable 502 code when a first fetch fails', async () => {
    const store = { read: jest.fn().mockResolvedValue(undefined), writeFresh: jest.fn(), markStale: jest.fn().mockResolvedValue(undefined), recordCrawl: jest.fn(), latestCrawl: jest.fn() };
    const service = new BookDetailsService(store, { fetch: jest.fn().mockRejectedValue(new Error('<html>secret</html>')) }, clock, lock, config);
    await expect(service.get('123')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'BOOK_DETAIL_FETCH_FAILED' }) });
  });

  it('returns 504 when advisory-lock wait uses the whole refresh budget without another crawl', async () => {
    const store = { read: jest.fn().mockResolvedValue(undefined), writeFresh: jest.fn(), markStale: jest.fn(), recordCrawl: jest.fn(), latestCrawl: jest.fn().mockResolvedValue({ status: 'failed', errorCode: 'TIMEOUT' }) };
    const unavailableLock = { withLock: jest.fn().mockResolvedValue({ acquired: false }) };
    const service = new BookDetailsService(store, { fetch: jest.fn() }, clock, unavailableLock, config);
    await expect(service.get('123')).rejects.toBeInstanceOf(GatewayTimeoutException);
    expect(service['provider'].fetch).not.toHaveBeenCalled();
  });

  it('returns the fresh record written by the lock holder without a second crawl', async () => {
    const fresh = stored({ expiresAt: '2026-07-18T04:00:00.000Z' });
    const store = { read: jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(fresh), writeFresh: jest.fn(), markStale: jest.fn(), recordCrawl: jest.fn(), latestCrawl: jest.fn() };
    const service = new BookDetailsService(store, { fetch: jest.fn() }, clock, { withLock: jest.fn().mockResolvedValue({ acquired: false }) }, config);

    await expect(service.get('123')).resolves.toMatchObject({ status: 'fresh', stale: false });
    expect(service['provider'].fetch).not.toHaveBeenCalled();
  });

  it('returns the lock holder\'s failed 502 from the persisted crawl result without a second crawl', async () => {
    const store = { read: jest.fn().mockResolvedValue(undefined), writeFresh: jest.fn(), markStale: jest.fn(), recordCrawl: jest.fn(), latestCrawl: jest.fn().mockResolvedValue({ status: 'failed', errorCode: 'UPSTREAM_ERROR' }) };
    const service = new BookDetailsService(store, { fetch: jest.fn() }, clock, { withLock: jest.fn().mockResolvedValue({ acquired: false }) }, config);

    await expect(service.get('123')).rejects.toBeInstanceOf(BadGatewayException);
    expect(service['provider'].fetch).not.toHaveBeenCalled();
    expect(store.latestCrawl).toHaveBeenCalledWith('123', expect.any(Date));
    expect(store.recordCrawl).toHaveBeenCalledWith('123', expect.any(Date), 'skipped', expect.anything());
  });

  it('propagates a holder failure that started before the waiter but completed after waiting began', async () => {
    const holderStartedAt = new Date('2026-07-18T00:59:59.000Z');
    const waiterStartedAt = new Date('2026-07-18T01:00:00.000Z');
    const waitBeganAt = new Date('2026-07-18T01:00:01.000Z');
    const clockValues = [new Date('2026-07-18T01:00:00.000Z'), waiterStartedAt, waitBeganAt];
    const now = () => clockValues.shift() ?? waitBeganAt;
    const store = {
      read: jest.fn().mockResolvedValue(undefined), writeFresh: jest.fn(), markStale: jest.fn(), recordCrawl: jest.fn(),
      latestCrawl: jest.fn().mockImplementation(async (_bookId: string, completedSince: Date) =>
        completedSince.getTime() <= waitBeganAt.getTime() ? { status: 'failed', errorCode: 'UPSTREAM_ERROR', startedAt: holderStartedAt } : undefined),
    };
    const service = new BookDetailsService(store, { fetch: jest.fn() }, now, { withLock: jest.fn().mockResolvedValue({ acquired: false }) }, config);

    await expect(service.get('123')).rejects.toBeInstanceOf(BadGatewayException);
    expect(store.latestCrawl).toHaveBeenCalledWith('123', waitBeganAt);
    expect(store.recordCrawl).toHaveBeenCalledWith('123', waiterStartedAt, 'skipped', expect.anything());
  });

  it('returns the concurrent lock holder failure instead of replacing it with a timeout', async () => {
    let releaseFailure!: () => void;
    let holderFinished!: () => void;
    let waiterIsWaiting!: () => void;
    const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
    const finishedGate = new Promise<void>((resolve) => { holderFinished = resolve; });
    const waiterWaitingGate = new Promise<void>((resolve) => { waiterIsWaiting = resolve; });
    let holderFetchStarted!: () => void;
    const holderFetchGate = new Promise<void>((resolve) => { holderFetchStarted = resolve; });
    const times = [
      '2026-07-18T01:00:00.000Z', '2026-07-18T01:00:00.001Z', '2026-07-18T01:00:00.002Z',
      '2026-07-18T01:00:00.003Z', '2026-07-18T01:00:00.004Z', '2026-07-18T01:00:00.005Z',
      '2026-07-18T01:00:00.006Z', '2026-07-18T01:00:00.007Z',
    ].map((value) => new Date(value));
    const now = () => times.shift() ?? new Date('2026-07-18T01:00:00.007Z');
    let first = true;
    const lock = {
      withLock: jest.fn(async (_key: string, _deadline: number, work: () => Promise<BookDetailSnapshot>) => {
        if (first) {
          first = false;
          try { return { acquired: true, value: await work() }; } finally { holderFinished(); }
        }
        waiterIsWaiting();
        await finishedGate;
        return { acquired: false };
      }),
    };
    let completedFailure: { status: 'failed'; errorCode: 'UPSTREAM_ERROR'; finishedAt: Date } | undefined;
    const store = {
      read: jest.fn().mockResolvedValue(undefined), writeFresh: jest.fn(), markStale: jest.fn().mockResolvedValue(undefined),
      recordCrawl: jest.fn(async (_bookId: string, _startedAt: Date, status: string, error?: { errorCode?: 'UPSTREAM_ERROR' }) => {
        if (status === 'failed') completedFailure = { status: 'failed', errorCode: error?.errorCode ?? 'UPSTREAM_ERROR', finishedAt: new Date('2026-07-18T01:00:00.010Z') };
      }),
      latestCrawl: jest.fn(async (_bookId: string, completedSince: Date) =>
        completedFailure && completedFailure.finishedAt >= completedSince ? completedFailure : undefined),
    };
    const provider = { fetch: jest.fn(async () => { holderFetchStarted(); await failureGate; throw new Error('upstream unavailable'); }) };
    const service = new BookDetailsService(store, provider, now, lock, config);

    const holder = service.get('123').catch((error: unknown) => error);
    await holderFetchGate;
    const waiter = service.get('123');
    await waiterWaitingGate;
    releaseFailure();

    await expect(holder).resolves.toBeInstanceOf(BadGatewayException);
    await expect(waiter).rejects.toBeInstanceOf(BadGatewayException);
    expect(store.latestCrawl).toHaveBeenCalledWith('123', new Date('2026-07-18T01:00:00.007Z'));
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns the lock holder failure to every concurrent waiter even after another waiter records skipped', async () => {
    let releaseFailure!: () => void;
    let holderFetchStarted!: () => void;
    let firstWaiterWaiting!: () => void;
    let secondWaiterWaiting!: () => void;
    let releaseWaiters!: () => void;
    let firstWaiterRecordedSkip!: () => void;
    let allowSecondWaiter!: () => void;
    const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
    const holderFetchGate = new Promise<void>((resolve) => { holderFetchStarted = resolve; });
    const firstWaiterGate = new Promise<void>((resolve) => { firstWaiterWaiting = resolve; });
    const secondWaiterGate = new Promise<void>((resolve) => { secondWaiterWaiting = resolve; });
    const releaseWaitersGate = new Promise<void>((resolve) => { releaseWaiters = resolve; });
    const firstWaiterRecordedSkipGate = new Promise<void>((resolve) => { firstWaiterRecordedSkip = resolve; });
    const allowSecondWaiterGate = new Promise<void>((resolve) => { allowSecondWaiter = resolve; });
    let lockAttempt = 0;
    const lock = {
      withLock: jest.fn(async (_key: string, _deadline: number, work: () => Promise<BookDetailSnapshot>) => {
        lockAttempt += 1;
        const attempt = lockAttempt;
        if (attempt === 1) return { acquired: true, value: await work() };
        if (attempt === 2) firstWaiterWaiting();
        else secondWaiterWaiting();
        await releaseWaitersGate;
        if (attempt === 3) await allowSecondWaiterGate;
        return { acquired: false };
      }),
    };
    const crawls: Array<{ status: 'failed' | 'skipped'; errorCode: 'UPSTREAM_ERROR' }> = [];
    const store = {
      read: jest.fn().mockResolvedValue(undefined), writeFresh: jest.fn(), markStale: jest.fn().mockResolvedValue(undefined),
      recordCrawl: jest.fn(async (_bookId: string, _startedAt: Date, status: 'failed' | 'skipped', error?: { errorCode?: 'UPSTREAM_ERROR' }) => {
        crawls.unshift({ status, errorCode: error?.errorCode ?? 'UPSTREAM_ERROR' });
        if (status === 'skipped' && crawls.filter((crawl) => crawl.status === 'skipped').length === 1) firstWaiterRecordedSkip();
      }),
      latestCrawl: jest.fn(async () => crawls.find((crawl) => crawl.status === 'failed')),
    };
    const provider = { fetch: jest.fn(async () => { holderFetchStarted(); await failureGate; throw new Error('upstream unavailable'); }) };
    const service = new BookDetailsService(store, provider, clock, lock, config);

    const holder = service.get('123').catch((error: unknown) => error);
    await holderFetchGate;
    const firstWaiter = service.get('123');
    const secondWaiter = service.get('123');
    await Promise.all([firstWaiterGate, secondWaiterGate]);
    releaseFailure();
    await expect(holder).resolves.toBeInstanceOf(BadGatewayException);
    releaseWaiters();
    await firstWaiterRecordedSkipGate;
    allowSecondWaiter();

    await expect(firstWaiter).rejects.toMatchObject({ status: 502, response: expect.objectContaining({ code: 'BOOK_DETAIL_FETCH_FAILED' }) });
    await expect(secondWaiter).rejects.toMatchObject({ status: 502, response: expect.objectContaining({ code: 'BOOK_DETAIL_FETCH_FAILED' }) });
    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(crawls.filter((crawl) => crawl.status === 'skipped')).toHaveLength(2);
  });

  it('persists and returns stale when lock waiting exhausts the budget with an old detail', async () => {
    const old = stored({ expiresAt: '2026-07-18T00:00:00.000Z' });
    const stale = stored({ ...old, status: 'stale', stale: true, lastError: 'TIMEOUT: crawl failed' });
    const store = { read: jest.fn().mockResolvedValue(old), writeFresh: jest.fn(), markStale: jest.fn().mockResolvedValue(stale), recordCrawl: jest.fn(), latestCrawl: jest.fn() };
    const service = new BookDetailsService(store, { fetch: jest.fn() }, clock, { withLock: jest.fn().mockResolvedValue({ acquired: false }) }, config);

    await expect(service.get('123')).resolves.toMatchObject({ status: 'stale', stale: true, lastError: 'TIMEOUT: crawl failed' });
    expect(store.markStale).toHaveBeenCalledWith('123', 'TIMEOUT: crawl failed');
  });

  it('returns 504 when the lock holder re-read never resolves before the refresh deadline', async () => {
    jest.useFakeTimers();
    const shortConfig = { get: (key: string) => key === 'bookDetailTtlHours' ? 3 : 25 } as never;
    const store = {
      read: jest.fn().mockResolvedValueOnce(undefined).mockImplementation(() => new Promise(() => undefined)),
      writeFresh: jest.fn(), markStale: jest.fn(), recordCrawl: jest.fn(), latestCrawl: jest.fn(),
    };
    const provider = { fetch: jest.fn() };
    const service = new BookDetailsService(store, provider, () => new Date(Date.now()), lock, shortConfig);

    const result = service.get('123');
    const expected = expect(result).rejects.toBeInstanceOf(GatewayTimeoutException);
    await jest.advanceTimersByTimeAsync(25);

    await expected;
    expect(provider.fetch).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('returns 504 when the initial detail read never resolves before the refresh deadline', async () => {
    jest.useFakeTimers();
    const shortConfig = { get: (key: string) => key === 'bookDetailTtlHours' ? 3 : 25 } as never;
    const store = {
      read: jest.fn(() => new Promise(() => undefined)),
      writeFresh: jest.fn(), markStale: jest.fn(), recordCrawl: jest.fn(), latestCrawl: jest.fn(),
    };
    const service = new BookDetailsService(store, { fetch: jest.fn() }, () => new Date(Date.now()), lock, shortConfig);
    const result = service.get('123');
    const observed = Promise.race([
      result.then(() => 'resolved', (error) => error),
      new Promise((resolve) => setTimeout(() => resolve('test deadline'), 25)),
    ]);

    await jest.advanceTimersByTimeAsync(25);

    await expect(observed).resolves.toBeInstanceOf(GatewayTimeoutException);
    expect(service['provider'].fetch).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('persists and returns stale when a lock waiter re-read never resolves before the refresh deadline', async () => {
    jest.useFakeTimers();
    const shortConfig = { get: (key: string) => key === 'bookDetailTtlHours' ? 3 : 25 } as never;
    const old = stored({ expiresAt: '2026-07-18T00:00:00.000Z' });
    const stale = stored({ ...old, status: 'stale', stale: true, lastError: 'TIMEOUT: crawl failed' });
    const store = {
      read: jest.fn().mockResolvedValueOnce(old).mockImplementation(() => new Promise(() => undefined)),
      writeFresh: jest.fn(), markStale: jest.fn().mockResolvedValue(stale), recordCrawl: jest.fn(), latestCrawl: jest.fn(),
    };
    const provider = { fetch: jest.fn() };
    const service = new BookDetailsService(store, provider, () => new Date(Date.now()), { withLock: jest.fn().mockResolvedValue({ acquired: false }) }, shortConfig);

    const result = service.get('123');
    await jest.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toMatchObject({ status: 'stale', stale: true, lastError: 'TIMEOUT: crawl failed' });
    expect(store.markStale).toHaveBeenCalledWith('123', 'TIMEOUT: crawl failed');
    expect(provider.fetch).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('returns 504 when latest crawl lookup never resolves before the refresh deadline', async () => {
    jest.useFakeTimers();
    const shortConfig = { get: (key: string) => key === 'bookDetailTtlHours' ? 3 : 25 } as never;
    const store = {
      read: jest.fn().mockResolvedValue(undefined), writeFresh: jest.fn(), markStale: jest.fn(), recordCrawl: jest.fn(),
      latestCrawl: jest.fn(() => new Promise(() => undefined)),
    };
    const provider = { fetch: jest.fn() };
    const service = new BookDetailsService(store, provider, () => new Date(Date.now()), { withLock: jest.fn().mockResolvedValue({ acquired: false }) }, shortConfig);

    const result = service.get('123');
    const expected = expect(result).rejects.toBeInstanceOf(GatewayTimeoutException);
    await jest.advanceTimersByTimeAsync(25);

    await expected;
    expect(provider.fetch).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('records structured success, failed, and skipped book-detail crawl attempts', async () => {
    const logger = { crawlCompleted: jest.fn() } as unknown as StructuredLogger;
    const successStore = { read: jest.fn().mockResolvedValue(undefined), writeFresh: jest.fn().mockResolvedValue(stored()), markStale: jest.fn(), recordCrawl: jest.fn(), latestCrawl: jest.fn() };
    const success = new BookDetailsService(successStore, { fetch: jest.fn().mockResolvedValue(fetched) }, clock, lock, config, undefined, logger);
    await success.get('123');
    expect(logger.crawlCompleted).toHaveBeenCalledWith(expect.objectContaining({ targetType: 'book_detail', targetKey: '123', platform: 'qidian', result: 'success' }));

    const failedStore = { read: jest.fn().mockResolvedValue(undefined), writeFresh: jest.fn(), markStale: jest.fn().mockResolvedValue(undefined), recordCrawl: jest.fn(), latestCrawl: jest.fn() };
    const failed = new BookDetailsService(failedStore, { fetch: jest.fn().mockRejectedValue(new Error('<secret>upstream</secret>')) }, clock, lock, config, undefined, logger);
    await expect(failed.get('123')).rejects.toBeInstanceOf(BadGatewayException);
    expect(failedStore.recordCrawl).toHaveBeenCalledWith('123', expect.any(Date), 'failed', expect.objectContaining({ errorCode: 'UPSTREAM_ERROR', errorMessage: 'UPSTREAM_ERROR: crawl failed' }));

    const skippedStore = { read: jest.fn().mockResolvedValue(undefined), writeFresh: jest.fn(), markStale: jest.fn(), recordCrawl: jest.fn(), latestCrawl: jest.fn().mockResolvedValue({ status: 'failed', errorCode: 'UPSTREAM_ERROR' }) };
    const skipped = new BookDetailsService(skippedStore, { fetch: jest.fn() }, clock, { withLock: jest.fn().mockResolvedValue({ acquired: false }) }, config, undefined, logger);
    await expect(skipped.get('123')).rejects.toBeInstanceOf(BadGatewayException);
    expect(logger.crawlCompleted).toHaveBeenCalledWith(expect.objectContaining({ targetType: 'book_detail', result: 'skipped' }));
  });
});
