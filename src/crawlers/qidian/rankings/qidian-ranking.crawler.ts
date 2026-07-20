import type { CrawledRanking, RankingCrawler, RankType } from "../../interfaces";
import type { QidianClient } from "../qidian.client";
import { QIDIAN_RANKING_PATHS } from "../qidian.constants";
import { QidianRankingParser } from "./qidian-ranking.parser";

export class QidianRankingCrawlerError extends Error {
  override readonly name = "QidianRankingCrawlerError";
}

export class QidianRankingCrawler implements RankingCrawler {
  constructor(
    private readonly client: Pick<QidianClient, "fetchPage">,
    private readonly parser = new QidianRankingParser(),
  ) {}

  async crawl(rankType: RankType): Promise<CrawledRanking> {
    const page = await this.client.fetchPage(QIDIAN_RANKING_PATHS[rankType]);

    if (!this.matchesRequestedRanking(page.sourceUrl, rankType)) {
      throw new QidianRankingCrawlerError(
        "Qidian ranking final URL does not match requested rank type",
      );
    }

    return this.parser.parse({
      html: page.html,
      rankType,
      sourceUrl: page.sourceUrl,
      fetchedAt: new Date(),
    });
  }

  private matchesRequestedRanking(
    sourceUrl: string,
    rankType: RankType,
  ): boolean {
    try {
      const pathname = new URL(sourceUrl).pathname.replace(/\/$/, "");
      const expectedPathname = QIDIAN_RANKING_PATHS[rankType].replace(
        /\/$/,
        "",
      );

      return pathname === expectedPathname;
    } catch {
      return false;
    }
  }
}
