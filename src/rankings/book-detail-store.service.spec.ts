import { BookDetailStoreService } from './book-detail-store.service';
import { FetchedBookDetail } from './domain/book-detail.types';

const fetched: FetchedBookDetail = {
  bookId: '123', title: 'Test Book', author: 'Test Author', genres: ['Fantasy'], description: null,
  bookStatus: 'serial', wordCount: 100, totalRecCount: 20, chaptersNum: 10, monthCount: 3,
  recCount: 2, rewardNum: 1, sourceUrl: 'https://www.qidian.com/book/123/',
};
const book = { id: 'book-id', platform: 'qidian', externalBookId: '123' };
const detail = {
  id: 'detail-id', bookId: book.id, ...fetched, fetchedAt: new Date('2026-07-18T00:00:00.000Z'),
  expiresAt: new Date('2026-07-18T03:00:00.000Z'), status: 'fresh', lastError: null, book,
};

describe('BookDetailStoreService', () => {
  const createPrisma = () => ({
    bookDetail: { findFirst: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    book: { upsert: jest.fn() },
    crawlLog: { create: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(),
  });

  it('reads the Qidian detail and maps all persisted fields', async () => {
    const prisma = createPrisma();
    prisma.bookDetail.findFirst.mockResolvedValue(detail);
    const store = new BookDetailStoreService(prisma as never);

    await expect(store.read('123')).resolves.toEqual({ ...fetched, fetchedAt: '2026-07-18T00:00:00.000Z', expiresAt: '2026-07-18T03:00:00.000Z', status: 'fresh', lastError: null, stale: false });
    expect(prisma.bookDetail.findFirst).toHaveBeenCalledWith({ where: { book: { platform: 'qidian', externalBookId: '123' } }, include: { book: true } });
  });

  it('upserts the book and complete fresh detail atomically', async () => {
    const prisma = createPrisma();
    const tx = { book: prisma.book, bookDetail: prisma.bookDetail };
    prisma.$transaction.mockImplementation(async (work: (transaction: typeof tx) => unknown) => work(tx));
    prisma.book.upsert.mockResolvedValue(book);
    prisma.bookDetail.upsert.mockResolvedValue(detail);
    const store = new BookDetailStoreService(prisma as never);
    const fetchedAt = new Date('2026-07-18T00:00:00.000Z');
    const expiresAt = new Date('2026-07-18T03:00:00.000Z');

    await expect(store.writeFresh('123', fetched, fetchedAt, expiresAt)).resolves.toMatchObject({ ...fetched, status: 'fresh', stale: false });
    expect(prisma.book.upsert).toHaveBeenCalledWith({ where: { platform_externalBookId: { platform: 'qidian', externalBookId: '123' } }, create: { platform: 'qidian', externalBookId: '123' }, update: {} });
    const { bookId: _bookId, ...persisted } = fetched;
    expect(prisma.bookDetail.upsert).toHaveBeenCalledWith({
      where: { bookId: 'book-id' },
      create: { bookId: 'book-id', ...persisted, fetchedAt, expiresAt, status: 'fresh', lastError: null },
      update: { ...persisted, fetchedAt, expiresAt, status: 'fresh', lastError: null }, include: { book: true },
    });
  });

  it('marks only an existing Qidian detail stale and does not update when absent', async () => {
    const prisma = createPrisma();
    prisma.bookDetail.findFirst.mockResolvedValueOnce(detail).mockResolvedValueOnce(undefined);
    prisma.bookDetail.update.mockResolvedValue({ ...detail, status: 'stale', lastError: 'UPSTREAM_ERROR: crawl failed' });
    const store = new BookDetailStoreService(prisma as never);

    await expect(store.markStale('123', 'UPSTREAM_ERROR: crawl failed')).resolves.toMatchObject({ status: 'stale', stale: true, lastError: 'UPSTREAM_ERROR: crawl failed' });
    await expect(store.markStale('missing', 'UPSTREAM_ERROR: crawl failed')).resolves.toBeUndefined();
    expect(prisma.bookDetail.update).toHaveBeenCalledTimes(1);
    expect(prisma.bookDetail.update).toHaveBeenCalledWith({ where: { id: 'detail-id' }, data: { status: 'stale', lastError: 'UPSTREAM_ERROR: crawl failed' }, include: { book: true } });
  });

  it('records crawl status and a sanitized error message', async () => {
    const prisma = createPrisma();
    const store = new BookDetailStoreService(prisma as never);
    const startedAt = new Date('2026-07-18T00:00:00.000Z');

    await store.recordCrawl('123', startedAt, 'failed', { errorCode: 'UPSTREAM_ERROR', errorMessage: 'UPSTREAM_ERROR: crawl failed' });
    expect(prisma.crawlLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ targetType: 'book_detail', targetKey: '123', platform: 'qidian', startedAt, status: 'failed', errorMessage: 'UPSTREAM_ERROR: crawl failed', finishedAt: expect.any(Date) }) });
  });

  it('queries the latest attempt completed after waiting began and safely parses its failure code', async () => {
    const prisma = createPrisma();
    prisma.crawlLog.findFirst.mockResolvedValue({ status: 'failed', errorMessage: 'NETWORK_ERROR: crawl failed' });
    const store = new BookDetailStoreService(prisma as never);
    const waitingBeganAt = new Date('2026-07-18T00:00:01.000Z');

    await expect(store.latestCrawl('123', waitingBeganAt)).resolves.toEqual({ status: 'failed', errorCode: 'NETWORK_ERROR' });
    expect(prisma.crawlLog.findFirst).toHaveBeenCalledWith({
      where: { targetType: 'book_detail', targetKey: '123', platform: 'qidian', status: 'failed', finishedAt: { gte: waitingBeganAt } },
      orderBy: { finishedAt: 'desc' },
    });
  });
});
