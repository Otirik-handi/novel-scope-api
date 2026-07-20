import { Inject, Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { FetchedBookDetail } from '../domain/book-detail.types';
import { SourceParseError } from './qidian.provider';
import { RankingHttpClient } from './ranking-http.client';

@Injectable()
export class QidianBookDetailProvider {
  constructor(@Inject(RankingHttpClient) private readonly http: Pick<RankingHttpClient, 'getResponse'>) {}
  async fetch(bookId: string): Promise<FetchedBookDetail> {
    const response = await this.http.getResponse(`https://www.qidian.com/book/${bookId}/`);
    const html = response.body.toString('utf8'); const $ = cheerio.load(html);
    if (/(?:验证码|安全验证|访问过于频繁|请完成验证|captcha|verify you are human|cf-chl-)/i.test(html)) throw new SourceParseError('Qidian access challenge page');
    const embedded = this.embedded(html);
    const title = this.text($('.book-information h1 em, .book-info h1 em, h1 em').first().text()) || this.string(embedded.bookName ?? embedded.bName);
    const author = this.text($('.book-information .writer a, .book-info .writer a, .writer a').first().text()) || this.string(embedded.authorName ?? embedded.bAuth);
    if (!title || !author) throw new SourceParseError('Qidian page does not contain required book details');
    const genres = [...new Set($('.book-information .tag a, .book-info .tag a, .tag a').map((_i, el) => this.text($(el).text())).get().filter(Boolean))];
    const description = this.text($('.book-intro p, .book-info-detail .book-intro').first().html() ?? '') || this.nullable(embedded.desc);
    const metric = (names: string[]) => this.number(embedded[names[0]!]) ?? this.numberFromText($('body').text(), names);
    return { bookId, title, author, genres, description: description || null, bookStatus: this.text($('.book-information .book-label, .book-info .book-label').first().text()) || this.nullable(embedded.bookStatus ?? embedded.status),
      wordCount: metric(['wordsCnt', 'wordCount']), totalRecCount: metric(['totalRecCount']), chaptersNum: metric(['chaptersNum']), monthCount: metric(['monthCount']), recCount: metric(['recCount']), rewardNum: metric(['rewardNum']), sourceUrl: response.finalUrl };
  }
  private embedded(html: string): Record<string, unknown> { const match = html.match(/<script[^>]+id=["']vite-plugin-ssr_pageContext["'][^>]*>([\s\S]*?)<\/script>/i); if (!match?.[1]) return {}; try { const data = JSON.parse(match[1]).pageContext?.pageProps?.pageData; return (data?.bookInfo ?? data?.book ?? data ?? {}) as Record<string, unknown>; } catch { return {}; } }
  private text(value: string): string { return this.plainText(value); }
  private string(value: unknown): string { return typeof value === 'string' || typeof value === 'number' ? this.plainText(String(value)) : ''; }
  private plainText(value: string): string { return cheerio.load(`<div>${value.replace(/<br\s*\/?>/gi, '\n')}</div>`)('div').text().replace(/\r\n?/g, '\n').replace(/[\t\f\v ]+/g, ' ').replace(/\n[ ]*/g, '\n').replace(/\n{2,}/g, '\n').trim(); }
  private nullable(value: unknown): string | null { return this.string(value) || null; }
  private number(value: unknown): number | null { const text = this.string(value).replace(/,/g, ''); const match = text.match(/\d+(?:\.\d+)?/); return match ? Math.round(Number(match[0]) * (/万/.test(text) ? 10_000 : /亿/.test(text) ? 100_000_000 : 1)) : null; }
  private numberFromText(text: string, names: string[]): number | null { const label = names.map((name) => name.replace(/[A-Z]/g, (c) => ` ${c}`)).join('|'); const match = text.match(new RegExp(`(?:${label})\\s*[:：]?\\s*([\\d,.]+(?:万|亿)?)`, 'i')); return this.number(match?.[1]); }
}
