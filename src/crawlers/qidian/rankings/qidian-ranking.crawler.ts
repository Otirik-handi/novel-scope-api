import type { CrawledRanking, RankingCrawler } from "../../interfaces";
import type { QidianClient } from "../qidian.client";
import {
  QIDIAN_BASE_URL,
  QIDIAN_RANKING_PATHS,
} from "../qidian.constants";
import {
  QidianRankingCatalog,
  type QidianRankTypeKey,
} from "./qidian-ranking.catalog";
import { QidianRankingParser } from "./qidian-ranking.parser";

export class QidianRankingCrawlerError extends Error {
  override readonly name = "QidianRankingCrawlerError";
}

export class QidianRankingCrawler implements RankingCrawler {
  constructor(
    private readonly client: Pick<QidianClient, "fetchPage">,
    private readonly catalog = new QidianRankingCatalog(),
    private readonly parser = new QidianRankingParser(),
  ) {}

  async crawl(rankTypeKey: string): Promise<CrawledRanking> {
    const definition = this.catalog.resolve(rankTypeKey);

    if (definition === null) {
      throw new QidianRankingCrawlerError("Unknown Qidian ranking key");
    }

    const page = await this.client.fetchPage(
      QIDIAN_RANKING_PATHS[definition.rankTypeKey],
    );

    if (!this.matchesRequestedRanking(page.sourceUrl, definition.rankTypeKey)) {
      throw new QidianRankingCrawlerError(
        "Qidian ranking final URL does not match requested rank type",
      );
    }

    return this.parser.parse({
      html: page.html,
      definition,
      sourceUrl: page.sourceUrl,
      fetchedAt: new Date(),
    });
  }

  private matchesRequestedRanking(
    sourceUrl: string,
    rankTypeKey: QidianRankTypeKey,
  ): boolean {
    try {
      const url = new URL(sourceUrl);
      const expectedPathname = QIDIAN_RANKING_PATHS[rankTypeKey].replace(
        /\/$/,
        "",
      );

      return (
        url.origin === QIDIAN_BASE_URL &&
        url.username === "" &&
        url.password === "" &&
        url.pathname.replace(/\/$/, "") === expectedPathname
      );
    } catch {
      return false;
    }
  }
}
