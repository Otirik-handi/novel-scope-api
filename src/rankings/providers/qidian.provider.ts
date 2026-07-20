import { Inject, Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { RankingProvider } from '../domain/ranking-provider';
import { RankingItem, RankingKey, RankingSnapshot } from '../domain/ranking.types';
import { isSupportedRank } from '../ranking-catalog';
import { RankingHttpClient } from './ranking-http.client';

export class SourceParseError extends Error {}

type QidianHttp = Pick<RankingHttpClient, 'getResponse'>;

@Injectable()
export class QidianProvider implements RankingProvider {
  readonly platform = 'qidian' as const;

  constructor(@Inject(RankingHttpClient) private readonly http: QidianHttp) {}

  async fetch(key: RankingKey): Promise<RankingSnapshot> {
    if (!isSupportedRank('qidian', key.rank)) throw new Error(`Unsupported Qidian rank: ${key.rank}`);
    const requestedUrl = `https://www.qidian.com/rank/${key.rank}/`;
    const response = await this.http.getResponse(requestedUrl);
    const items = this.parseRecords(response.body.toString('utf8'));

    return { ...key, sourceUrl: response.finalUrl, fetchedAt: new Date().toISOString(), status: 'fresh', items };
  }

  private parseRecords(html: string): RankingItem[] {
    const $ = cheerio.load(html);
    const items: RankingItem[] = [];
    $('.book-img-text > ul > li').each((_index, element) => {
      const node = $(element);
      const link = node.find('.book-mid-info h2 a').first();
      const href = link.attr('href')?.trim() ?? '';
      const bookId = href.match(/\/book\/(\d+)\/?/)?.[1] ?? '';
      const title = link.text().trim();
      const author = node.find('.book-mid-info .author a').first().text().trim();
      const genres = node.find('.book-mid-info .author a').slice(1).map((_i, genre) => $(genre).text().trim()).get().filter(Boolean);
      if (!bookId || !title || !author) return;
      items.push({ rank: items.length + 1, bookId, title, author, genres, status: null, wordCount: null,
        description: node.find('.book-mid-info .intro').text().trim() || null, metrics: {},
        url: new URL(href, 'https://www.qidian.com').toString() });
    });
    if (items.length !== 10 || new Set(items.map((item) => item.rank)).size !== 10 || new Set(items.map((item) => item.bookId)).size !== 10) {
      throw new SourceParseError('Qidian PC ranking page does not contain ten unique ranking entries');
    }
    return items;
  }
}
