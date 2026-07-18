import { RankingProvider } from './domain/ranking-provider';
import { RankingSnapshot } from './domain/ranking.types';
import { RankingsService } from './rankings.service';
import { StructuredLogger } from '../structured-logger';

describe('RankingsService', () => {
  const snapshot: RankingSnapshot = {
    platform: 'qidian', rank: 'hotsales', channel: null,
    sourceUrl: 'https://example.test', fetchedAt: '2026-07-17T00:00:00.000Z',
    status: 'fresh', items: [],
  };

  it('returns an existing snapshot as stale when refresh fails', async () => {
    const store = { read: jest.fn().mockResolvedValue(snapshot), write: jest.fn(), recordFailure: jest.fn() };
    const provider: RankingProvider = {
      platform: 'qidian',
      fetch: jest.fn().mockRejectedValue(new Error('source unavailable')),
    };
    const service = new RankingsService(store, [provider]);

    await expect(service.refresh(snapshot)).resolves.toEqual({
      ...snapshot,
      status: 'stale',
      lastError: 'UNKNOWN_ERROR',
    });
    expect(store.write).not.toHaveBeenCalled();
    expect(store.recordFailure).toHaveBeenCalledWith(snapshot, expect.any(Date), expect.any(Error));
  });

  it('returns a persisted snapshot without triggering a refresh', async () => {
    const store = { read: jest.fn().mockResolvedValue(snapshot), write: jest.fn(), recordFailure: jest.fn() };
    const service = new RankingsService(store, []);

    await expect(service.get(snapshot)).resolves.toEqual(snapshot);
  });

  it('writes a successful crawl completion using the whitelisted result', async () => {
    const store = { read: jest.fn(), write: jest.fn(), recordFailure: jest.fn() };
    const provider: RankingProvider = { platform: 'qidian', fetch: jest.fn().mockResolvedValue(snapshot) };
    const logger = { crawlCompleted: jest.fn() } as unknown as StructuredLogger;
    const service = new RankingsService(store, [provider], undefined, logger);

    await service.refresh(snapshot);

    expect(logger.crawlCompleted).toHaveBeenCalledWith(expect.objectContaining({
      targetType: 'ranking', targetKey: 'qidian:hotsales', platform: 'qidian', result: 'success',
    }));
  });

  it('writes a failed crawl completion without an upstream error message', async () => {
    const store = { read: jest.fn().mockResolvedValue(snapshot), write: jest.fn(), recordFailure: jest.fn() };
    const provider: RankingProvider = { platform: 'qidian', fetch: jest.fn().mockRejectedValue(new Error('upstream secret text')) };
    const logger = { crawlCompleted: jest.fn() } as unknown as StructuredLogger;
    const service = new RankingsService(store, [provider], undefined, logger);

    await service.refresh(snapshot);

    expect(logger.crawlCompleted).toHaveBeenCalledWith(expect.objectContaining({
      result: 'failed', errorCode: 'UNKNOWN_ERROR',
    }));
    expect(logger.crawlCompleted.mock.calls[0]?.[0]).not.toHaveProperty('error');
  });

  it('writes a skipped crawl completion when the advisory lock is unavailable', async () => {
    const store = { read: jest.fn().mockResolvedValue(snapshot), write: jest.fn(), recordFailure: jest.fn() };
    const lock = { withLock: jest.fn().mockResolvedValue({ acquired: false }) };
    const logger = { crawlCompleted: jest.fn() } as unknown as StructuredLogger;
    const service = new RankingsService(store, [], lock, logger);

    await service.refresh(snapshot);

    expect(logger.crawlCompleted).toHaveBeenCalledWith(expect.objectContaining({
      result: 'skipped',
    }));
    expect(logger.crawlCompleted.mock.calls[0]?.[0]).not.toHaveProperty('errorCode');
  });

  it('writes a failed crawl completion even when failure persistence rejects', async () => {
    const store = { read: jest.fn(), write: jest.fn(), recordFailure: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const provider: RankingProvider = { platform: 'qidian', fetch: jest.fn().mockRejectedValue(new Error('upstream secret text')) };
    const logger = { crawlCompleted: jest.fn() } as unknown as StructuredLogger;
    const service = new RankingsService(store, [provider], undefined, logger);

    await expect(service.refresh(snapshot)).rejects.toThrow('database unavailable');

    expect(logger.crawlCompleted).toHaveBeenCalledWith(expect.objectContaining({ result: 'failed', errorCode: 'UNKNOWN_ERROR' }));
  });

  it('writes a skipped crawl completion even when skip persistence rejects', async () => {
    const store = { read: jest.fn(), write: jest.fn(), recordFailure: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const lock = { withLock: jest.fn().mockResolvedValue({ acquired: false }) };
    const logger = { crawlCompleted: jest.fn() } as unknown as StructuredLogger;
    const service = new RankingsService(store, [], lock, logger);

    await expect(service.refresh(snapshot)).rejects.toThrow('database unavailable');

    expect(logger.crawlCompleted).toHaveBeenCalledWith(expect.objectContaining({ result: 'skipped' }));
  });

  it('writes a failed crawl completion when advisory lock acquisition rejects', async () => {
    const store = { read: jest.fn(), write: jest.fn(), recordFailure: jest.fn() };
    const lock = { withLock: jest.fn().mockRejectedValue(new Error('lock database unavailable')) };
    const logger = { crawlCompleted: jest.fn() } as unknown as StructuredLogger;
    const service = new RankingsService(store, [], lock, logger);

    await expect(service.refresh(snapshot)).rejects.toThrow('lock database unavailable');

    expect(logger.crawlCompleted).toHaveBeenCalledWith(expect.objectContaining({ result: 'failed', errorCode: 'UNKNOWN_ERROR' }));
  });
});
