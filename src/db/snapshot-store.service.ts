import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { CrawlErrorCode } from '../structured-logger';
import { RankingKey, RankingSnapshot } from '../types/ranking.types';

export function crawlErrorCode(error: unknown): CrawlErrorCode {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') return 'UPSTREAM_ERROR';
  const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'TIMEOUT';
  if (typeof code === 'string') return 'NETWORK_ERROR';
  return 'UNKNOWN_ERROR';
}

export function crawlErrorSummary(error: unknown): string {
  return `${crawlErrorCode(error)}: crawl failed`;
}

@Injectable()
export class SnapshotStoreService {
  constructor(private readonly prisma: PrismaService) {}

  async read(key: RankingKey): Promise<RankingSnapshot | undefined> {
    const snapshot = await this.prisma.rankingSnapshot.findFirst({
      where: { platform: key.platform, rankType: key.rank }, orderBy: { fetchedAt: 'desc' },
      include: { items: { orderBy: { rank: 'asc' } } },
    });
    if (!snapshot) return undefined;
    return this.mapSnapshot(snapshot, key);
  }

  async write(snapshot: RankingSnapshot): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const books = await Promise.all(snapshot.items.map((item) => tx.book.upsert({
        where: { platform_externalBookId: { platform: snapshot.platform, externalBookId: item.bookId } },
        create: { platform: snapshot.platform, externalBookId: item.bookId }, update: {}, select: { id: true },
      })));
      const created = await tx.rankingSnapshot.create({ data: {
        platform: snapshot.platform, rankType: snapshot.rank, sourceUrl: snapshot.sourceUrl, fetchedAt: new Date(snapshot.fetchedAt),
      } });
      await tx.rankingItem.createMany({ data: snapshot.items.map((item, index) => ({ snapshotId: created.id, bookId: books[index]?.id ?? null,
        externalBookId: item.bookId, rank: item.rank, title: item.title, author: item.author, metrics: item.metrics, sourceUrl: item.url })) });
      await tx.crawlLog.create({ data: { targetType: 'ranking', targetKey: snapshot.rank, platform: snapshot.platform,
        startedAt: new Date(snapshot.fetchedAt), finishedAt: new Date(), status: 'success', snapshotId: created.id } });
      return created.id;
    });
  }

  async history(key: RankingKey, query: { from?: string; to?: string; limit?: number; cursor?: string }): Promise<{ items: RankingSnapshot[]; nextCursor: string | null }> {
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : undefined;
    const fetchedAt: Record<string, Date> = {};
    if (query.from) fetchedAt.gte = new Date(query.from);
    if (query.to) fetchedAt.lte = new Date(query.to);
    const where: Record<string, unknown> = { platform: key.platform, rankType: key.rank, ...(Object.keys(fetchedAt).length ? { fetchedAt } : {}) };
    if (cursor) where.AND = [{ ...(where.fetchedAt ? { fetchedAt: where.fetchedAt } : {}) }, { OR: [{ fetchedAt: { lt: cursor.fetchedAt } }, { fetchedAt: cursor.fetchedAt, id: { lt: cursor.id } }] }];
    const rows = await this.prisma.rankingSnapshot.findMany({ where, orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }], take: limit + 1, include: { items: { orderBy: { rank: 'asc' } } } });
    const page = rows.slice(0, limit);
    const items = page.map((snapshot) => this.mapSnapshot(snapshot, key));
    const last = page.at(-1);
    return { items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ fetchedAt: last.fetchedAt.toISOString(), id: last.id })).toString('base64url') : null };
  }

  private decodeCursor(cursor: string): { fetchedAt: Date; id: string } {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { fetchedAt?: unknown }).fetchedAt !== 'string' || typeof (parsed as { id?: unknown }).id !== 'string') throw new Error();
      const fetchedAt = new Date((parsed as { fetchedAt: string }).fetchedAt);
      if (Number.isNaN(fetchedAt.getTime())) throw new Error();
      return { fetchedAt, id: (parsed as { id: string }).id };
    } catch { throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Invalid cursor' }); }
  }

  private mapSnapshot(snapshot: any, key: RankingKey): RankingSnapshot {
    return { id: snapshot.id, platform: snapshot.platform as RankingSnapshot['platform'], rank: snapshot.rankType ?? key.rank, channel: key.channel,
      sourceUrl: snapshot.sourceUrl, fetchedAt: snapshot.fetchedAt.toISOString(), status: 'fresh', items: snapshot.items.map((item: any) => ({ rank: item.rank, bookId: item.externalBookId, title: item.title, author: item.author, genres: [], status: null, wordCount: null, description: null, metrics: item.metrics as Record<string, string | number>, url: item.sourceUrl })) };
  }

  async recordFailure(key: RankingKey, startedAt: Date, error: unknown, status: 'failed' | 'skipped' = 'failed'): Promise<void> {
    await this.prisma.crawlLog.create({ data: { targetType: 'ranking', targetKey: key.rank, platform: key.platform,
      startedAt, finishedAt: new Date(), status, errorMessage: crawlErrorSummary(error) } });
  }
}
