import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from 'dotenv';
import { Pool, type PoolClient } from 'pg';
import { PostgresRankingLockService } from '../src/db/ranking-lock.service';

if (process.env.RUN_DATABASE_INTEGRATION_TESTS === 'true') config();

const describeDatabase = process.env.RUN_DATABASE_INTEGRATION_TESTS === 'true' ? describe : describe.skip;
const execFileAsync = promisify(execFile);

describeDatabase('PostgreSQL migration integration', () => {
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  const databaseName = `novel_ranking_test_${randomUUID().replaceAll('-', '')}`;
  let maintenancePool: Pool;
  let connectionString: string;
  let pool: Pool;

  beforeAll(async () => {
    if (!sourceDatabaseUrl) throw new Error('DATABASE_URL is required for database integration tests');
    maintenancePool = new Pool({ connectionString: databaseUrlFor(sourceDatabaseUrl, 'postgres') });
    await maintenancePool.query(`CREATE DATABASE ${databaseName}`);
    connectionString = databaseUrlFor(sourceDatabaseUrl, databaseName);
    await migrateDatabase(connectionString);
    pool = new Pool({ connectionString });
  });

  afterAll(async () => {
    await pool?.end();
    await maintenancePool?.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await maintenancePool?.end();
  });

  it('applies the initial migration with required indexes and unique constraints', async () => {
    const migrations = await pool.query<{ migration_name: string }>(
      'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL',
    );
    const indexes = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
    );

    expect(migrations.rows.map((row) => row.migration_name)).toContain('20260718000000_init');
    expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
      'books_platform_external_book_id_key',
      'ranking_snapshots_platform_rank_type_fetched_at_idx',
      'ranking_items_snapshot_id_rank_key',
      'ranking_items_snapshot_id_external_book_id_key',
      'crawl_log_platform_target_type_target_key_started_at_idx',
    ]));
  });

  it('enforces unique ranking item rank and external book ID within a snapshot', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const snapshot = await client.query<{ id: string }>(
        "INSERT INTO ranking_snapshots (platform, rank_type, source_url, fetched_at) VALUES ('qidian', 'hotsales', 'https://example.test/rank', NOW()) RETURNING id",
      );
      const snapshotId = snapshot.rows[0]?.id;
      if (!snapshotId) throw new Error('Failed to create ranking snapshot for test');

      await client.query(
        "INSERT INTO ranking_items (snapshot_id, external_book_id, rank, title, author, source_url) VALUES ($1, '101', 1, 'First', 'Author', 'https://example.test/book/101')",
        [snapshotId],
      );

      await client.query('SAVEPOINT duplicate_rank');
      await expect(client.query(
        "INSERT INTO ranking_items (snapshot_id, external_book_id, rank, title, author, source_url) VALUES ($1, '102', 1, 'Second', 'Author', 'https://example.test/book/102')",
        [snapshotId],
      )).rejects.toMatchObject({ code: '23505' });
      await client.query('ROLLBACK TO SAVEPOINT duplicate_rank');

      await client.query('SAVEPOINT duplicate_external_book_id');
      await expect(client.query(
        "INSERT INTO ranking_items (snapshot_id, external_book_id, rank, title, author, source_url) VALUES ($1, '101', 2, 'Second', 'Author', 'https://example.test/book/101')",
        [snapshotId],
      )).rejects.toMatchObject({ code: '23505' });
      await client.query('ROLLBACK TO SAVEPOINT duplicate_external_book_id');
    } finally {
      await rollback(client);
      client.release();
    }
  });

  it('uses PostgreSQL advisory locks to exclude a concurrent ranking refresh', async () => {
    const firstPool = new Pool({ connectionString });
    const secondPool = new Pool({ connectionString });
    const first = new PostgresRankingLockService(firstPool);
    const second = new PostgresRankingLockService(secondPool);

    try {
      const result = await first.withLock('qidian', 'hotsales', async () => {
        const concurrent = await second.withLock('qidian', 'hotsales', async () => 'unexpected');
        expect(concurrent).toEqual({ acquired: false });
        return 'refreshed';
      });
      expect(result).toEqual({ acquired: true, value: 'refreshed' });
      await expect(second.withLock('qidian', 'hotsales', async () => 'available'))
        .resolves.toEqual({ acquired: true, value: 'available' });
    } finally {
      await Promise.all([firstPool.end(), secondPool.end()]);
    }
  });
});

function databaseUrlFor(source: string, database: string): string {
  const url = new URL(source);
  url.pathname = `/${database}`;
  return url.toString();
}

async function migrateDatabase(databaseUrl: string): Promise<void> {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npx prisma migrate deploy']
    : ['prisma', 'migrate', 'deploy'];
  await execFileAsync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The test's assertion can leave a transaction aborted; rollback is best effort cleanup.
  }
}
