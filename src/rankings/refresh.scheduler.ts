import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { mapWithConcurrency } from './concurrency';
import { RefreshScheduleConfigService } from './refresh-schedule-config.service';
import { RankingsService } from './rankings.service';

@Injectable()
export class RefreshScheduler implements OnApplicationBootstrap {
  constructor(
    @Inject(RankingsService) private readonly rankings: Pick<RankingsService, 'refresh'>,
    @Inject(SchedulerRegistry) private readonly registry: Pick<SchedulerRegistry, 'addCronJob'>,
    @Inject(RefreshScheduleConfigService)
    private readonly config: Pick<RefreshScheduleConfigService, 'get'>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const config = this.config.get();
    const job = CronJob.from({
      cronTime: config.cron,
      onTick: () => this.refreshConfiguredRankings(),
      start: false,
      waitForCompletion: true,
      name: 'ranking-refresh',
    });

    this.registry.addCronJob('ranking-refresh', job);
    job.start();
  }

  async refreshConfiguredRankings(): Promise<void> {
    const config = this.config.get();
    await mapWithConcurrency(config.targets, config.targetConcurrency, async (target) => {
      try {
        await this.rankings.refresh(target);
      } catch {
        // A failed target must not prevent the remaining configured targets from refreshing.
      }
    });
  }
}
