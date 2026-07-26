import { resolve } from "node:path";
import { ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import appConfig from "./app.config";
import crawlerConfig from "./crawler.config";
import databaseConfig from "./database.config";
import { validateEnvironment } from "./env.validation";

const requiredEnvironment = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/novel_scope",
  QIDIAN_USER_AGENT: "NovelScope/0.1",
  TOMATO_DOWNLOADER_BASE_URL: "http://127.0.0.1:18423",
  DOWNLOAD_ARTIFACT_DIR: "C:/NovelScope/downloads",
};

const configurationEnvironmentKeys = [
  "DATABASE_URL",
  "QIDIAN_USER_AGENT",
  "PORT",
  "QIDIAN_REQUEST_TIMEOUT_MS",
  "FANQIE_REQUEST_TIMEOUT_MS",
  "BOOK_DETAIL_TTL_HOURS",
  "RANKING_REFRESH_CRON",
  "FANQIE_RANKING_REFRESH_CRON",
  "RANKING_REFRESH_TIME_ZONE",
  "TOMATO_DOWNLOADER_BASE_URL",
  "TOMATO_DOWNLOADER_PASSWORD",
  "DOWNLOAD_ARTIFACT_DIR",
  "TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS",
  "TOMATO_DOWNLOAD_POLL_INTERVAL_MS",
  "TOMATO_DOWNLOAD_TASK_TIMEOUT_MS",
  "NODE_ENV",
] as const;

function withEnvironment<T>(
  environment: Record<string, string>,
  action: () => T,
): T {
  const originalEnvironment = Object.fromEntries(
    configurationEnvironmentKeys.map((key) => [key, process.env[key]]),
  );

  for (const key of configurationEnvironmentKeys) {
    delete process.env[key];
  }

  Object.assign(process.env, environment);

  try {
    return action();
  } finally {
    for (const key of configurationEnvironmentKeys) {
      const value = originalEnvironment[key];

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("validateEnvironment", () => {
  it("loads app configuration independently", () => {
    withEnvironment(
      {
        PORT: "3100",
        BOOK_DETAIL_TTL_HOURS: "6",
        RANKING_REFRESH_CRON: " 0 0 7 * * * ",
        FANQIE_RANKING_REFRESH_CRON: " 0 45 0 * * * ",
        RANKING_REFRESH_TIME_ZONE: " Asia/Shanghai ",
      },
      () => {
        expect(appConfig()).toEqual({
          port: 3100,
          bookDetailTtlHours: 6,
          rankingRefreshEnabled: true,
          qidianRankingRefreshCron: "0 0 7 * * *",
          fanqieRankingRefreshCron: "0 45 0 * * *",
          rankingRefreshTimeZone: "Asia/Shanghai",
        });
      },
    );
  });

  it("enables scheduled refreshes outside the test environment", () => {
    withEnvironment({ NODE_ENV: "production" }, () => {
      expect(appConfig()?.rankingRefreshEnabled).toBe(true);
    });
  });

  it("disables scheduled refreshes in the test environment", () => {
    withEnvironment({ NODE_ENV: "test" }, () => {
      expect(appConfig()?.rankingRefreshEnabled).toBe(false);
    });
  });

  it("loads database configuration independently", () => {
    withEnvironment(
      {
        DATABASE_URL:
          "  postgresql://postgres:postgres@localhost:5432/novel_scope  ",
      },
      () => {
        expect(databaseConfig()).toEqual({
          url: "postgresql://postgres:postgres@localhost:5432/novel_scope",
        });
      },
    );
  });

  it("loads crawler configuration independently", () => {
    withEnvironment(
      {
        QIDIAN_USER_AGENT: "  NovelScope/0.1  ",
        QIDIAN_REQUEST_TIMEOUT_MS: "15000",
        FANQIE_REQUEST_TIMEOUT_MS: "25000",
      },
      () => {
        expect(crawlerConfig()).toEqual({
          qidianUserAgent: "NovelScope/0.1",
          qidianRequestTimeoutMs: 15_000,
          fanqieRequestTimeoutMs: 25_000,
        });
      },
    );
  });

  it.each(["DATABASE_URL", "QIDIAN_USER_AGENT"] as const)(
    "requires %s",
    (key) => {
      const environment = { ...requiredEnvironment };
      delete environment[key];

      expect(() => validateEnvironment(environment)).toThrow(
        `${key} is required`,
      );
    },
  );

  it("applies defaults for optional settings", () => {
    expect(validateEnvironment(requiredEnvironment)).toEqual({
      ...requiredEnvironment,
      PORT: 3000,
      QIDIAN_REQUEST_TIMEOUT_MS: 10_000,
      FANQIE_REQUEST_TIMEOUT_MS: 10_000,
      BOOK_DETAIL_TTL_HOURS: 3,
      RANKING_REFRESH_CRON: "0 0 6 * * *",
      FANQIE_RANKING_REFRESH_CRON: "0 30 0 * * *",
      RANKING_REFRESH_TIME_ZONE: "Asia/Shanghai",
      TOMATO_DOWNLOADER_PASSWORD: null,
      TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS: 10_000,
      TOMATO_DOWNLOAD_POLL_INTERVAL_MS: 1_000,
      TOMATO_DOWNLOAD_TASK_TIMEOUT_MS: 7_200_000,
      DOWNLOAD_ARTIFACT_DIR: resolve("C:/NovelScope/downloads"),
    });
  });

  it("normalizes explicitly configured numbers", () => {
    expect(
      validateEnvironment({
        ...requiredEnvironment,
        PORT: "3100",
        QIDIAN_REQUEST_TIMEOUT_MS: "15000",
        FANQIE_REQUEST_TIMEOUT_MS: "25000",
        BOOK_DETAIL_TTL_HOURS: "6",
      }),
    ).toMatchObject({
      PORT: 3100,
      QIDIAN_REQUEST_TIMEOUT_MS: 15_000,
      FANQIE_REQUEST_TIMEOUT_MS: 25_000,
      BOOK_DETAIL_TTL_HOURS: 6,
    });
  });

  it.each([
    ["PORT", "not-a-number"],
    ["PORT", "3000.5"],
    ["PORT", "0"],
    ["PORT", "65536"],
    ["QIDIAN_REQUEST_TIMEOUT_MS", "0"],
    ["QIDIAN_REQUEST_TIMEOUT_MS", "10.5"],
    ["FANQIE_REQUEST_TIMEOUT_MS", "0"],
    ["FANQIE_REQUEST_TIMEOUT_MS", "-1"],
    ["FANQIE_REQUEST_TIMEOUT_MS", "10.5"],
    ["BOOK_DETAIL_TTL_HOURS", "-1"],
    ["BOOK_DETAIL_TTL_HOURS", "1.5"],
  ])("rejects invalid numeric setting %s=%s", (key, value) => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment, [key]: value }),
    ).toThrow(`${key} must be a positive integer`);
  });

  it.each([
    "QIDIAN_REQUEST_TIMEOUT_MS",
    "FANQIE_REQUEST_TIMEOUT_MS",
  ] as const)("limits %s to the maximum Node timer delay", (key) => {
    expect(
      validateEnvironment({
        ...requiredEnvironment,
        [key]: "2147483647",
      })[key],
    ).toBe(2_147_483_647);

    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        [key]: "2147483648",
      }),
    ).toThrow(`${key} must be a positive integer`);
  });

  it.each([
    "RANKING_REFRESH_CRON",
    "FANQIE_RANKING_REFRESH_CRON",
  ] as const)("rejects an invalid %s expression", (key) => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        [key]: "not-a-cron-expression",
      }),
    ).toThrow(`${key} must be a valid cron expression`);
  });

  it("rejects an invalid ranking refresh time zone", () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        RANKING_REFRESH_TIME_ZONE: "Invalid/TimeZone",
      }),
    ).toThrow("RANKING_REFRESH_TIME_ZONE must be a valid IANA time zone");
  });

  it("accepts UTC and rejects ambiguous time zone abbreviations", () => {
    expect(
      validateEnvironment({
        ...requiredEnvironment,
        RANKING_REFRESH_TIME_ZONE: "UTC",
      }).RANKING_REFRESH_TIME_ZONE,
    ).toBe("UTC");

    for (const timeZone of ["CST", "PST"]) {
      expect(() =>
        validateEnvironment({
          ...requiredEnvironment,
          RANKING_REFRESH_TIME_ZONE: timeZone,
        }),
      ).toThrow("RANKING_REFRESH_TIME_ZONE must be a valid IANA time zone");
    }
  });

  it("assembles named configuration from normalized environment values", async () => {
    const environmentKeys = [
      "DATABASE_URL",
      "QIDIAN_USER_AGENT",
      "PORT",
      "QIDIAN_REQUEST_TIMEOUT_MS",
      "FANQIE_REQUEST_TIMEOUT_MS",
      "BOOK_DETAIL_TTL_HOURS",
      "RANKING_REFRESH_CRON",
      "FANQIE_RANKING_REFRESH_CRON",
      "RANKING_REFRESH_TIME_ZONE",
      "TOMATO_DOWNLOADER_BASE_URL",
      "TOMATO_DOWNLOADER_PASSWORD",
      "DOWNLOAD_ARTIFACT_DIR",
      "TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS",
      "TOMATO_DOWNLOAD_POLL_INTERVAL_MS",
      "TOMATO_DOWNLOAD_TASK_TIMEOUT_MS",
    ] as const;
    const originalEnvironment = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    );

    process.env.DATABASE_URL =
      "  postgresql://postgres:postgres@localhost:5432/novel_scope  ";
    process.env.QIDIAN_USER_AGENT = "  NovelScope/0.1  ";
    process.env.PORT = "3100";
    process.env.QIDIAN_REQUEST_TIMEOUT_MS = "15000";
    process.env.FANQIE_REQUEST_TIMEOUT_MS = "25000";
    process.env.TOMATO_DOWNLOADER_BASE_URL = "http://127.0.0.1:18423/";
    process.env.TOMATO_DOWNLOADER_PASSWORD = " secret ";
    process.env.DOWNLOAD_ARTIFACT_DIR = "C:/NovelScope/downloads";
    delete process.env.TOMATO_DOWNLOADER_REQUEST_TIMEOUT_MS;
    delete process.env.TOMATO_DOWNLOAD_POLL_INTERVAL_MS;
    delete process.env.TOMATO_DOWNLOAD_TASK_TIMEOUT_MS;
    delete process.env.BOOK_DETAIL_TTL_HOURS;
    delete process.env.RANKING_REFRESH_CRON;
    delete process.env.FANQIE_RANKING_REFRESH_CRON;
    delete process.env.RANKING_REFRESH_TIME_ZONE;

    let moduleReference: TestingModule | undefined;

    try {
      const { AppModule } = await import("../app.module");
      moduleReference = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const configService = moduleReference.get(ConfigService);

      expect({
        databaseUrl: configService.get("database.url"),
        qidianUserAgent: configService.get("crawler.qidianUserAgent"),
        port: configService.get("app.port"),
        qidianRequestTimeoutMs: configService.get(
          "crawler.qidianRequestTimeoutMs",
        ),
        fanqieRequestTimeoutMs: configService.get(
          "crawler.fanqieRequestTimeoutMs",
        ),
        bookDetailTtlHours: configService.get("app.bookDetailTtlHours"),
        qidianRankingRefreshCron: configService.get(
          "app.qidianRankingRefreshCron",
        ),
        fanqieRankingRefreshCron: configService.get(
          "app.fanqieRankingRefreshCron",
        ),
        rankingRefreshTimeZone: configService.get(
          "app.rankingRefreshTimeZone",
        ),
        downloaderBaseUrl: configService.get("download.baseUrl"),
        downloaderPassword: configService.get("download.password"),
        artifactDirectory: configService.get("download.artifactDirectory"),
        downloaderRequestTimeoutMs: configService.get(
          "download.requestTimeoutMs",
        ),
        downloadPollIntervalMs: configService.get("download.pollIntervalMs"),
        downloadTaskTimeoutMs: configService.get("download.taskTimeoutMs"),
      }).toEqual({
        databaseUrl:
          "postgresql://postgres:postgres@localhost:5432/novel_scope",
        qidianUserAgent: "NovelScope/0.1",
        port: 3100,
        qidianRequestTimeoutMs: 15_000,
        fanqieRequestTimeoutMs: 25_000,
        bookDetailTtlHours: 3,
        qidianRankingRefreshCron: "0 0 6 * * *",
        fanqieRankingRefreshCron: "0 30 0 * * *",
        rankingRefreshTimeZone: "Asia/Shanghai",
        downloaderBaseUrl: "http://127.0.0.1:18423",
        downloaderPassword: "secret",
        artifactDirectory: resolve("C:/NovelScope/downloads"),
        downloaderRequestTimeoutMs: 10_000,
        downloadPollIntervalMs: 1_000,
        downloadTaskTimeoutMs: 7_200_000,
      });
    } finally {
      await moduleReference?.close();

      for (const key of environmentKeys) {
        const value = originalEnvironment[key];

        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
