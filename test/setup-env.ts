import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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
    "getRankingCrawler" | "getBookCrawler"
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
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.NODE_ENV = "test";
  process.env.QIDIAN_USER_AGENT = "NovelScope E2E tests";

  try {
    const { AppModule } = await import("../src/app.module");
    const moduleReference = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CrawlersService)
      .useValue(crawlersService)
      .compile();
    const app = moduleReference.createNestApplication();
    app.useLogger(false);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();

    return {
      app,
      prisma: app.get(PrismaService),
      async close() {
        try {
          await app.close();
        } finally {
          restoreEnvironment(
            originalDatabaseUrl,
            originalNodeEnvironment,
            originalQidianUserAgent,
          );
        }
      },
    };
  } catch (error) {
    restoreEnvironment(
      originalDatabaseUrl,
      originalNodeEnvironment,
      originalQidianUserAgent,
    );
    throw error;
  }
}

function restoreEnvironment(
  databaseUrl: string | undefined,
  nodeEnvironment: string | undefined,
  qidianUserAgent: string | undefined,
): void {
  if (databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = databaseUrl;

  if (nodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnvironment;

  if (qidianUserAgent === undefined) delete process.env.QIDIAN_USER_AGENT;
  else process.env.QIDIAN_USER_AGENT = qidianUserAgent;
}
