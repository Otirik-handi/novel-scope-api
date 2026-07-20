import { Module } from "@nestjs/common";
import { ConfigModule, type ConfigType } from "@nestjs/config";
import crawlerConfig from "../../config/crawler.config";
import { QidianBookCrawler } from "./books/qidian-book.crawler";
import { QidianClient } from "./qidian.client";
import { QidianRankingCrawler } from "./rankings/qidian-ranking.crawler";

@Module({
  imports: [ConfigModule.forFeature(crawlerConfig)],
  providers: [
    {
      provide: QidianClient,
      inject: [crawlerConfig.KEY],
      useFactory: (config: ConfigType<typeof crawlerConfig>) =>
        new QidianClient({
          requestTimeoutMs: config.requestTimeoutMs,
          userAgent: config.qidianUserAgent,
        }),
    },
    {
      provide: QidianRankingCrawler,
      inject: [QidianClient],
      useFactory: (client: QidianClient) =>
        new QidianRankingCrawler(client),
    },
    {
      provide: QidianBookCrawler,
      inject: [QidianClient],
      useFactory: (client: QidianClient) => new QidianBookCrawler(client),
    },
  ],
  exports: [QidianRankingCrawler, QidianBookCrawler],
})
export class QidianModule {}
