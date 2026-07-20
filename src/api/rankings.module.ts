import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ApiKeyGuard } from './api-key.guard';
import { BookDetailStoreService } from '../rankings/book-detail-store.service';
import { CrawlLogRetentionService } from '../rankings/crawl-log-retention.service';
import { PostgresBookDetailLockService, BOOK_DETAIL_LOCK, BOOK_DETAIL_LOCK_POOL } from '../rankings/book-detail-lock.service';
import { BOOK_DETAIL_CRAWL_LOGGER, BOOK_DETAILS_CLOCK, BookDetailsService } from '../rankings/book-details.service';
import { BooksController } from './books.controller';
import { QidianProvider } from '../rankings/providers/qidian.provider';
import { QidianBookDetailProvider } from '../rankings/providers/qidian-book-detail.provider';
import { RankingHttpClient } from '../rankings/providers/ranking-http.client';
import { RankingsController } from './rankings.controller';
import { RankingsService, RANKING_PROVIDERS } from '../rankings/rankings.service';
import { RANKING_CRAWL_LOGGER } from '../rankings/rankings.service';
import { RefreshScheduler } from '../rankings/refresh.scheduler';
import { SnapshotStoreService } from '../rankings/snapshot-store.service';
import { PostgresRankingLockService, RANKING_LOCK, RANKING_LOCK_POOL } from '../rankings/ranking-lock.service';
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
    CrawlLogRetentionService,
    RankingHttpClient,
    QidianProvider,
    QidianBookDetailProvider,
    {
      provide: RANKING_PROVIDERS,
      inject: [QidianProvider],
      useFactory: (qidian: QidianProvider) => [qidian],
    },
    RankingsService,
    BookDetailsService,
    { provide: BOOK_DETAILS_CLOCK, useValue: () => new Date() },
    RefreshScheduler,
  ],
  exports: [RankingsService, SnapshotStoreService],
})
export class RankingsModule {}
