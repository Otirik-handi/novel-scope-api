import { NestFactory } from "@nestjs/core";
import appConfig from "./config/app.config";

describe("bootstrap", () => {
  it("resolves application configuration by its registered token", async () => {
    const environmentKeys = [
      "DATABASE_URL",
      "QIDIAN_USER_AGENT",
      "PORT",
      "QIDIAN_REQUEST_TIMEOUT_MS",
      "BOOK_DETAIL_TTL_HOURS",
      "RANKING_REFRESH_CRON",
      "RANKING_REFRESH_TIME_ZONE",
    ] as const;
    const originalEnvironment = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    );

    for (const key of environmentKeys) {
      delete process.env[key];
    }

    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5432/novel_scope";
    process.env.QIDIAN_USER_AGENT = "NovelScope/0.1";

    const applicationConfig = { port: 3100 };
    const configService = { getOrThrow: () => 3100 };
    const application = {
      get: jest.fn((token: unknown) =>
        token === appConfig.KEY ? applicationConfig : configService,
      ),
      listen: jest.fn().mockResolvedValue(undefined),
      useGlobalPipes: jest.fn(),
    };
    jest
      .spyOn(NestFactory, "create")
      .mockResolvedValue(application as never);

    try {
      await import("./main");
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(application.get).toHaveBeenCalledWith(appConfig.KEY);
      expect(application.listen).toHaveBeenCalledWith(3100);
    } finally {
      jest.restoreAllMocks();

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
