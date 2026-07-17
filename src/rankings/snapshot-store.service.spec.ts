import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RankingSnapshot } from './domain/ranking.types';
import { SnapshotStoreService } from './snapshot-store.service';

describe('SnapshotStoreService', () => {
  let snapshotDir: string;
  let store: SnapshotStoreService;

  const snapshot: RankingSnapshot = {
    platform: 'qidian',
    rank: 'hotsales',
    channel: null,
    sourceUrl: 'https://example.test',
    fetchedAt: '2026-07-17T00:00:00.000Z',
    status: 'fresh',
    items: [],
  };

  beforeEach(async () => {
    snapshotDir = await mkdtemp(join(tmpdir(), 'ranking-snapshots-'));
    store = new SnapshotStoreService(snapshotDir);
  });

  afterEach(async () => {
    await rm(snapshotDir, { recursive: true, force: true });
  });

  it('writes and reads a snapshot by its key', async () => {
    await store.write(snapshot);

    await expect(
      store.read({ platform: 'qidian', rank: 'hotsales', channel: null }),
    ).resolves.toEqual(snapshot);
  });

  it('returns undefined when a snapshot does not exist', async () => {
    await expect(
      store.read({ platform: 'qidian', rank: 'hotsales', channel: null }),
    ).resolves.toBeUndefined();
  });
});
