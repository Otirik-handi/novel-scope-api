import { Module } from "@nestjs/common";
import { ConfigModule, type ConfigType } from "@nestjs/config";
import { setTimeout as sleep } from "node:timers/promises";
import downloadConfig from "../config/download.config";
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
import { TomatoDownloaderClient } from "./tomato-downloader/tomato-downloader.client";

export const DOWNLOADS_CLOCK = Symbol("DOWNLOADS_CLOCK");
export const DOWNLOADS_SLEEPER = Symbol("DOWNLOADS_SLEEPER");

@Module({
  imports: [ConfigModule.forFeature(downloadConfig), DatabaseModule],
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
      provide: DOWNLOADS_CLOCK,
      useValue: { now: () => new Date() } satisfies DownloadsWorkerClock,
    },
    {
      provide: DOWNLOADS_SLEEPER,
      useValue: {
        sleep: (milliseconds: number) => sleep(milliseconds),
      } satisfies DownloadsWorkerSleeper,
    },
    {
      provide: DownloadsService,
      inject: [
        DownloadsRepository,
        TomatoDownloaderClient,
        ArtifactStore,
        DOWNLOADS_CLOCK,
      ],
      useFactory: (
        repository: DownloadsRepository,
        client: TomatoDownloaderClient,
        artifacts: ArtifactStore,
        clock: DownloadsWorkerClock,
      ) => new DownloadsService(repository, client, artifacts, clock),
    },
    {
      provide: DownloadsWorker,
      inject: [
        DownloadsRepository,
        TomatoDownloaderClient,
        ArtifactStore,
        DOWNLOADS_CLOCK,
        DOWNLOADS_SLEEPER,
        downloadConfig.KEY,
      ],
      useFactory: (
        repository: DownloadsRepository,
        client: TomatoDownloaderClient,
        artifacts: ArtifactStore,
        clock: DownloadsWorkerClock,
        sleeper: DownloadsWorkerSleeper,
        config: ConfigType<typeof downloadConfig>,
      ) =>
        new DownloadsWorker(repository, client, artifacts, clock, sleeper, {
          pollIntervalMs: config.pollIntervalMs,
          taskTimeoutMs: config.taskTimeoutMs,
        }),
    },
  ],
  exports: [DownloadsService],
})
export class DownloadsModule {}
