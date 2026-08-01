import type { QidianBrowserClient } from "../qidian-browser.client";
import { QidianBookParser } from "../books/qidian-book.parser";
import { QidianCatalogParser } from "./qidian-catalog.parser";
import { QidianChapterParser } from "./qidian-chapter.parser";
import { QidianChapterCrawlerError } from "./qidian-chapter.error";
import type { QidianCatalogChapter } from "./qidian-catalog.parser";
import type { QidianChapterContent } from "./qidian-chapter.parser";
import { QIDIAN_BOOK_PATH_PREFIX } from "../qidian.constants";

export interface QidianCatalog {
  bookId: string;
  title: string;
  author: string;
  chapters: QidianCatalogChapter[];
}

export class QidianChapterCrawler {
  constructor(
    private readonly client: Pick<QidianBrowserClient, "fetchPage">,
    private readonly bookParser = new QidianBookParser(),
    private readonly catalogParser = new QidianCatalogParser(),
    private readonly chapterParser = new QidianChapterParser(),
  ) {}

  async fetchCatalog(externalBookId: string): Promise<QidianCatalog> {
    if (!/^\d+$/.test(externalBookId)) {
      throw new QidianChapterCrawlerError(
        "QIDIAN_RANGE_INVALID",
        "Invalid qidian book id",
      );
    }

    const page = await this.client.fetchPage(
      `${QIDIAN_BOOK_PATH_PREFIX}${externalBookId}/`,
    );
    const book = this.bookParser.parse({
      html: page.html,
      sourceUrl: page.sourceUrl,
      fetchedAt: new Date(),
    });
    const chapters = this.catalogParser.parse({
      html: page.html,
      sourceUrl: page.sourceUrl,
      bookId: externalBookId,
    });

    return {
      bookId: externalBookId,
      title: book.title,
      author: book.author,
      chapters,
    };
  }

  async fetchChapter(
    externalBookId: string,
    chapterId: string,
  ): Promise<QidianChapterContent> {
    const page = await this.client.fetchPage(
      `/chapter/${externalBookId}/${chapterId}/`,
    );
    return this.chapterParser.parse({
      html: page.html,
      sourceUrl: page.sourceUrl,
      bookId: externalBookId,
      chapterId,
    });
  }
}
