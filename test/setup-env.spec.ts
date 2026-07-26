import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { assertDatabaseIsolation } from "../scripts/database-isolation.cjs";
import type { CrawlersService } from "../src/crawlers/crawlers.service";
import { createE2eApplication } from "./setup-env";

jest.mock("@nestjs/testing", () => ({
  Test: { createTestingModule: jest.fn() },
}));
jest.mock("../scripts/database-isolation.cjs", () => ({
  assertDatabaseIsolation: jest.fn(),
}));
jest.mock("../src/app.module", () => ({ AppModule: class MockAppModule {} }));

const environmentKeys = [
  "DATABASE_URL",
  "TEST_DATABASE_URL",
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

describe("createE2eApplication lifecycle", () => {
  const originalEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  const crawlersService = {
    getRankingCatalog: jest.fn(),
    getRankingCrawler: jest.fn(),
    getBookCrawler: jest.fn(),
  } as unknown as Pick<
    CrawlersService,
    "getRankingCatalog" | "getRankingCrawler" | "getBookCrawler"
  >;
  let app: {
    useLogger: jest.Mock;
    useGlobalPipes: jest.Mock;
    init: jest.Mock;
    close: jest.Mock;
    get: jest.Mock;
  };
  let moduleReference: {
    createNestApplication: jest.Mock;
    close: jest.Mock;
  };

  beforeEach(() => {
    process.env.DATABASE_URL = "application-database";
    process.env.TEST_DATABASE_URL = "test-database";
    process.env.NODE_ENV = "development";
    process.env.QIDIAN_USER_AGENT = "original-user-agent";
    process.env.FANQIE_REQUEST_TIMEOUT_MS = "54321";
    process.env.FANQIE_RANKING_REFRESH_CRON = "0 15 3 * * *";
    process.env.TOMATO_DOWNLOADER_BASE_URL = "http://original:18423";
    process.env.TOMATO_DOWNLOADER_PASSWORD = "original-secret";
    process.env.DOWNLOAD_ARTIFACT_DIR = "C:/original-artifacts";
    process.env.TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS = "11111";
    process.env.TOMATO_DOWNLOAD_POLL_INTERVAL_MS = "2222";
    process.env.TOMATO_DOWNLOAD_TASK_TIMEOUT_MS = "33333";
    jest.mocked(assertDatabaseIsolation).mockResolvedValue(undefined);

    app = {
      useLogger: jest.fn(),
      useGlobalPipes: jest.fn(),
      init: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockReturnValue({}),
    };
    moduleReference = {
      createNestApplication: jest.fn().mockReturnValue(app as unknown as INestApplication),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const builder = {
      overrideProvider: jest.fn(),
      useValue: jest.fn(),
      compile: jest.fn().mockResolvedValue(moduleReference),
    };
    builder.overrideProvider.mockReturnValue(builder);
    builder.useValue.mockReturnValue(builder);
    jest.mocked(Test.createTestingModule).mockReturnValue(builder as never);
  });

  afterEach(() => {
    jest.clearAllMocks();
    for (const key of environmentKeys) {
      const value = originalEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function expectOriginalEnvironment(): void {
    expect(process.env.DATABASE_URL).toBe("application-database");
    expect(process.env.TEST_DATABASE_URL).toBe("test-database");
    expect(process.env.NODE_ENV).toBe("development");
    expect(process.env.QIDIAN_USER_AGENT).toBe("original-user-agent");
    expect(process.env.FANQIE_REQUEST_TIMEOUT_MS).toBe("54321");
    expect(process.env.FANQIE_RANKING_REFRESH_CRON).toBe("0 15 3 * * *");
    expect(process.env.TOMATO_DOWNLOADER_BASE_URL).toBe("http://original:18423");
    expect(process.env.TOMATO_DOWNLOADER_PASSWORD).toBe("original-secret");
    expect(process.env.DOWNLOAD_ARTIFACT_DIR).toBe("C:/original-artifacts");
    expect(process.env.TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS).toBe("11111");
    expect(process.env.TOMATO_DOWNLOAD_POLL_INTERVAL_MS).toBe("2222");
    expect(process.env.TOMATO_DOWNLOAD_TASK_TIMEOUT_MS).toBe("33333");
  }

  it("closes an app whose initialization fails and preserves the init error", async () => {
    const initError = new Error("init failed");
    app.init.mockRejectedValue(initError);

    await expect(createE2eApplication(crawlersService)).rejects.toBe(initError);

    expect(app.close).toHaveBeenCalledTimes(1);
    expectOriginalEnvironment();
  });

  it("restores the environment and preserves the init error when closing also fails", async () => {
    const initError = new Error("init failed");
    app.init.mockRejectedValue(initError);
    app.close.mockRejectedValue(new Error("close failed"));

    await expect(createE2eApplication(crawlersService)).rejects.toBe(initError);

    expect(app.close).toHaveBeenCalledTimes(1);
    expectOriginalEnvironment();
  });

  it("closes the compiled module when application creation fails", async () => {
    const createError = new Error("create app failed");
    moduleReference.createNestApplication.mockImplementation(() => {
      throw createError;
    });

    await expect(createE2eApplication(crawlersService)).rejects.toBe(createError);

    expect(moduleReference.close).toHaveBeenCalledTimes(1);
    expectOriginalEnvironment();
  });

  it("closes a successfully initialized application only once", async () => {
    const context = await createE2eApplication(crawlersService);
    expect(process.env.DATABASE_URL).toBe("test-database");
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.QIDIAN_USER_AGENT).toBe("NovelScope E2E tests");
    expect(process.env.FANQIE_REQUEST_TIMEOUT_MS).toBe("10000");
    expect(process.env.FANQIE_RANKING_REFRESH_CRON).toBe("0 30 0 * * *");
    expect(process.env.TOMATO_DOWNLOADER_BASE_URL).toBe("http://127.0.0.1:18423");
    expect(process.env.TOMATO_DOWNLOADER_PASSWORD).toBeUndefined();
    expect(process.env.DOWNLOAD_ARTIFACT_DIR).toContain("novel-scope-e2e-artifacts-");
    expect(process.env.TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS).toBe("10000");
    expect(process.env.TOMATO_DOWNLOAD_POLL_INTERVAL_MS).toBe("1000");
    expect(process.env.TOMATO_DOWNLOAD_TASK_TIMEOUT_MS).toBe("7200000");

    await Promise.all([context.close(), context.close()]);

    expect(app.close).toHaveBeenCalledTimes(1);
    expectOriginalEnvironment();
  });

  it("restores the environment when successful-context close fails", async () => {
    const closeError = new Error("close failed");
    app.close.mockRejectedValue(closeError);
    const context = await createE2eApplication(crawlersService);

    await expect(context.close()).rejects.toBe(closeError);
    await expect(context.close()).rejects.toBe(closeError);

    expect(app.close).toHaveBeenCalledTimes(1);
    expectOriginalEnvironment();
  });
});
