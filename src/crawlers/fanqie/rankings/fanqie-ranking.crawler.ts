import type { CrawledRanking, RankingCrawler } from "../../interfaces";
import type { FanqieBrowserClient } from "../fanqie-browser.client";
import { FanqieRankingCatalog } from "./fanqie-ranking.catalog";
import { FanqieRankingParser } from "./fanqie-ranking.parser";

export class FanqieRankingCrawlerError extends Error {
  override readonly name = "FanqieRankingCrawlerError";
}

export class FanqieRankingCrawler implements RankingCrawler {
  constructor(
    private readonly client: Pick<FanqieBrowserClient, "fetchRanking">,
    private readonly catalog = new FanqieRankingCatalog(),
    private readonly parser = new FanqieRankingParser(),
  ) {}

  async crawl(rankTypeKey: string): Promise<CrawledRanking> {
    const definition = this.catalog.resolve(rankTypeKey);

    if (definition === null) {
      throw new FanqieRankingCrawlerError("Unknown Fanqie ranking key");
    }

    const page = await this.client.fetchRanking(definition.rankTypeKey);
    return this.parser.parse({ ...page, definition });
  }
}
