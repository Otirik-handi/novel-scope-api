import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RankingsService } from './rankings.service';

@Injectable()
export class RefreshScheduler {
  constructor(@Inject(RankingsService) private readonly rankings: Pick<RankingsService, 'refresh'>) {}

  @Cron(CronExpression.EVERY_6_HOURS)
  async refreshConfiguredRankings(): Promise<void> {
    await Promise.allSettled([
      this.rankings.refresh({ platform: 'qidian', rank: 'hotsales', channel: null }),
      this.rankings.refresh({ platform: 'jjwxc', rank: 'income', channel: '0' }),
    ]);
  }
}
