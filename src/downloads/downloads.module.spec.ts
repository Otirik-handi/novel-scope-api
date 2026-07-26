import { Test } from "@nestjs/testing";
import downloadConfig from "../config/download.config";
import { PrismaService } from "../shared/database/prisma.service";
import { DownloadsController } from "./downloads.controller";
import { DownloadsModule } from "./downloads.module";
import { DownloadsService } from "./downloads.service";
import { DownloadsWorker } from "./downloads.worker";

describe("DownloadsModule", () => {
  it("provides the controller, service and lifecycle worker", async () => {
    const moduleReference = await Test.createTestingModule({
      imports: [DownloadsModule],
    })
      .overrideProvider(downloadConfig.KEY)
      .useValue({
        baseUrl: "http://127.0.0.1:18423",
        password: null,
        artifactDirectory: "C:/NovelScope/downloads",
        requestTimeoutMs: 10_000,
        pollIntervalMs: 1_000,
        taskTimeoutMs: 7_200_000,
      })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(moduleReference.get(DownloadsController)).toBeDefined();
    expect(moduleReference.get(DownloadsService)).toBeDefined();
    expect(moduleReference.get(DownloadsWorker)).toBeDefined();
    await moduleReference.close();
  });
});
