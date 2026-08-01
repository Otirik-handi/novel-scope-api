import { load } from "cheerio";
import { QIDIAN_BASE_URL } from "../qidian.constants";
import { QidianChapterCrawlerError } from "./qidian-chapter.error";

export interface QidianCatalogChapter {
  index: number;
  title: string;
  chapterId: string;
  sourceUrl: string;
  isVip: boolean;
}

export interface QidianCatalogParseInput {
  html: string;
  sourceUrl: string;
  bookId: string;
}

export class QidianCatalogParser {
  parse(input: QidianCatalogParseInput): QidianCatalogChapter[] {
    const requestedBookId = this.parseRequestedBookId(input.sourceUrl);
    if (requestedBookId === null || requestedBookId !== input.bookId) {
      throw this.invalidChapterError();
    }

    const $ = load(input.html);
    const chapters: QidianCatalogChapter[] = [];

    $(".catalog-volume").each((_volumeIndex, volume) => {
      $(volume).find("li.chapter-item").each((_chapterIndex, li) => {
        const link = $(li).find("a.chapter-name").first();
        const href = link.attr("href") ?? "";
        const title = normalizeHtmlText(link.text());
        const chapterId = this.parseChapterId(href, input.bookId);
        if (chapterId === null || title === "") {
          throw this.invalidChapterError();
        }

        chapters.push({
          index: chapters.length + 1,
          title,
          chapterId,
          sourceUrl: new URL(href, QIDIAN_BASE_URL).href,
          isVip: $(li).find(".chapter-locked").length > 0,
        });
      });
    });

    if (chapters.length === 0) {
      throw new QidianChapterCrawlerError(
        "QIDIAN_CATALOG_PARSE_FAILED",
        "\u8d77\u70b9\u76ee\u5f55\u4e3a\u7a7a\u6216\u65e0\u6cd5\u89e3\u6790",
      );
    }

    return chapters;
  }

  private parseRequestedBookId(sourceUrl: string): string | null {
    try {
      const url = new URL(sourceUrl, QIDIAN_BASE_URL);
      return url.origin === QIDIAN_BASE_URL
        ? url.pathname.match(/^\/book\/(\d+)\/?$/)?.[1] ?? null
        : null;
    } catch {
      return null;
    }
  }

  private parseChapterId(href: string, requestedBookId: string): string | null {
    try {
      const url = new URL(href, QIDIAN_BASE_URL);
      const match = url.pathname.match(/^\/chapter\/(\d+)\/(\d+)\/?$/);
      if (match === null) {
        return null;
      }

      return url.origin === QIDIAN_BASE_URL &&
        url.username === "" &&
        url.password === "" &&
        match[1] === requestedBookId
        ? match[2]
        : null;
    } catch {
      return null;
    }
  }

  private invalidChapterError(): QidianChapterCrawlerError {
    return new QidianChapterCrawlerError(
      "QIDIAN_CATALOG_PARSE_FAILED",
      "\u8d77\u70b9\u76ee\u5f55\u4e2d\u5b58\u5728\u65e0\u6548\u7ae0\u8282\u9879",
    );
  }
}

function normalizeHtmlText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
