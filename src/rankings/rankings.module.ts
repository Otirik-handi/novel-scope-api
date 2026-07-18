import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ApiKeyGuard } from './api-key.guard';
import { BookDetailStoreService } from './book-detail-store.service';
import { PostgresBookDetailLockService, BOOK_DETAIL_LOCK, BOOK_DETAIL_LOCK_POOL } from './book-detail-lock.service';
import { BOOK_DETAIL_CRAWL_LOGGER, BOOK_DETAILS_CLOCK, BookDetailsService } from './book-details.service';
import { BooksController } from './books.controller';
import { JjwxcProvider } from './providers/jjwxc.provider';
import { QidianProvider } from './providers/qidian.provider';
import { QidianBookDetailProvider } from './providers/qidian-book-detail.provider';
import { RankingHttpClient } from './providers/ranking-http.client';
import { RefreshScheduleConfigService } from './refresh-schedule-config.service';
import { RankingsController } from './rankings.controller';
import { RankingsService, RANKING_PROVIDERS } from './rankings.service';
import { RANKING_CRAWL_LOGGER } from './rankings.service';
import { RefreshScheduler } from './refresh.scheduler';
import { SnapshotStoreService } from './snapshot-store.service';
import { PostgresRankingLockService, RANKING_LOCK, RANKING_LOCK_POOL } from './ranking-lock.service';
import { appLogger } from '../structured-logger';

@Module({
  controllers: [RankingsController, BooksController],
  providers: [
    ApiKeyGuard,
    SnapshotStoreService,
    {
      provide: RANKING_LOCK_POOL,
      useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }),
    },
    PostgresRankingLockService,
    { provide: RANKING_LOCK, useExisting: PostgresRankingLockService },
    { provide: BOOK_DETAIL_LOCK_POOL, useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }) },
    PostgresBookDetailLockService,
    { provide: BOOK_DETAIL_LOCK, useExisting: PostgresBookDetailLockService },
    { provide: RANKING_CRAWL_LOGGER, useValue: appLogger },
    { provide: BOOK_DETAIL_CRAWL_LOGGER, useValue: appLogger },
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
