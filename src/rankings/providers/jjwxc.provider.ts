import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import { RankingProvider } from '../domain/ranking-provider';
import { RankingItem, RankingKey, RankingSnapshot } from '../domain/ranking.types';
import { RankingHttpClient } from './ranking-http.client';

const orderStrings: Record<string, string> = {
  income: '12',
  monthly: '7',
  quarterly: '8',
  completed: '14',
  newcomer: '15',
  thousandWords: '17',
};

@Injectable()
export class JjwxcProvider implements RankingProvider {
  readonly platform = 'jjwxc' as const;

  constructor(private readonly http: Pick<RankingHttpClient, 'get'>) {}

  async fetch(key: RankingKey): Promise<RankingSnapshot> {
    const orderstr = orderStrings[key.rank];
    if (!orderstr) {
      throw new Error(`Unsupported JJWXC rank: ${key.rank}`);
    }

    const channel = key.channel ?? '0';
    const sourceUrl = `https://www.jjwxc.net/topten.php?orderstr=${orderstr}&t=${channel}`;
    const items = this.parseRanking((await this.http.get(sourceUrl)).toString('utf8'));
    await Promise.all(
      items.map(async (item) => {
        try {
          Object.assign(item, await this.fetchDetails(item));
        } catch {
          // Detail data is optional; keep the rank entry when it cannot be fetched.
        }
      }),
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
      const bookId = new URL(link, 'https://www.jjwxc.net/').searchParams.get('novelid');
      if (!bookId) {
        return;
      }

      const row = $(element).closest('tr');
      const listedRank = Number(row.attr('data-rank'));
      items.push({
        rank: Number.isFinite(listedRank) && listedRank > 0 ? listedRank : index + 1,
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
    const metricNames = ['collectedCount', 'nutritionCount', 'scoreCount', 'reviewCount'];
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
