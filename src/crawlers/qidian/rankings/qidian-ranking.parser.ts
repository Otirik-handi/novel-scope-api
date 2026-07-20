import { load } from "cheerio";
import type {
  CrawledRanking,
  CrawledRankingItem,
  RankType,
} from "../../interfaces";
import { parseDisplayedNumber } from "../../../utils/number-parser.util";
import {
  normalizeHtmlNodesText,
  normalizePlainText,
} from "../../../utils/text-normalizer.util";
import { QIDIAN_BASE_URL } from "../qidian.constants";

const RANKING_ITEM_SELECTOR = [
  ".book-img-text li",
  ".rank-list li",
  ".rank-item",
  ".book-item",
].join(", ");

const METRIC_NAMES = {
  yuepiao: "monthlyTickets",
  hotsales: "sales",
  recom: "recommendations",
  collect: "collections",
} as const satisfies Record<RankType, string>;

export interface QidianRankingParseInput {
  html: string;
  rankType: RankType;
  sourceUrl: string;
  fetchedAt: Date;
}

export class QidianRankingParseError extends Error {
  override readonly name = "QidianRankingParseError";
}

export class QidianRankingParser {
  parse(input: QidianRankingParseInput): CrawledRanking {
    const $ = load(input.html);
    const candidates = $(RANKING_ITEM_SELECTOR).toArray().slice(0, 10);
    const items: (CrawledRankingItem | null)[] = candidates.map((node, index) => {
      const element = $(node);
      const bookLink = element
        .find(
          "h2 a[href], a.book-title[href], .book-title a[href], a[href*='/book/']",
        )
        .first();
      const href = bookLink.attr("href")?.trim();
      const source = href ? this.parseBookSource(href) : null;
      const title =
        normalizeHtmlNodesText(bookLink.contents().toArray()) ?? "";
      const authorElement = element
        .find(".author .name, .author a, .author span, .writer, [data-author]")
        .first();
      const authorAttribute = authorElement.attr("data-author");
      const author = authorAttribute
        ? normalizePlainText(authorAttribute)
        : (normalizeHtmlNodesText(authorElement.contents().toArray()) ?? "");

      if (!source || !title || !author) {
        return null;
      }

      const coverElement = element.find("img[data-src], img[src]").first();
      const coverUrl = this.parseOptionalUrl(
        coverElement.attr("data-src") ?? coverElement.attr("src"),
      );
      const metricElement = element
        .find(".score, .rank-score, [data-metric]")
        .first();
      const metricAttribute = metricElement.attr("data-metric");
      const metricValue = parseDisplayedNumber(
        metricAttribute ??
          normalizeHtmlNodesText(metricElement.contents().toArray()),
      );

      return {
        rank: index + 1,
        externalBookId: source.externalBookId,
        title,
        author,
        coverUrl,
        sourceUrl: source.sourceUrl,
        metrics:
          metricValue === null
            ? {}
            : { [METRIC_NAMES[input.rankType]]: metricValue },
      } satisfies CrawledRankingItem;
    });
    const completeItems = items.filter(
      (item): item is CrawledRankingItem => item !== null,
    );

    if (
      completeItems.length !== 10 ||
      new Set(completeItems.map((item) => item.externalBookId)).size !== 10
    ) {
      throw new QidianRankingParseError(
        "Qidian ranking must contain exactly 10 unique complete items",
      );
    }

    return {
      platform: "qidian",
      rankType: input.rankType,
      sourceUrl: input.sourceUrl,
      fetchedAt: input.fetchedAt,
      items: completeItems,
    };
  }

  private parseBookSource(
    href: string,
  ): { externalBookId: string; sourceUrl: string } | null {
    try {
      const url = new URL(href, QIDIAN_BASE_URL);
      const match = url.pathname.match(/^\/book\/(\d+)\/?$/);

      if (url.origin !== QIDIAN_BASE_URL || !match) {
        return null;
      }

      return { externalBookId: match[1], sourceUrl: url.href };
    } catch {
      return null;
    }
  }

  private parseOptionalUrl(value: string | undefined): string | null {
    const normalized = value?.trim();

    if (!normalized) {
      return null;
    }

    try {
      const url = new URL(normalized, QIDIAN_BASE_URL);

      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }
}
