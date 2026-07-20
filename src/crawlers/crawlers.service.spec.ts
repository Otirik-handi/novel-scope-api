import { Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import crawlerConfig from "../config/crawler.config";
import type { Platform } from "../shared/types/platform.type";
import { CrawlersModule } from "./crawlers.module";
import { CrawlersService } from "./crawlers.service";
import { QidianBookCrawler } from "./qidian/books/qidian-book.crawler";
import { QidianRankingCrawler } from "./qidian/rankings/qidian-ranking.crawler";

describe("CrawlersService", () => {
  const qidianRankingCrawler = {
    crawl: jest.fn(),
  } as unknown as QidianRankingCrawler;
  const qidianBookCrawler = {
    crawl: jest.fn(),
  } as unknown as QidianBookCrawler;
  const service = new CrawlersService(
    qidianRankingCrawler,
    qidianBookCrawler,
  );

  it("routes qidian ranking requests to the Qidian ranking crawler", () => {
    expect(service.getRankingCrawler("qidian")).toBe(qidianRankingCrawler);
  });

  it("routes qidian book requests to the Qidian book crawler", () => {
    expect(service.getBookCrawler("qidian")).toBe(qidianBookCrawler);
  });

  it.each(["getRankingCrawler", "getBookCrawler"] as const)(
    "%s rejects an unsupported platform",
    (method) => {
      expect(() => service[method]("unsupported" as Platform)).toThrow(
        "Unsupported crawler platform: unsupported",
      );
    },
  );
});

describe("CrawlersModule", () => {
  @Injectable()
  class CrawlersConsumer {
    constructor(readonly crawlersService: CrawlersService) {}
  }

  @Module({
    imports: [CrawlersModule],
    providers: [CrawlersConsumer],
  })
  class CrawlersConsumerModule {}

  it("exports an instantiated CrawlersService to business modules", async () => {
    const moduleReference = await Test.createTestingModule({
      imports: [CrawlersConsumerModule],
    })
      .overrideProvider(crawlerConfig.KEY)
      .useValue({
        qidianUserAgent: "NovelScope crawler module tests",
        requestTimeoutMs: 1_000,
      })
      .compile();

    const consumer = moduleReference.get(CrawlersConsumer);

    expect(consumer.crawlersService).toBeInstanceOf(CrawlersService);
    expect(
      consumer.crawlersService.getRankingCrawler("qidian"),
    ).toBeInstanceOf(QidianRankingCrawler);
    expect(consumer.crawlersService.getBookCrawler("qidian")).toBeInstanceOf(
      QidianBookCrawler,
    );

    await moduleReference.close();
  });
});
