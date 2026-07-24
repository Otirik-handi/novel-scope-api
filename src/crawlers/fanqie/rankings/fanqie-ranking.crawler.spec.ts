import type { CrawledRanking, RankingDefinition } from "../../interfaces";
import type { FanqieBrowserClient } from "../fanqie-browser.client";
import type { FanqieRankingCatalog } from "./fanqie-ranking.catalog";
import {
  FanqieRankingCrawler,
  FanqieRankingCrawlerError,
} from "./fanqie-ranking.crawler";
import type { FanqieRankingParser } from "./fanqie-ranking.parser";

describe("FanqieRankingCrawler", () => {
  const definition: RankingDefinition = {
    platform: "fanqie",
    rankTypeKey: "0_1_1139",
    rankType: "女频-新书榜-古风世情",
  };
  const page = {
    initialState: { rankData: { bookList: [] } },
    sourceUrl: "https://fanqienovel.com/rank/0_1_1139",
    fetchedAt: new Date("2026-07-24T00:30:00.000Z"),
  };

  function createSubject(resolved: RankingDefinition | null = definition) {
    const client = { fetchRanking: jest.fn().mockResolvedValue(page) };
    const catalog = { resolve: jest.fn().mockReturnValue(resolved) };
    const ranking = { platform: "fanqie" } as CrawledRanking;
    const parser = { parse: jest.fn().mockReturnValue(ranking) };
    const crawler = new FanqieRankingCrawler(
      client as unknown as Pick<FanqieBrowserClient, "fetchRanking">,
      catalog as unknown as FanqieRankingCatalog,
      parser as unknown as FanqieRankingParser,
    );
    return { crawler, client, catalog, parser, ranking };
  }

  it("rejects an unknown key before opening the browser", async () => {
    const { crawler, client } = createSubject(null);

    await expect(crawler.crawl("unknown")).rejects.toBeInstanceOf(
      FanqieRankingCrawlerError,
    );
    expect(client.fetchRanking).not.toHaveBeenCalled();
  });

  it("passes the resolved definition and page to the parser", async () => {
    const { crawler, client, catalog, parser, ranking } = createSubject();

    await expect(crawler.crawl("0_1_1139")).resolves.toBe(ranking);
    expect(catalog.resolve).toHaveBeenCalledWith("0_1_1139");
    expect(client.fetchRanking).toHaveBeenCalledWith("0_1_1139");
    expect(parser.parse).toHaveBeenCalledWith({ ...page, definition });
  });
});
