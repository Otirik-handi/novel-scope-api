import { Test } from "@nestjs/testing";
import appConfig from "../config/app.config";
import crawlerConfig from "../config/crawler.config";
import { CrawlersService } from "../crawlers/crawlers.service";
import { PrismaService } from "../shared/database/prisma.service";
import { RankingsController } from "./rankings.controller";
import { RankingsModule } from "./rankings.module";
import { RankingsRepository } from "./rankings.repository";
import { RankingsScheduler } from "./rankings.scheduler";
import { RankingsService } from "./rankings.service";

describe("RankingsModule", () => {
  it("is imported by the application module", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalUserAgent = process.env.QIDIAN_USER_AGENT;
    const originalDownloaderUrl = process.env.TOMATO_DOWNLOADER_BASE_URL;
    const originalArtifactDirectory = process.env.DOWNLOAD_ARTIFACT_DIR;
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5432/novel_scope";
    process.env.QIDIAN_USER_AGENT = "NovelScope rankings module tests";
    process.env.TOMATO_DOWNLOADER_BASE_URL = "http://127.0.0.1:18423";
    process.env.DOWNLOAD_ARTIFACT_DIR = "C:/NovelScope/downloads";

    const { AppModule } = await import("../app.module");
    const imports = Reflect.getMetadata("imports", AppModule) as unknown[];

    try {
      expect(imports).toContain(RankingsModule);
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
      if (originalDownloaderUrl === undefined) {
        delete process.env.TOMATO_DOWNLOADER_BASE_URL;
      } else {
        process.env.TOMATO_DOWNLOADER_BASE_URL = originalDownloaderUrl;
      }
      if (originalArtifactDirectory === undefined) {
        delete process.env.DOWNLOAD_ARTIFACT_DIR;
      } else {
        process.env.DOWNLOAD_ARTIFACT_DIR = originalArtifactDirectory;
      }
    }
  });

  it("wires the controller, repository, service, and scheduler", async () => {
    const moduleReference = await Test.createTestingModule({
      imports: [RankingsModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(CrawlersService)
      .useValue({})
      .overrideProvider(appConfig.KEY)
      .useValue({
        rankingRefreshEnabled: false,
        qidianRankingRefreshCron: "0 0 6 * * *",
        fanqieRankingRefreshCron: "0 30 0 * * *",
        rankingRefreshTimeZone: "Asia/Shanghai",
      })
      .overrideProvider(crawlerConfig.KEY)
      .useValue({
        qidianUserAgent: "NovelScope rankings module tests",
        qidianRequestTimeoutMs: 1_000,
        fanqieRequestTimeoutMs: 1_000,
      })
      .compile();

    expect(moduleReference.get(RankingsController)).toBeInstanceOf(
      RankingsController,
    );
    expect(moduleReference.get(RankingsRepository)).toBeInstanceOf(
      RankingsRepository,
    );
    expect(moduleReference.get(RankingsService)).toBeInstanceOf(
      RankingsService,
    );
    expect(moduleReference.get(RankingsScheduler)).toBeInstanceOf(
      RankingsScheduler,
    );

    await moduleReference.close();
  });
});
