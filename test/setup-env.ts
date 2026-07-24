import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { assertDatabaseIsolation } from "../scripts/database-isolation.cjs";
import { CrawlersService } from "../src/crawlers/crawlers.service";
import { PrismaService } from "../src/shared/database/prisma.service";

export interface E2eApplication {
  app: INestApplication;
  prisma: PrismaService;
  close(): Promise<void>;
}

export async function createE2eApplication(
  crawlersService: Pick<
    CrawlersService,
    "getRankingCatalog" | "getRankingCrawler" | "getBookCrawler"
  >,
): Promise<E2eApplication> {
  const applicationDatabaseUrl = process.env.DATABASE_URL?.trim();
  const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

  await assertDatabaseIsolation({
    applicationDatabaseUrl,
    testDatabaseUrl,
  });

  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  const originalQidianUserAgent = process.env.QIDIAN_USER_AGENT;
  const originalFanqieRequestTimeoutMs = process.env.FANQIE_REQUEST_TIMEOUT_MS;
  const originalFanqieRankingRefreshCron = process.env.FANQIE_RANKING_REFRESH_CRON;
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.NODE_ENV = "test";
  process.env.QIDIAN_USER_AGENT = "NovelScope E2E tests";
  process.env.FANQIE_REQUEST_TIMEOUT_MS = "10000";
  process.env.FANQIE_RANKING_REFRESH_CRON = "0 30 0 * * *";

  let moduleReference: TestingModule | undefined;
  let app: INestApplication | undefined;

  try {
    const { AppModule } = await import("../src/app.module");
    moduleReference = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CrawlersService)
      .useValue(crawlersService)
      .compile();
    app = moduleReference.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
    const initializedApp = app;
    let closePromise: Promise<void> | undefined;

    return {
      app: initializedApp,
      prisma: initializedApp.get(PrismaService),
      close() {
        if (closePromise === undefined) {
          closePromise = (async () => {
            try {
              await initializedApp.close();
            } finally {
              restoreEnvironment(
                originalDatabaseUrl,
                originalNodeEnvironment,
                originalQidianUserAgent,
                originalFanqieRequestTimeoutMs,
                originalFanqieRankingRefreshCron,
              );
            }
          })();
        }

        return closePromise;
      },
    };
  } catch (error) {
    try {
      await closeFailedInitialization(app, moduleReference);
    } finally {
      restoreEnvironment(
        originalDatabaseUrl,
        originalNodeEnvironment,
        originalQidianUserAgent,
        originalFanqieRequestTimeoutMs,
        originalFanqieRankingRefreshCron,
      );
    }
    throw error;
  }
}

async function closeFailedInitialization(
  app: INestApplication | undefined,
  moduleReference: TestingModule | undefined,
): Promise<void> {
  if (app !== undefined) {
    try {
      await app.close();
      return;
    } catch {
      // Fall through so the underlying TestingModule gets a cleanup attempt.
    }
  }

  if (moduleReference !== undefined) {
    await moduleReference.close().catch(() => undefined);
  }
}

function restoreEnvironment(
  databaseUrl: string | undefined,
  nodeEnvironment: string | undefined,
  qidianUserAgent: string | undefined,
  fanqieRequestTimeoutMs: string | undefined,
  fanqieRankingRefreshCron: string | undefined,
): void {
  if (databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = databaseUrl;

  if (nodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnvironment;

  if (qidianUserAgent === undefined) delete process.env.QIDIAN_USER_AGENT;
  else process.env.QIDIAN_USER_AGENT = qidianUserAgent;

  if (fanqieRequestTimeoutMs === undefined) {
    delete process.env.FANQIE_REQUEST_TIMEOUT_MS;
  } else {
    process.env.FANQIE_REQUEST_TIMEOUT_MS = fanqieRequestTimeoutMs;
  }

  if (fanqieRankingRefreshCron === undefined) {
    delete process.env.FANQIE_RANKING_REFRESH_CRON;
  } else {
    process.env.FANQIE_RANKING_REFRESH_CRON = fanqieRankingRefreshCron;
  }
}
