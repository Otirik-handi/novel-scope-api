import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import appConfig from "../config/app.config";
import type { Platform } from "../shared/types/platform.type";
import { RankingsService } from "./rankings.service";

export const QIDIAN_RANKINGS_REFRESH_JOB_NAME = "rankings-refresh:qidian";
export const FANQIE_RANKINGS_REFRESH_JOB_NAME = "rankings-refresh:fanqie";

@Injectable()
export class RankingsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly registeredJobNames: string[] = [];
  private destroyPromise: Promise<void> | undefined;

  constructor(
    private readonly rankingsService: RankingsService,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(appConfig.KEY)
    private readonly config: ConfigType<typeof appConfig>,
  ) {}

  onModuleInit(): void {
    if (!this.config.rankingRefreshEnabled) {
      return;
    }

    this.registerJob(
      QIDIAN_RANKINGS_REFRESH_JOB_NAME,
      "qidian",
      this.config.qidianRankingRefreshCron,
    );
    this.registerJob(
      FANQIE_RANKINGS_REFRESH_JOB_NAME,
      "fanqie",
      this.config.fanqieRankingRefreshCron,
    );
  }

  private registerJob(
    name: string,
    platform: Platform,
    cronTime: string,
  ): void {
    const job = CronJob.from({
      cronTime,
      timeZone: this.config.rankingRefreshTimeZone,
      waitForCompletion: true,
      onTick: async () => {
        await this.rankingsService.refreshAll(platform);
      },
    });

    this.schedulerRegistry.addCronJob(name, job);
    this.registeredJobNames.push(name);
    job.start();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.registeredJobNames.length === 0) {
      return;
    }

    this.destroyPromise ??= this.stopAndDeleteCronJobs();
    await this.destroyPromise;
  }

  private async stopAndDeleteCronJobs(): Promise<void> {
    for (const name of this.registeredJobNames) {
      const job = this.schedulerRegistry.getCronJob(name);
      await job.stop();
      this.schedulerRegistry.deleteCronJob(name);
    }

    this.registeredJobNames.length = 0;
  }
}
