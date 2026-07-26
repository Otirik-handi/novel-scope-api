import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertDatabaseIsolation } from "../scripts/database-isolation.cjs";
import { CrawlersService } from "../src/crawlers/crawlers.service";
import { DownloadsWorker } from "../src/downloads/downloads.worker";
import { TomatoDownloaderClient } from "../src/downloads/tomato-downloader/tomato-downloader.client";
import { PrismaService } from "../src/shared/database/prisma.service";

export interface E2eApplication {
  app: INestApplication;
  prisma: PrismaService;
  artifactDirectory: string;
  close(): Promise<void>;
}

export interface E2eApplicationOptions {
  tomatoDownloaderClient?: TomatoDownloaderClient;
  disableDownloadsWorker?: boolean;
}

const MANAGED_ENVIRONMENT_KEYS = [
  "DATABASE_URL",
  "NODE_ENV",
  "QIDIAN_USER_AGENT",
  "FANQIE_REQUEST_TIMEOUT_MS",
  "FANQIE_RANKING_REFRESH_CRON",
  "TOMATO_DOWNLOADER_BASE_URL",
  "TOMATO_DOWNLOADER_PASSWORD",
  "DOWNLOAD_ARTIFACT_DIR",
  "TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS",
  "TOMATO_DOWNLOAD_POLL_INTERVAL_MS",
  "TOMATO_DOWNLOAD_TASK_TIMEOUT_MS",
] as const;

export async function createE2eApplication(
  crawlersService: Pick<
    CrawlersService,
    "getRankingCatalog" | "getRankingCrawler" | "getBookCrawler"
  >,
  options: E2eApplicationOptions = {},
): Promise<E2eApplication> {
  const applicationDatabaseUrl = process.env.DATABASE_URL?.trim();
  const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();

  await assertDatabaseIsolation({
    applicationDatabaseUrl,
    testDatabaseUrl,
  });

  const originalEnvironment = Object.fromEntries(
    MANAGED_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
  );
  const artifactDirectory = await mkdtemp(
    join(tmpdir(), "novel-scope-e2e-artifacts-"),
  );
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.NODE_ENV = "test";
  process.env.QIDIAN_USER_AGENT = "NovelScope E2E tests";
  process.env.FANQIE_REQUEST_TIMEOUT_MS = "10000";
  process.env.FANQIE_RANKING_REFRESH_CRON = "0 30 0 * * *";
  process.env.TOMATO_DOWNLOADER_BASE_URL = "http://127.0.0.1:18423";
  delete process.env.TOMATO_DOWNLOADER_PASSWORD;
  process.env.DOWNLOAD_ARTIFACT_DIR = artifactDirectory;
  process.env.TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS = "10000";
  process.env.TOMATO_DOWNLOAD_POLL_INTERVAL_MS = "60000";
  process.env.TOMATO_DOWNLOAD_TASK_TIMEOUT_MS = "7200000";

  let moduleReference: TestingModule | undefined;
  let app: INestApplication | undefined;

  try {
    const { AppModule } = await import("../src/app.module");
    const builder = Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CrawlersService)
      .useValue(crawlersService);
    if (options.tomatoDownloaderClient !== undefined) {
      builder
        .overrideProvider(TomatoDownloaderClient)
        .useValue(options.tomatoDownloaderClient);
    }
    if (
      options.disableDownloadsWorker ??
      options.tomatoDownloaderClient === undefined
    ) {
      builder.overrideProvider(DownloadsWorker).useValue({});
    }
    moduleReference = await builder.compile();
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
      artifactDirectory,
      close() {
        if (closePromise === undefined) {
          closePromise = (async () => {
            try {
              await initializedApp.close();
            } finally {
              await rm(artifactDirectory, { recursive: true, force: true });
              restoreEnvironment(originalEnvironment);
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
      await rm(artifactDirectory, { recursive: true, force: true });
      restoreEnvironment(originalEnvironment);
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
  originalEnvironment: Record<string, string | undefined>,
): void {
  for (const key of MANAGED_ENVIRONMENT_KEYS) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
