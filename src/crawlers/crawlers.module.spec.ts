import { Test } from "@nestjs/testing";
import crawlerConfig from "../config/crawler.config";
import { CrawlersModule } from "./crawlers.module";
import { CrawlersService } from "./crawlers.service";
import { QidianChapterCrawler } from "./qidian/chapters/qidian-chapter.crawler";
import { QidianModule } from "./qidian/qidian.module";

describe("CrawlersModule", () => {
  it("provides crawler services and exported qidian crawlers", async () => {
    const moduleReference = await Test.createTestingModule({
      imports: [CrawlersModule],
    })
      .overrideProvider(crawlerConfig.KEY)
      .useValue({
        qidianUserAgent: "NovelScope crawlers module tests",
        qidianRequestTimeoutMs: 1_000,
        fanqieRequestTimeoutMs: 1_000,
      })
      .compile();

    expect(moduleReference.get(CrawlersService)).toBeInstanceOf(
      CrawlersService,
    );
    expect(moduleReference.get(QidianChapterCrawler)).toBeInstanceOf(
      QidianChapterCrawler,
    );
    expect(Reflect.getMetadata("exports", CrawlersModule)).toContain(
      QidianModule,
    );

    await moduleReference.close();
  });
});
