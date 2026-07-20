import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { ApiKeyGuard } from './api-key.guard';
import { BookDetailStoreService } from '../db/book-detail-store.service';
import { CrawlLogRetentionService } from '../services/crawl-log-retention.service';
import { PostgresBookDetailLockService, BOOK_DETAIL_LOCK, BOOK_DETAIL_LOCK_POOL } from '../db/book-detail-lock.service';
import { BOOK_DETAIL_CRAWL_LOGGER, BOOK_DETAILS_CLOCK, BookDetailsService } from '../services/book-details.service';
import { BooksController } from './books.controller';
import { QidianProvider } from '../crawlers/qidian/rank/qidian.provider';
import { QidianBookDetailProvider } from '../crawlers/qidian/book/qidian-book-detail.provider';
import { RankingHttpClient } from '../axios/ranking-http.client';
import { RankingsController } from './rankings.controller';
import { RankingsService, RANKING_PROVIDERS } from '../services/rankings.service';
import { RANKING_CRAWL_LOGGER } from '../services/rankings.service';
import { RefreshScheduler } from '../services/refresh.scheduler';
import { SnapshotStoreService } from '../db/snapshot-store.service';
import { PostgresRankingLockService, RANKING_LOCK, RANKING_LOCK_POOL } from '../db/ranking-lock.service';
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
