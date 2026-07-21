import type { BookCrawler, CrawledBook } from '../../interfaces';
import type { QidianClient } from '../qidian.client';
import { QIDIAN_BASE_URL, QIDIAN_BOOK_PATH_PREFIX } from '../qidian.constants';
import { QidianBookParser } from './qidian-book.parser';

export class QidianBookCrawlerError extends Error {
  override readonly name = 'QidianBookCrawlerError';
}

export class QidianBookCrawler implements BookCrawler {
  constructor(
    private readonly client: Pick<QidianClient, 'fetchPage'>,
    private readonly parser = new QidianBookParser(),
  ) {}

  async crawl(externalBookId: string): Promise<CrawledBook> {
    if (!/^\d+$/.test(externalBookId)) {
      throw new QidianBookCrawlerError('Invalid Qidian book ID');
    }

    const page = await this.client.fetchPage(
      `${QIDIAN_BOOK_PATH_PREFIX}${externalBookId}/`,
    );

    if (!this.matchesRequestedBook(page.sourceUrl, externalBookId)) {
      throw new QidianBookCrawlerError(
        'Qidian book final URL does not match requested book ID',
      );
    }

    return this.parser.parse({
      html: page.html,
      sourceUrl: page.sourceUrl,
      fetchedAt: new Date(),
    });
  }

  private matchesRequestedBook(
    sourceUrl: string,
    externalBookId: string,
  ): boolean {
    try {
      const url = new URL(sourceUrl);
      const match = url.pathname.match(/^\/book\/(\d+)\/?$/);

      return (
        url.origin === QIDIAN_BASE_URL &&
        url.username === '' &&
        url.password === '' &&
        match?.[1] === externalBookId
      );
    } catch {
      return false;
    }
  }
}
