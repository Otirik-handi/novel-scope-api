import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { JjwxcProvider } from './providers/jjwxc.provider';
import { QidianProvider } from './providers/qidian.provider';
import { RankingHttpClient } from './providers/ranking-http.client';
import { RefreshScheduleConfigService } from './refresh-schedule-config.service';
import { RankingsController } from './rankings.controller';
import { RankingsService, RANKING_PROVIDERS } from './rankings.service';
import { RefreshScheduler } from './refresh.scheduler';
import { SnapshotStoreService } from './snapshot-store.service';

@Module({
  controllers: [RankingsController],
  providers: [
    ApiKeyGuard,
    SnapshotStoreService,
    RefreshScheduleConfigService,
    RankingHttpClient,
    QidianProvider,
    JjwxcProvider,
    {
      provide: RANKING_PROVIDERS,
      inject: [QidianProvider, JjwxcProvider],
      useFactory: (qidian: QidianProvider, jjwxc: JjwxcProvider) => [qidian, jjwxc],
    },
    RankingsService,
    RefreshScheduler,
  ],
  exports: [RankingsService, SnapshotStoreService],
})
export class RankingsModule {}
