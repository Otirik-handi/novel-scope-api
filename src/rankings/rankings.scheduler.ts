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
import { RankingsService } from "./rankings.service";

export const RANKINGS_REFRESH_JOB_NAME = "rankings-refresh";

@Injectable()
export class RankingsScheduler implements OnModuleInit, OnModuleDestroy {
  private registered = false;
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

    const job = CronJob.from({
      cronTime: this.config.rankingRefreshCron,
      timeZone: this.config.rankingRefreshTimeZone,
      waitForCompletion: true,
      onTick: async () => {
        await this.rankingsService.refreshAll("qidian");
      },
    });

    this.schedulerRegistry.addCronJob(RANKINGS_REFRESH_JOB_NAME, job);
    this.registered = true;
    job.start();
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.registered) {
      return;
    }

    this.destroyPromise ??= this.stopAndDeleteCronJob();
    await this.destroyPromise;
  }

  private async stopAndDeleteCronJob(): Promise<void> {
    const job = this.schedulerRegistry.getCronJob(RANKINGS_REFRESH_JOB_NAME);
    await job.stop();
    this.schedulerRegistry.deleteCronJob(RANKINGS_REFRESH_JOB_NAME);
    this.registered = false;
  }
}
