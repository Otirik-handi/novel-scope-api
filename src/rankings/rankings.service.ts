import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RankingProvider } from './domain/ranking-provider';
import { RankingKey, RankingSnapshot } from './domain/ranking.types';
import { SnapshotStoreService } from './snapshot-store.service';

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
    private readonly store: Pick<SnapshotStoreService, 'read' | 'write'>,
    @Inject(RANKING_PROVIDERS) private readonly providers: RankingProvider[],
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
    const provider = this.providers.find((candidate) => candidate.platform === key.platform);
    if (!provider) {
      throw new Error(`Unsupported platform: ${key.platform}`);
    }

    try {
      const snapshot = await provider.fetch(key);
      await this.store.write(snapshot);
      this.cache.set(this.cacheKey(key), snapshot);
      return snapshot;
    } catch (error: unknown) {
      const previous = this.cache.get(this.cacheKey(key)) ?? (await this.store.read(key));
      if (!previous) {
        throw error;
      }

      return {
        ...previous,
        status: 'stale',
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private cacheKey(key: RankingKey): string {
    return `${key.platform}--${key.rank}--${key.channel ?? 'default'}`;
  }
}
