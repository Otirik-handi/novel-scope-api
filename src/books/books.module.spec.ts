import { Test } from "@nestjs/testing";
import appConfig from "../config/app.config";
import crawlerConfig from "../config/crawler.config";
import { CrawlersService } from "../crawlers/crawlers.service";
import { PrismaService } from "../shared/database/prisma.service";
import { BooksController } from "./books.controller";
import { BooksModule } from "./books.module";
import { BooksRepository } from "./books.repository";
import { BooksService } from "./books.service";

describe("BooksModule", () => {
  it("is wired into a compiled application module", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalUserAgent = process.env.QIDIAN_USER_AGENT;
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5432/novel_scope";
    process.env.QIDIAN_USER_AGENT = "NovelScope books module tests";

    try {
      const { AppModule } = await import("../app.module");
      const moduleReference = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue({})
        .overrideProvider(CrawlersService)
        .useValue({})
        .overrideProvider(appConfig.KEY)
        .useValue({
          bookDetailTtlHours: 3,
          rankingRefreshEnabled: false,
          qidianRankingRefreshCron: "0 0 6 * * *",
          fanqieRankingRefreshCron: "0 30 0 * * *",
          rankingRefreshTimeZone: "Asia/Shanghai",
        })
        .overrideProvider(crawlerConfig.KEY)
        .useValue({
          qidianUserAgent: "NovelScope books module tests",
          qidianRequestTimeoutMs: 1_000,
          fanqieRequestTimeoutMs: 1_000,
        })
        .compile();

      expect(moduleReference.get(BooksController)).toBeInstanceOf(
        BooksController,
      );
      await moduleReference.close();
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
      if (originalUserAgent === undefined) {
        delete process.env.QIDIAN_USER_AGENT;
      } else {
        process.env.QIDIAN_USER_AGENT = originalUserAgent;
      }
    }
  });

  it("wires the controller, repository, and service", async () => {
    const moduleReference = await Test.createTestingModule({
      imports: [BooksModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(CrawlersService)
      .useValue({})
      .overrideProvider(appConfig.KEY)
      .useValue({ bookDetailTtlHours: 3 })
      .overrideProvider(crawlerConfig.KEY)
      .useValue({
        qidianUserAgent: "NovelScope books module tests",
        qidianRequestTimeoutMs: 1_000,
        fanqieRequestTimeoutMs: 1_000,
      })
      .compile();

    expect(moduleReference.get(BooksController)).toBeInstanceOf(
      BooksController,
    );
    expect(moduleReference.get(BooksRepository)).toBeInstanceOf(
      BooksRepository,
    );
    expect(moduleReference.get(BooksService)).toBeInstanceOf(BooksService);

    await moduleReference.close();
  });
});
