import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { RankingProvider } from './domain/ranking-provider';
import { RankingKey, RankingSnapshot } from './domain/ranking.types';
import { crawlErrorCode, SnapshotStoreService } from './snapshot-store.service';
import { RANKING_LOCK, RankingLock } from './ranking-lock.service';
import { appLogger, type CrawlErrorCode, StructuredLogger } from '../structured-logger';

export const RANKING_CRAWL_LOGGER = Symbol('RANKING_CRAWL_LOGGER');

export const RANKING_PROVIDERS = Symbol('RANKING_PROVIDERS');

export class SnapshotUnavailableError extends ServiceUnavailableException {
  constructor(key: RankingKey) {
    super({ code: 'SNAPSHOT_UNAVAILABLE', key });
  }
}

@Injectable()
export class RankingsService {
  private readonly cache = new Map<string, RankingSnapshot>();

  constructor(
    @Inject(SnapshotStoreService)
    private readonly store: Pick<SnapshotStoreService, 'read' | 'write' | 'recordFailure'>,
    @Inject(RANKING_PROVIDERS) private readonly providers: RankingProvider[],
    @Optional() @Inject(RANKING_LOCK) private readonly lock?: RankingLock,
    @Optional() @Inject(RANKING_CRAWL_LOGGER) private readonly logger: Pick<StructuredLogger, 'crawlCompleted'> = appLogger,
  ) {}

  async get(key: RankingKey): Promise<RankingSnapshot> {
    const cacheKey = this.cacheKey(key);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const snapshot = await this.store.read(key);
    if (!snapshot) {
      throw new SnapshotUnavailableError(key);
    }

    this.cache.set(cacheKey, snapshot);
    return snapshot;
  }

  async refresh(key: RankingKey): Promise<RankingSnapshot> {
    if (this.lock) {
      const startedAt = new Date();
      let workStarted = false;
      let locked: { acquired: boolean; value?: RankingSnapshot };
      try {
        locked = await this.lock.withLock(key.platform, key.rank, () => {
          workStarted = true;
          return this.refreshUnlocked(key);
        });
      } catch (error: unknown) {
        if (!workStarted) this.logCompletion(key, startedAt, 'failed', this.errorCode(error));
        throw error;
      }
      if (locked.acquired && locked.value) return locked.value;
      this.logCompletion(key, new Date(), 'skipped');
      await this.store.recordFailure(key, new Date(), new Error('ranking refresh already in progress'), 'skipped');
      const previous = this.cache.get(this.cacheKey(key)) ?? await this.store.read(key);
      if (!previous) throw new Error('ranking refresh already in progress');
      return { ...previous, status: 'stale', lastError: 'UNKNOWN_ERROR' };
    }
    return this.refreshUnlocked(key);
  }

  private async refreshUnlocked(key: RankingKey): Promise<RankingSnapshot> {
    const startedAt = new Date();
    try {
      const provider = this.providers.find((candidate) => candidate.platform === key.platform);
      if (!provider) {
        throw new Error(`Unsupported platform: ${key.platform}`);
      }
      const snapshot = await provider.fetch(key);
      await this.store.write(snapshot);
      this.cache.set(this.cacheKey(key), snapshot);
      this.logCompletion(key, startedAt, 'success');
      return snapshot;
    } catch (error: unknown) {
      this.logCompletion(key, startedAt, 'failed', this.errorCode(error));
      await this.store.recordFailure(key, startedAt, error);
      const previous = this.cache.get(this.cacheKey(key)) ?? (await this.store.read(key));
      if (!previous) {
        throw error;
      }

      return {
        ...previous,
        status: 'stale',
        lastError: this.errorCode(error),
      };
    }
  }

  private cacheKey(key: RankingKey): string {
    return `${key.platform}--${key.rank}--${key.channel ?? 'default'}`;
  }

  private logCompletion(key: RankingKey, startedAt: Date, result: 'success' | 'failed' | 'skipped', errorCode?: CrawlErrorCode): void {
    this.logger.crawlCompleted({
      targetType: 'ranking', targetKey: `${key.platform}:${key.rank}`, platform: key.platform,
      durationMs: Math.max(0, Date.now() - startedAt.getTime()), status: result === 'success' ? 'success' : result === 'skipped' ? 'skipped' : 'failed',
      result, ...(errorCode === undefined ? {} : { errorCode }),
    });
  }

  private errorCode(error: unknown): CrawlErrorCode {
    return crawlErrorCode(error);
  }
}
