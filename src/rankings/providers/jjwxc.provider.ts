import { Inject, Injectable, Optional } from '@nestjs/common';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { RankingProvider } from '../domain/ranking-provider';
import {
  RankingItem,
  RankingKey,
  RankingSnapshot,
} from '../domain/ranking.types';
import { mapWithConcurrency } from '../concurrency';
import { isSupportedRank, JJWXC_ORDER_STRINGS } from '../ranking-catalog';
import { RefreshScheduleConfigService } from '../refresh-schedule-config.service';
import { RankingHttpClient } from './ranking-http.client';

@Injectable()
export class JjwxcProvider implements RankingProvider {
  readonly platform = 'jjwxc' as const;

  constructor(
    @Inject(RankingHttpClient)
    private readonly http: Pick<RankingHttpClient, 'get'>,
    @Optional()
    @Inject(RefreshScheduleConfigService)
    private readonly scheduleConfig?: Pick<RefreshScheduleConfigService, 'get'>,
  ) {}

  async fetch(key: RankingKey): Promise<RankingSnapshot> {
    if (!isSupportedRank('jjwxc', key.rank)) {
      throw new Error(`Unsupported JJWXC rank: ${key.rank}`);
    }
    const orderstr = JJWXC_ORDER_STRINGS[key.rank] as string;

    const channel = key.channel ?? '0';
    const sourceUrl = `https://www.jjwxc.net/topten.php?orderstr=${orderstr}&t=${channel}`;
    const items = this.parseRanking(
      iconv.decode(await this.http.get(sourceUrl), 'gb18030'),
    );
    await mapWithConcurrency(
      items,
      this.scheduleConfig?.get().jjwxcDetailConcurrency ?? 1,
      async (item) => {
        try {
          Object.assign(item, await this.fetchDetails(item));
        } catch {
          // Detail data is optional; keep the rank entry when it cannot be fetched.
        }
      },
    );

    return {
      platform: 'jjwxc',
      rank: key.rank,
      channel: key.channel,
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      status: 'fresh',
      items,
    };
  }

  private parseRanking(html: string): RankingItem[] {
    const $ = cheerio.load(html);
    const items: RankingItem[] = [];

    $('a[href*="onebook.php?novelid="]').each((index, element) => {
      const link = $(element).attr('href') ?? '';
      const bookId = new URL(link, 'https://www.jjwxc.net/').searchParams.get(
        'novelid',
      );
      if (!bookId) {
        return;
      }

      const row = $(element).closest('tr');
      const listedRank = Number(row.attr('data-rank'));
      items.push({
        rank:
          Number.isFinite(listedRank) && listedRank > 0
            ? listedRank
            : index + 1,
        bookId,
        title: $(element).text().trim(),
        author: row.find('.author').first().text().trim(),
        genres: row
          .find('.genre')
          .first()
          .text()
          .split(/[-/]/)
          .map((genre) => genre.trim())
          .filter(Boolean),
        status: null,
        wordCount: null,
        description: row.find('.description').first().text().trim() || null,
        metrics: {},
        url: new URL(link, 'https://www.jjwxc.net/').toString(),
      });
    });

    return items;
  }

  private async fetchDetails(
    item: RankingItem,
  ): Promise<Pick<RankingItem, 'metrics' | 'status' | 'wordCount'>> {
    const detailUrl = `https://www.jjwxc.net/onebook.php?novelid=${item.bookId}`;
    const html = iconv.decode(await this.http.get(detailUrl), 'gb18030');
    const $ = cheerio.load(html);
    const metricNames = [
      'collectedCount',
      'nutritionCount',
      'scoreCount',
      'reviewCount',
    ];
    const metrics: Record<string, string | number> = {};

    for (const name of metricNames) {
      const value = this.itempropValue($, name);
      const number = this.numberValue(value);
      if (number !== null) {
        metrics[name] = number;
      }
    }

    return {
      metrics,
      wordCount: this.numberValue(this.itempropValue($, 'wordCount')),
      status: this.itempropValue($, 'updataStatus') || null,
    };
  }

  private itempropValue($: cheerio.CheerioAPI, name: string): string {
    const node = $(`[itemprop="${name}"]`).first();
    return (node.attr('content') ?? node.text()).trim();
  }

  private numberValue(value: string): number | null {
    const normalized = value.replace(/[^\d.]/g, '');
    return normalized ? Number(normalized) : null;
  }
}
