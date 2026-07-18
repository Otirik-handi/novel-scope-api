import { Inject, Injectable } from '@nestjs/common';
import { BookDetailSnapshot } from '../domain/book-detail.types';
import { SourceParseError } from './qidian.provider';
import { RankingHttpClient } from './ranking-http.client';

@Injectable()
export class QidianBookDetailProvider {
  constructor(@Inject(RankingHttpClient) private readonly http: Pick<RankingHttpClient, 'get'>) {}

  async fetch(bookId: string): Promise<BookDetailSnapshot> {
    const sourceUrl = `https://m.qidian.com/book/${bookId}/`;
    const html = (await this.http.get(sourceUrl)).toString('utf8');
    const record = this.parseBookInfo(html);
    const title = this.stringValue(record.bName);
    const author = this.stringValue(record.bAuth);
    if (!title.trim() || !author.trim()) {
      throw new SourceParseError('Qidian SSR does not contain book details');
    }
    return {
      bookId,
      title,
      author,
      genres: [record.cat, record.subCat].filter((value): value is string => typeof value === 'string' && value.length > 0),
      description: this.nullableString(record.desc),
      bookStatus: this.nullableString(record.bookStatus ?? record.status),
      wordCount: this.parseWordCount(record.cnt),
      url: sourceUrl,
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      status: 'fresh',
    };
  }

  private parseBookInfo(html: string): Record<string, unknown> {
    const match = html.match(/<script[^>]+id=["']vite-plugin-ssr_pageContext["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match?.[1]) throw new SourceParseError('Qidian page does not contain SSR pageContext');
    try {
      const pageData = JSON.parse(match[1]).pageContext?.pageProps?.pageData;
      const bookInfo = pageData?.bookInfo ?? pageData?.book ?? pageData;
      if (!bookInfo || typeof bookInfo !== 'object' || Array.isArray(bookInfo)) {
        throw new SourceParseError('Qidian SSR does not contain book details');
      }
      return bookInfo as Record<string, unknown>;
    } catch (error: unknown) {
      if (error instanceof SourceParseError) throw error;
      throw new SourceParseError('Qidian SSR pageContext is invalid JSON');
    }
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }

  private nullableString(value: unknown): string | null {
    return this.stringValue(value) || null;
  }

  private parseWordCount(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
    if (typeof value !== 'string') return null;
    if (/^\d+(?:\.\d+)?$/.test(value)) return Math.round(Number(value));
    const match = value.match(/([\d.]+)\s*(万|亿|字)/);
    if (!match) return null;
    return Math.round(Number(match[1]) * (match[2] === '亿' ? 100_000_000 : match[2] === '万' ? 10_000 : 1));
  }
}
