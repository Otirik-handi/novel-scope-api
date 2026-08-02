import { Module } from "@nestjs/common";
import { ConfigModule, type ConfigType } from "@nestjs/config";
import { setTimeout as sleep } from "node:timers/promises";
import downloadConfig from "../config/download.config";
import { CrawlersModule } from "../crawlers/crawlers.module";
import { QidianChapterCrawler } from "../crawlers/qidian/chapters/qidian-chapter.crawler";
import { DatabaseModule } from "../shared/database/database.module";
import { ArtifactStore } from "./artifact-store";
import { DownloadsController } from "./downloads.controller";
import { DownloadsRepository } from "./downloads.repository";
import { DownloadsService } from "./downloads.service";
import {
  DownloadsWorker,
  type DownloadsWorkerClock,
  type DownloadsWorkerSleeper,
} from "./downloads.worker";
import { BookDownloadRunnerRegistry } from "./runners/book-download-runner.registry";
import { FanqieDownloadRunner } from "./runners/fanqie/fanqie-download.runner";
import { QidianDownloadRunner } from "./runners/qidian/qidian-download.runner";
import { TomatoDownloaderClient } from "./runners/fanqie/tomato-downloader/tomato-downloader.client";

export const DOWNLOADS_CLOCK = Symbol("DOWNLOADS_CLOCK");
export const DOWNLOADS_SLEEPER = Symbol("DOWNLOADS_SLEEPER");

@Module({
  imports: [
    ConfigModule.forFeature(downloadConfig),
    DatabaseModule,
    CrawlersModule,
  ],
  controllers: [DownloadsController],
  providers: [
    DownloadsRepository,
    {
      provide: TomatoDownloaderClient,
      inject: [downloadConfig.KEY],
      useFactory: (config: ConfigType<typeof downloadConfig>) =>
        new TomatoDownloaderClient({
          baseUrl: config.baseUrl,
          password: config.password,
          requestTimeoutMs: config.requestTimeoutMs,
        }),
    },
    {
      provide: ArtifactStore,
      inject: [downloadConfig.KEY],
      useFactory: (config: ConfigType<typeof downloadConfig>) =>
        new ArtifactStore({ rootDirectory: config.artifactDirectory }),
    },
    {
      provide: FanqieDownloadRunner,
      inject: [TomatoDownloaderClient],
      useFactory: (client: TomatoDownloaderClient) =>
        new FanqieDownloadRunner(client),
    },
    {
      provide: QidianDownloadRunner,
      inject: [QidianChapterCrawler],
      useFactory: (crawler: QidianChapterCrawler) =>
        new QidianDownloadRunner(crawler),
    },
    {
      provide: BookDownloadRunnerRegistry,
      inject: [FanqieDownloadRunner, QidianDownloadRunner],
      useFactory: (
        fanqie: FanqieDownloadRunner,
        qidian: QidianDownloadRunner,
      ) => new BookDownloadRunnerRegistry(fanqie, qidian),
    },
    {
      provide: DOWNLOADS_CLOCK,
      useValue: { now: () => new Date() } satisfies DownloadsWorkerClock,
    },
    {
      provide: DOWNLOADS_SLEEPER,
      useValue: {
        sleep: (milliseconds: number, signal?: AbortSignal) =>
          sleep(milliseconds, undefined, { signal }),
      } satisfies DownloadsWorkerSleeper,
    },
    {
      provide: DownloadsService,
      inject: [
        DownloadsRepository,
        BookDownloadRunnerRegistry,
        ArtifactStore,
        DOWNLOADS_CLOCK,
      ],
      useFactory: (
        repository: DownloadsRepository,
        runners: BookDownloadRunnerRegistry,
        artifacts: ArtifactStore,
        clock: DownloadsWorkerClock,
      ) => new DownloadsService(repository, runners, artifacts, clock),
    },
    {
      provide: DownloadsWorker,
      inject: [
        DownloadsRepository,
        BookDownloadRunnerRegistry,
        ArtifactStore,
        DOWNLOADS_CLOCK,
        DOWNLOADS_SLEEPER,
        downloadConfig.KEY,
      ],
      useFactory: (
        repository: DownloadsRepository,
        runners: BookDownloadRunnerRegistry,
        artifacts: ArtifactStore,
        clock: DownloadsWorkerClock,
        sleeper: DownloadsWorkerSleeper,
        config: ConfigType<typeof downloadConfig>,
      ) =>
        new DownloadsWorker(repository, runners, artifacts, clock, sleeper, {
          pollIntervalMs: config.pollIntervalMs,
          taskTimeoutMs: config.taskTimeoutMs,
        }),
    },
  ],
  exports: [DownloadsService],
})
export class DownloadsModule {}
