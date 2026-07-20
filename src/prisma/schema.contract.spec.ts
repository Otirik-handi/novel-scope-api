import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
const migration = readFileSync(
  join(process.cwd(), 'prisma/migrations/20260718000000_init/migration.sql'),
  'utf8',
);

describe('initial Prisma schema contract', () => {
  it('keeps stable book identity separate from detail fields', () => {
    expect(schema).toMatch(/model Book \{[\s\S]*externalBookId[\s\S]*@@unique\(\[platform, externalBookId\]\)/);
    expect(schema).toMatch(/model BookDetail \{[\s\S]*totalRecCount[\s\S]*chaptersNum[\s\S]*rewardNum[\s\S]*lastError/);
    expect(migration).toContain('"external_book_id"');
    expect(migration).toContain('"total_rec_count"');
  });

  it('defines ranking snapshots, items, and crawl logs with planned fields and indexes', () => {
    expect(schema).toMatch(/@@index\(\[platform, rankType, fetchedAt\(sort: Desc\)\]\)/);
    expect(schema).toMatch(/model RankingItem \{[\s\S]*externalBookId[\s\S]*@@unique\(\[snapshotId, rank\]\)[\s\S]*@@unique\(\[snapshotId, externalBookId\]\)/);
    expect(schema).toMatch(/model CrawlLog \{[\s\S]*targetType[\s\S]*targetKey[\s\S]*startedAt[\s\S]*finishedAt[\s\S]*snapshotId/);
    expect(migration).toContain('"rank_type"');
    expect(migration).toContain('"target_type"');
    expect(migration).toContain('"platform", "rank_type", "fetched_at" DESC');
    expect(schema).toMatch(/@@index\(\[startedAt\]\)/);
    expect(schema).toMatch(/@@index\(\[platform, targetType, targetKey, startedAt\(sort: Desc\)\]\)/);
    expect(migration).toContain('"started_at"');
    expect(migration).toContain('"platform", "target_type", "target_key", "started_at" DESC');
  });
});
