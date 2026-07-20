import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';

export const BOOK_DETAIL_LOCK = Symbol('BOOK_DETAIL_LOCK');
export const BOOK_DETAIL_LOCK_POOL = Symbol('BOOK_DETAIL_LOCK_POOL');
export interface BookDetailLock { withLock<T>(key: string, deadline: number, work: () => Promise<T>): Promise<{ acquired: boolean; value?: T }>; }

@Injectable()
export class PostgresBookDetailLockService implements BookDetailLock, OnModuleDestroy {
  constructor(@Inject(BOOK_DETAIL_LOCK_POOL) private readonly pool: Pool) {}
  async withLock<T>(key: string, deadline: number, work: () => Promise<T>): Promise<{ acquired: boolean; value?: T }> {
    const client = await this.connectBefore(deadline);
    if (!client) return { acquired: false };
    let acquired = false;
    let waited = false;
    let failure: Error | undefined;
    try {
      while (Date.now() < deadline) {
        const result = await this.queryBefore<{ locked: boolean }>(client, 'SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [key], deadline);
        if (result.rows[0]?.locked) {
          if (waited) {
            const released = await this.queryBefore<{ unlocked: boolean }>(client, 'SELECT pg_advisory_unlock(hashtext($1)) AS unlocked', [key], deadline);
            if (released.rows[0]?.unlocked !== true) throw new Error('Failed to release book detail advisory lock');
            return { acquired: false };
          }
          acquired = true;
          return { acquired: true, value: await work() };
        }
        waited = true;
        await new Promise((resolve) => setTimeout(resolve, Math.min(25, deadline - Date.now())));
      }
      return { acquired: false };
    } catch (error: unknown) {
      failure = error instanceof Error ? error : new Error(String(error));
      throw failure;
    } finally {
      if (acquired) {
        let releaseError: Error | undefined;
        try {
          await this.queryBefore(client, 'SELECT pg_advisory_unlock(hashtext($1))', [key], deadline);
        } catch (error: unknown) {
          releaseError = error instanceof Error ? error : new Error(String(error));
        }
        if (releaseError) {
          client.release(releaseError);
          if (!failure) throw releaseError;
        } else {
          client.release(failure);
        }
      } else client.release(failure);
    }
  }
  private async queryBefore<T extends QueryResultRow>(client: PoolClient, query: string, values: string[], deadline: number): Promise<{ rows: T[] }> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('BOOK_DETAIL_TIMEOUT');
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('BOOK_DETAIL_TIMEOUT')), remaining); });
    try {
      return await Promise.race([client.query<T>(query, values), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async connectBefore(deadline: number): Promise<PoolClient | undefined> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return undefined;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const connection = this.pool.connect();
    // A connection which arrives after the caller's budget cannot be retained.
    void connection.then((client) => { if (timedOut) client.release(); }).catch(() => undefined);
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => { timedOut = true; resolve(undefined); }, remaining);
    });
    try {
      return await Promise.race([connection, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async onModuleDestroy(): Promise<void> { await this.pool.end(); }
}
