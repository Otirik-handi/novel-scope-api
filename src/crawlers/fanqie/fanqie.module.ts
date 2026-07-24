import { Logger, Module } from "@nestjs/common";
import { ConfigModule, type ConfigType } from "@nestjs/config";
import crawlerConfig from "../../config/crawler.config";
import { FanqieBookCrawler } from "./books/fanqie-book.crawler";
import { FanqieBrowserClient } from "./fanqie-browser.client";
import { FanqieRankingCatalog } from "./rankings/fanqie-ranking.catalog";
import { FanqieRankingCrawler } from "./rankings/fanqie-ranking.crawler";

@Module({
  imports: [ConfigModule.forFeature(crawlerConfig)],
  providers: [
    {
      provide: FanqieRankingCatalog,
      useFactory: () => new FanqieRankingCatalog(),
    },
    {
      provide: FanqieBrowserClient,
      inject: [crawlerConfig.KEY],
      useFactory: (config: ConfigType<typeof crawlerConfig>) =>
        new FanqieBrowserClient({
          logger: new Logger("FanqieBrowserClient"),
          requestTimeoutMs: config.fanqieRequestTimeoutMs,
        }),
    },
    {
      provide: FanqieRankingCrawler,
      inject: [FanqieBrowserClient, FanqieRankingCatalog],
      useFactory: (
        client: FanqieBrowserClient,
        catalog: FanqieRankingCatalog,
      ) => new FanqieRankingCrawler(client, catalog),
    },
    {
      provide: FanqieBookCrawler,
      inject: [FanqieBrowserClient],
      useFactory: (client: FanqieBrowserClient) =>
        new FanqieBookCrawler(client),
    },
  ],
  exports: [
    FanqieRankingCatalog,
    FanqieRankingCrawler,
    FanqieBookCrawler,
  ],
})
export class FanqieModule {}
