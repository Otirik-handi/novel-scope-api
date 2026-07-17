import { RankingProvider } from './domain/ranking-provider';
import { RankingSnapshot } from './domain/ranking.types';
import { RankingsService } from './rankings.service';

describe('RankingsService', () => {
  const snapshot: RankingSnapshot = {
    platform: 'qidian', rank: 'hotsales', channel: null,
    sourceUrl: 'https://example.test', fetchedAt: '2026-07-17T00:00:00.000Z',
    status: 'fresh', items: [],
  };

  it('returns an existing snapshot as stale when refresh fails', async () => {
    const store = { read: jest.fn().mockResolvedValue(snapshot), write: jest.fn() };
    const provider: RankingProvider = {
      platform: 'qidian',
      fetch: jest.fn().mockRejectedValue(new Error('source unavailable')),
    };
    const service = new RankingsService(store, [provider]);

    await expect(service.refresh(snapshot)).resolves.toEqual({
      ...snapshot,
      status: 'stale',
      lastError: 'source unavailable',
    });
    expect(store.write).not.toHaveBeenCalled();
  });

  it('returns a persisted snapshot without triggering a refresh', async () => {
    const store = { read: jest.fn().mockResolvedValue(snapshot), write: jest.fn() };
    const service = new RankingsService(store, []);

    await expect(service.get(snapshot)).resolves.toEqual(snapshot);
  });
});
