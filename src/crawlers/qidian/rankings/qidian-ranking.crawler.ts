import type { CrawledRanking, RankingCrawler, RankType } from "../../interfaces";
import type { QidianClient } from "../qidian.client";
import { QIDIAN_RANKING_PATHS } from "../qidian.constants";
import { QidianRankingParser } from "./qidian-ranking.parser";

export class QidianRankingCrawler implements RankingCrawler {
  constructor(
    private readonly client: Pick<QidianClient, "fetchPage">,
    private readonly parser = new QidianRankingParser(),
  ) {}

  async crawl(rankType: RankType): Promise<CrawledRanking> {
    const page = await this.client.fetchPage(QIDIAN_RANKING_PATHS[rankType]);

    return this.parser.parse({
      html: page.html,
      rankType,
      sourceUrl: page.sourceUrl,
      fetchedAt: new Date(),
    });
  }
}
