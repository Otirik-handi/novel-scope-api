import { Module } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { BookDetailStoreService } from './book-detail-store.service';
import { BOOK_DETAILS_CLOCK, BookDetailsService } from './book-details.service';
import { BooksController } from './books.controller';
import { JjwxcProvider } from './providers/jjwxc.provider';
import { QidianProvider } from './providers/qidian.provider';
import { QidianBookDetailProvider } from './providers/qidian-book-detail.provider';
import { RankingHttpClient } from './providers/ranking-http.client';
import { RefreshScheduleConfigService } from './refresh-schedule-config.service';
import { RankingsController } from './rankings.controller';
import { RankingsService, RANKING_PROVIDERS } from './rankings.service';
import { RefreshScheduler } from './refresh.scheduler';
import { SnapshotStoreService } from './snapshot-store.service';

@Module({
  controllers: [RankingsController, BooksController],
  providers: [
    ApiKeyGuard,
    SnapshotStoreService,
    BookDetailStoreService,
    RefreshScheduleConfigService,
    RankingHttpClient,
    QidianProvider,
    QidianBookDetailProvider,
    JjwxcProvider,
    {
      provide: RANKING_PROVIDERS,
      inject: [QidianProvider, JjwxcProvider],
      useFactory: (qidian: QidianProvider, jjwxc: JjwxcProvider) => [qidian, jjwxc],
    },
    RankingsService,
    BookDetailsService,
    { provide: BOOK_DETAILS_CLOCK, useValue: () => new Date() },
    RefreshScheduler,
  ],
  exports: [RankingsService, SnapshotStoreService],
})
export class RankingsModule {}
