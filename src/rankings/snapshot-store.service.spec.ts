import { RankingSnapshot } from './domain/ranking.types';
import { SnapshotStoreService } from './snapshot-store.service';

describe('SnapshotStoreService', () => {
  const snapshot: RankingSnapshot = {
    platform: 'qidian', rank: 'hotsales', channel: null, sourceUrl: 'https://www.qidian.com/rank/hotsales/',
    fetchedAt: '2026-07-17T00:00:00.000Z', status: 'fresh',
    items: Array.from({ length: 10 }, (_, index) => ({ rank: index + 1, bookId: String(index + 1), title: `Book ${index + 1}`,
      author: 'Author', genres: [], status: null, wordCount: null, description: null, metrics: {}, url: `https://www.qidian.com/book/${index + 1}/` })),
  };

  it('persists books, immutable snapshot, items, and success log inside one transaction', async () => {
    const tx = {
      book: { upsert: jest.fn().mockResolvedValue({ id: 'book-id' }) },
      rankingSnapshot: { create: jest.fn().mockResolvedValue({ id: 'snapshot-id' }) },
      rankingItem: { createMany: jest.fn() }, crawlLog: { create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)), rankingSnapshot: { findFirst: jest.fn() } };
    const store = new SnapshotStoreService(prisma as never);

    await expect(store.write(snapshot)).resolves.toBeUndefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.book.upsert).toHaveBeenCalledTimes(10);
    expect(tx.rankingSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sourceUrl: snapshot.sourceUrl }) }));
    expect(tx.rankingItem.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ rank: 1, bookId: 'book-id' })]) }));
    expect(tx.crawlLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'success', snapshotId: 'snapshot-id' }) }));
  });

  it('reads the most recent snapshot by platform and rank from Prisma', async () => {
    const prisma = { $transaction: jest.fn(), rankingSnapshot: { findFirst: jest.fn().mockResolvedValue({ ...snapshot, fetchedAt: new Date(snapshot.fetchedAt), items: snapshot.items.map((item) => ({ ...item, externalBookId: item.bookId, sourceUrl: item.url })) }) } };
    const store = new SnapshotStoreService(prisma as never);

    await expect(store.read({ platform: 'qidian', rank: 'hotsales', channel: null })).resolves.toMatchObject({ ...snapshot, fetchedAt: snapshot.fetchedAt });
    expect(prisma.rankingSnapshot.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { platform: 'qidian', rankType: 'hotsales' } }));
  });

  it.each([
    ['failed', new Error('<html><body>upstream secret</body></html>')],
    ['skipped', new Error('plain upstream secret')],
    ['failed', new Error('{"error":"upstream secret","token":"do-not-store"}')],
  ] as const)('persists only a fixed sanitized error summary for %s crawl logs', async (status, error) => {
    const prisma = { crawlLog: { create: jest.fn().mockResolvedValue(undefined) } };
    const store = new SnapshotStoreService(prisma as never);

    await store.recordFailure({ platform: 'qidian', rank: 'hotsales', channel: null }, new Date('2026-07-17T00:00:00.000Z'), error, status);

    const errorMessage = prisma.crawlLog.create.mock.calls[0]?.[0].data.errorMessage as string;
    expect(errorMessage).toBe('UNKNOWN_ERROR: crawl failed');
    expect(errorMessage.length).toBeLessThanOrEqual(1024);
    expect(errorMessage).not.toContain(error.message);
  });
});
