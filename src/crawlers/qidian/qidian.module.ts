import { Logger, Module } from "@nestjs/common";
import { ConfigModule, type ConfigType } from "@nestjs/config";
import crawlerConfig from "../../config/crawler.config";
import { QidianBookCrawler } from "./books/qidian-book.crawler";
import { QidianChapterCrawler } from "./chapters/qidian-chapter.crawler";
import { QidianBrowserClient } from "./qidian-browser.client";
import { QidianClient } from "./qidian.client";
import { QidianRankingCatalog } from "./rankings/qidian-ranking.catalog";
import { QidianRankingCrawler } from "./rankings/qidian-ranking.crawler";
import type { QidianPage } from "./qidian.client";

type PageFetcher = {
  fetchPage(pathOrUrl: string): Promise<QidianPage>;
};

@Module({
  imports: [ConfigModule.forFeature(crawlerConfig)],
  providers: [
    QidianRankingCatalog,
    {
      provide: QidianBrowserClient,
      inject: [crawlerConfig.KEY],
      useFactory: (config: ConfigType<typeof crawlerConfig>) =>
        new QidianBrowserClient({
          logger: new Logger("QidianBrowserClient"),
          requestTimeoutMs: config.qidianRequestTimeoutMs,
        }),
    },
    {
      provide: QidianClient,
      inject: [crawlerConfig.KEY],
      useFactory: (config: ConfigType<typeof crawlerConfig>) =>
        new QidianClient({
          logger: new Logger("QidianClient"),
          requestTimeoutMs: config.qidianRequestTimeoutMs,
          userAgent: config.qidianUserAgent,
        }),
    },
    {
      provide: QidianRankingCrawler,
      inject: [QidianBrowserClient, QidianRankingCatalog],
      useFactory: (
        client: PageFetcher,
        catalog: QidianRankingCatalog,
      ) => new QidianRankingCrawler(client, catalog),
    },
    {
      provide: QidianBookCrawler,
      inject: [QidianBrowserClient],
      useFactory: (client: PageFetcher) =>
        new QidianBookCrawler(client),
    },
    {
      provide: QidianChapterCrawler,
      inject: [QidianBrowserClient],
      useFactory: (client: QidianBrowserClient) =>
        new QidianChapterCrawler(client),
    },
  ],
  exports: [
    QidianRankingCatalog,
    QidianRankingCrawler,
    QidianBookCrawler,
    QidianChapterCrawler,
  ],
})
export class QidianModule {}
