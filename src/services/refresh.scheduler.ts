import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { mapWithConcurrency } from './concurrency';
import { RankingsService } from './rankings.service';

@Injectable()
export class RefreshScheduler implements OnApplicationBootstrap {
  constructor(
    @Inject(RankingsService) private readonly rankings: Pick<RankingsService, 'refresh'>,
    @Inject(SchedulerRegistry) private readonly registry: Pick<SchedulerRegistry, 'addCronJob'>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const job = CronJob.from({
      cronTime: '0 0 6 * * *',
      timeZone: 'Asia/Shanghai',
      onTick: () => this.refreshConfiguredRankings(),
      start: false,
      waitForCompletion: true,
      name: 'ranking-refresh',
    });

    this.registry.addCronJob('ranking-refresh', job);
    job.start();
  }

  async refreshConfiguredRankings(): Promise<void> {
    const targets = ['hotsales', 'yuepiao', 'recom', 'collect'].map((rank) => ({ platform: 'qidian' as const, rank, channel: null }));
    await mapWithConcurrency(targets, 2, async (target) => {
      try {
        await this.rankings.refresh(target);
      } catch {
        // A failed target must not prevent the remaining configured targets from refreshing.
      }
    });
  }
}
