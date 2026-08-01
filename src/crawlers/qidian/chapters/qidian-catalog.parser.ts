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
}

export class QidianCatalogParser {
  parse(input: QidianCatalogParseInput): QidianCatalogChapter[] {
    const $ = load(input.html);
    const chapters: QidianCatalogChapter[] = [];

    $(".catalog-volume").each((_volumeIndex, volume) => {
      $(volume).find("li.chapter-item").each((_chapterIndex, li) => {
        const link = $(li).find("a.chapter-name").first();
        const href = link.attr("href") ?? "";
        const chapterId = this.parseChapterId(href);
        if (chapterId === null) return;

        chapters.push({
          index: chapters.length + 1,
          title: normalizeHtmlText(link.text()),
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

  private parseChapterId(href: string): string | null {
    try {
      const url = new URL(href, QIDIAN_BASE_URL);
      return url.pathname.match(/^\/chapter\/\d+\/(\d+)\/?$/)?.[1] ?? null;
    } catch {
      return null;
    }
  }
}

function normalizeHtmlText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
