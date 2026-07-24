import { Injectable, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import crawlerConfig from "../config/crawler.config";
import type { Platform } from "../shared/types/platform.type";
import { CrawlersModule } from "./crawlers.module";
import { CrawlersService } from "./crawlers.service";
import { FanqieBookCrawler } from "./fanqie/books/fanqie-book.crawler";
import { FanqieRankingCatalog } from "./fanqie/rankings/fanqie-ranking.catalog";
import { FanqieRankingCrawler } from "./fanqie/rankings/fanqie-ranking.crawler";
import { QidianBookCrawler } from "./qidian/books/qidian-book.crawler";
import { QidianRankingCatalog } from "./qidian/rankings/qidian-ranking.catalog";
import { QidianRankingCrawler } from "./qidian/rankings/qidian-ranking.crawler";

describe("CrawlersService", () => {
  const qidianRankingCrawler = {
    crawl: jest.fn(),
  } as unknown as QidianRankingCrawler;
  const qidianBookCrawler = {
    crawl: jest.fn(),
  } as unknown as QidianBookCrawler;
  const qidianRankingCatalog = new QidianRankingCatalog();
  const fanqieRankingCrawler = {
    crawl: jest.fn(),
  } as unknown as FanqieRankingCrawler;
  const fanqieBookCrawler = {
    crawl: jest.fn(),
  } as unknown as FanqieBookCrawler;
  const fanqieRankingCatalog = new FanqieRankingCatalog();
  const service = new CrawlersService(
    qidianRankingCrawler,
    qidianBookCrawler,
    qidianRankingCatalog,
    fanqieRankingCrawler,
    fanqieBookCrawler,
    fanqieRankingCatalog,
  );

  it("routes ranking catalogs by platform", () => {
    expect(service.getRankingCatalog("qidian")).toBe(qidianRankingCatalog);
    expect(service.getRankingCatalog("fanqie")).toBe(fanqieRankingCatalog);
    expect(qidianRankingCatalog.resolve("0_1_1139")).toBeNull();
    expect(fanqieRankingCatalog.resolve("yuepiao")).toBeNull();
  });

  it("routes ranking crawlers by platform", () => {
    expect(service.getRankingCrawler("qidian")).toBe(qidianRankingCrawler);
    expect(service.getRankingCrawler("fanqie")).toBe(fanqieRankingCrawler);
  });

  it("routes book crawlers by platform", () => {
    expect(service.getBookCrawler("qidian")).toBe(qidianBookCrawler);
    expect(service.getBookCrawler("fanqie")).toBe(fanqieBookCrawler);
  });

  it.each([
    "getRankingCatalog",
    "getRankingCrawler",
    "getBookCrawler",
  ] as const)(
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
        qidianRequestTimeoutMs: 1_000,
        fanqieRequestTimeoutMs: 1_000,
      })
      .compile();

    const consumer = moduleReference.get(CrawlersConsumer);

    expect(consumer.crawlersService).toBeInstanceOf(CrawlersService);
    expect(
      consumer.crawlersService.getRankingCrawler("qidian"),
    ).toBeInstanceOf(QidianRankingCrawler);
    expect(
      consumer.crawlersService.getRankingCrawler("fanqie"),
    ).toBeInstanceOf(FanqieRankingCrawler);
    expect(consumer.crawlersService.getBookCrawler("qidian")).toBeInstanceOf(
      QidianBookCrawler,
    );
    expect(consumer.crawlersService.getBookCrawler("fanqie")).toBeInstanceOf(
      FanqieBookCrawler,
    );
    expect(consumer.crawlersService.getRankingCatalog("qidian")).toBeInstanceOf(
      QidianRankingCatalog,
    );
    expect(consumer.crawlersService.getRankingCatalog("fanqie")).toBeInstanceOf(
      FanqieRankingCatalog,
    );

    await moduleReference.close();
  });
});
