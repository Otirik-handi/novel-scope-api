import { load } from "cheerio";
import type {
  CrawledRanking,
  CrawledRankingItem,
  RankType,
} from "../../interfaces";
import {
  normalizeHtmlNodesText,
  normalizePlainText,
} from "../../../utils/text-normalizer.util";
import { QIDIAN_BASE_URL } from "../qidian.constants";
import { Logger } from "@nestjs/common";

const RANKING_ITEM_SELECTOR = "#book-img-text > ul > li";

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
  private readonly logger = new Logger("QidianRankingParser");

  parse(input: QidianRankingParseInput): CrawledRanking {
    const $ = load(input.html);
    const candidates = $(RANKING_ITEM_SELECTOR).toArray().slice(0, 10);
    this.logger.log(
      `found ${candidates.length} candidate items for ${input.rankType}`,
    );

    let nullCount = 0;
    const items: (CrawledRankingItem | null)[] = candidates.map(
      (node, index) => {
        const element = $(node);
        const rank = parseInt(element.attr("data-rid") ?? "", 10) || index + 1;
        const titleLink = element.find("h2 > a").first();
        const href = titleLink.attr("href")?.trim();
        const dataBid = titleLink.attr("data-bid");
        const externalBookId = dataBid ?? this.parseBookIdFromHref(href);
        const sourceUrl = href
          ? new URL(href, QIDIAN_BASE_URL).href
          : "";

        let title = "";
        try {
          title = normalizePlainText(titleLink.text()) ?? "";
        } catch {
          title = normalizeHtmlNodesText(titleLink.contents().toArray()) ?? "";
        }

        const author = normalizePlainText(
          element.find("p.author > a.name").first().text(),
        ) ?? "";

        if (!externalBookId || !title || !author) {
          nullCount += 1;
          this.logger.warn(
            `item #${rank} skipped: dataBid="${dataBid ?? "none"}" title="${title}" author="${author}"`,
          );
          return null;
        }

        const coverImg = element
          .find(".book-img-box img")
          .first();
        const coverUrl =
          coverImg.attr("src")?.trim() || null;

        return {
          rank,
          externalBookId,
          title,
          author,
          coverUrl,
          sourceUrl,
          metrics: {},
        } satisfies CrawledRankingItem;
      },
    );

    const completeItems = items.filter(
      (item): item is CrawledRankingItem => item !== null,
    );

    if (
      completeItems.length !== 10 ||
      new Set(completeItems.map((item) => item.externalBookId)).size !== 10
    ) {
      this.logger.error(
        `${completeItems.length}/10 complete, ${nullCount} skipped, unique bookIds: ${new Set(completeItems.map((item) => item.externalBookId)).size}`,
      );
      throw new QidianRankingParseError(
        "Qidian ranking must contain exactly 10 unique complete items",
      );
    }

    this.logger.log(
      `${completeItems.length}/10 items parsed for ${input.rankType}`,
    );

    return {
      platform: "qidian",
      rankType: input.rankType,
      sourceUrl: input.sourceUrl,
      fetchedAt: input.fetchedAt,
      items: completeItems,
    };
  }

  private parseBookIdFromHref(href: string | undefined): string | null {
    if (!href) return null;
    try {
      const url = new URL(href, QIDIAN_BASE_URL);
      const match = url.pathname.match(/^\/book\/(\d+)\/?$/);
      return url.origin === QIDIAN_BASE_URL && match ? match[1] : null;
    } catch {
      return null;
    }
  }
}
