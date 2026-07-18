import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrawlErrorCode } from '../structured-logger';
import { RankingKey, RankingSnapshot } from './domain/ranking.types';

// Retained for the separate book-detail cache configuration during its later migration.
export const SNAPSHOT_DIR = Symbol('SNAPSHOT_DIR');

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
    return {
      platform: snapshot.platform as RankingSnapshot['platform'], rank: snapshot.rankType ?? key.rank, channel: key.channel,
      sourceUrl: snapshot.sourceUrl, fetchedAt: snapshot.fetchedAt.toISOString(), status: 'fresh',
      items: snapshot.items.map((item) => ({ rank: item.rank, bookId: item.externalBookId, title: item.title, author: item.author,
        genres: [], status: null, wordCount: null, description: null, metrics: item.metrics as Record<string, string | number>, url: item.sourceUrl })),
    };
  }

  async write(snapshot: RankingSnapshot): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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
    });
  }

  async recordFailure(key: RankingKey, startedAt: Date, error: unknown, status: 'failed' | 'skipped' = 'failed'): Promise<void> {
    await this.prisma.crawlLog.create({ data: { targetType: 'ranking', targetKey: key.rank, platform: key.platform,
      startedAt, finishedAt: new Date(), status, errorMessage: crawlErrorSummary(error) } });
  }
}
