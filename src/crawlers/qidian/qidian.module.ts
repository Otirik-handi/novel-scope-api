import { Logger, Module } from "@nestjs/common";
import { ConfigModule, type ConfigType } from "@nestjs/config";
import crawlerConfig from "../../config/crawler.config";
import { QidianBookCrawler } from "./books/qidian-book.crawler";
import { QidianBrowserClient } from "./qidian-browser.client";
import { QidianClient } from "./qidian.client";
import { QidianRankingCrawler } from "./rankings/qidian-ranking.crawler";
import type { QidianPage } from "./qidian.client";

type PageFetcher = {
  fetchPage(pathOrUrl: string): Promise<QidianPage>;
};

@Module({
  imports: [ConfigModule.forFeature(crawlerConfig)],
  providers: [
    {
      provide: QidianBrowserClient,
      inject: [crawlerConfig.KEY],
      useFactory: (config: ConfigType<typeof crawlerConfig>) =>
        new QidianBrowserClient({
          logger: new Logger("QidianBrowserClient"),
          requestTimeoutMs: config.requestTimeoutMs,
        }),
    },
    {
      provide: QidianClient,
      inject: [crawlerConfig.KEY],
      useFactory: (config: ConfigType<typeof crawlerConfig>) =>
        new QidianClient({
          logger: new Logger("QidianClient"),
          requestTimeoutMs: config.requestTimeoutMs,
          userAgent: config.qidianUserAgent,
        }),
    },
    {
      provide: QidianRankingCrawler,
      inject: [QidianBrowserClient],
      useFactory: (client: PageFetcher) =>
        new QidianRankingCrawler(client),
    },
    {
      provide: QidianBookCrawler,
      inject: [QidianBrowserClient],
      useFactory: (client: PageFetcher) =>
        new QidianBookCrawler(client),
    },
  ],
  exports: [QidianRankingCrawler, QidianBookCrawler],
})
export class QidianModule {}
