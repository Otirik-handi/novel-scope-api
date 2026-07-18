import { Inject, Injectable } from '@nestjs/common';
import { RankingProvider } from '../domain/ranking-provider';
import { RankingItem, RankingKey, RankingSnapshot } from '../domain/ranking.types';
import { isSupportedRank, QIDIAN_RANK_PATHS } from '../ranking-catalog';
import { RankingHttpClient } from './ranking-http.client';

export class SourceParseError extends Error {}

@Injectable()
export class QidianProvider implements RankingProvider {
  readonly platform = 'qidian' as const;

  constructor(@Inject(RankingHttpClient) private readonly http: Pick<RankingHttpClient, 'get'>) {}

  async fetch(key: RankingKey): Promise<RankingSnapshot> {
    if (!isSupportedRank('qidian', key.rank)) {
      throw new Error(`Unsupported Qidian rank: ${key.rank}`);
    }
    const path = QIDIAN_RANK_PATHS[key.rank] as string;

    const sourceUrl = `https://m.qidian.com${path}`;
    const html = (await this.http.get(sourceUrl)).toString('utf8');
    const records = this.parseRecords(html);

    return {
      ...key,
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      status: 'fresh',
      items: records.map((record, index) => this.toItem(record, index + 1)),
    };
  }

  private parseRecords(html: string): Record<string, unknown>[] {
    const match = html.match(
      /<script[^>]+id=["']vite-plugin-ssr_pageContext["'][^>]*>([\s\S]*?)<\/script>/i,
    );
    if (!match) {
      throw new SourceParseError('Qidian page does not contain SSR pageContext');
    }

    try {
      const pageContext = match[1];
      if (!pageContext) {
        throw new SourceParseError('Qidian pageContext is empty');
      }

      const records = JSON.parse(pageContext).pageContext?.pageProps?.pageData?.records;
      if (!Array.isArray(records)) {
        throw new SourceParseError('Qidian SSR does not contain ranking records');
      }

      return records as Record<string, unknown>[];
    } catch (error: unknown) {
      if (error instanceof SourceParseError) {
        throw error;
      }

      throw new SourceParseError('Qidian SSR pageContext is invalid JSON');
    }
  }

  private toItem(record: Record<string, unknown>, rank: number): RankingItem {
    const bookId = String(record.bid ?? '');
    const genres = [record.cat, record.subCat]
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    return {
      rank,
      bookId,
      title: String(record.bName ?? ''),
      author: String(record.bAuth ?? ''),
      genres,
      status: null,
      wordCount: this.parseWordCount(record.cnt),
      description: typeof record.desc === 'string' ? record.desc : null,
      metrics: typeof record.rankCnt === 'string' || typeof record.rankCnt === 'number'
        ? { rankValue: record.rankCnt }
        : {},
      url: `https://m.qidian.com/book/${bookId}/`,
    };
  }

  private parseWordCount(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return null;
    }

    const match = String(value).match(/([\d.]+)\s*(万|亿)?/);
    if (!match) {
      return null;
    }

    const multiplier = match[2] === '亿' ? 100_000_000 : match[2] === '万' ? 10_000 : 1;
    return Math.round(Number(match[1]) * multiplier);
  }
}
