import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
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
      "TOMATO_DOWNLOADER_BASE_URL",
      "DOWNLOAD_ARTIFACT_DIR",
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
    process.env.TOMATO_DOWNLOADER_BASE_URL = "http://127.0.0.1:18423";
    process.env.DOWNLOAD_ARTIFACT_DIR = "C:/NovelScope/downloads";

    const applicationConfig = { port: 3100 };
    const configService = { getOrThrow: () => 3100 };
    const application = {
      enableShutdownHooks: jest.fn(),
      get: jest.fn((token: unknown) =>
        token === appConfig.KEY ? applicationConfig : configService,
      ),
      listen: jest.fn().mockResolvedValue(undefined),
      useGlobalPipes: jest.fn(),
    };
    jest
      .spyOn(NestFactory, "create")
      .mockResolvedValue(application as never);
    const swaggerDocument = {};
    const createSwaggerDocument = jest
      .spyOn(SwaggerModule, "createDocument")
      .mockReturnValue(swaggerDocument as never);
    const setupSwagger = jest
      .spyOn(SwaggerModule, "setup")
      .mockImplementation(() => undefined);

    try {
      await import("./main");
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(application.get).toHaveBeenCalledWith(appConfig.KEY);
      expect(application.enableShutdownHooks).toHaveBeenCalledTimes(1);
      expect(createSwaggerDocument).toHaveBeenCalledWith(
        application,
        expect.objectContaining({
          info: {
            title: "NovelScope API",
            description: "小说数据查询与刷新 API",
            version: "0.2.0",
            contact: {},
          },
        }),
      );
      expect(setupSwagger).toHaveBeenCalledWith(
        "api-docs",
        application,
        swaggerDocument,
      );
      expect(
        application.enableShutdownHooks.mock.invocationCallOrder[0],
      ).toBeLessThan(application.listen.mock.invocationCallOrder[0]);
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
