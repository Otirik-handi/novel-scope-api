import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

export const RANKING_LOCK = Symbol('RANKING_LOCK');
export const RANKING_LOCK_POOL = Symbol('RANKING_LOCK_POOL');

export interface RankingLock {
  withLock<T>(platform: string, rankType: string, work: () => Promise<T>): Promise<{ acquired: boolean; value?: T }>;
}

@Injectable()
export class PostgresRankingLockService implements RankingLock, OnModuleDestroy {
  constructor(@Inject(RANKING_LOCK_POOL) private readonly pool: Pool) {}

  async withLock<T>(platform: string, rankType: string, work: () => Promise<T>): Promise<{ acquired: boolean; value?: T }> {
    const key = `${platform}:${rankType}`;
    const client = await this.pool.connect();
    let acquired = false;
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [key],
      );
      acquired = result.rows[0]?.locked === true;
      if (!acquired) return { acquired: false };

      return { acquired: true, value: await work() };
    } finally {
      if (!acquired) {
        client.release();
      } else {
        try {
          const result = await client.query<{ unlocked: boolean }>(
            'SELECT pg_advisory_unlock(hashtext($1)) AS unlocked',
            [key],
          );
          if (result.rows[0]?.unlocked !== true) {
            throw new Error('Failed to release ranking advisory lock');
          }
        } catch (error: unknown) {
          client.release(error instanceof Error ? error : new Error(String(error)));
          throw error;
        }
        client.release();
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
