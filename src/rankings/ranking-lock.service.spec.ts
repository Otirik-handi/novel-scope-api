import { PostgresRankingLockService } from './ranking-lock.service';

describe('PostgresRankingLockService', () => {
  function createPool(query: jest.Mock) {
    const client = { query, release: jest.fn() };
    return { pool: { connect: jest.fn().mockResolvedValue(client) }, client };
  }

  it('checks out one client and uses it to acquire and release the advisory lock', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] });
    const { pool, client } = createPool(query);
    const locks = new PostgresRankingLockService(pool as never);

    await expect(locks.withLock('qidian', 'hotsales', async () => 'worked'))
      .resolves.toEqual({ acquired: true, value: 'worked' });

    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('pg_try_advisory_lock'), ['qidian:hotsales']);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('pg_advisory_unlock'), ['qidian:hotsales']);
    expect(client.release).toHaveBeenCalledWith();
  });

  it('unlocks and releases the client when work throws', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] });
    const { pool, client } = createPool(query);
    const locks = new PostgresRankingLockService(pool as never);

    await expect(locks.withLock('qidian', 'hotsales', async () => {
      throw new Error('crawl failed');
    })).rejects.toThrow('crawl failed');

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0]).toContain('pg_advisory_unlock');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('destroys the client when advisory unlock rejects', async () => {
    const unlockError = new Error('unlock failed');
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockRejectedValueOnce(unlockError);
    const { pool, client } = createPool(query);
    const locks = new PostgresRankingLockService(pool as never);

    await expect(locks.withLock('qidian', 'hotsales', async () => 'worked'))
      .rejects.toThrow(unlockError);

    expect(client.release).toHaveBeenCalledWith(unlockError);
  });

  it('destroys the client when advisory unlock reports the lock was not released', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ unlocked: false }] });
    const { pool, client } = createPool(query);
    const locks = new PostgresRankingLockService(pool as never);

    await expect(locks.withLock('qidian', 'hotsales', async () => 'worked'))
      .rejects.toThrow('Failed to release ranking advisory lock');

    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('does not run work when the advisory lock is unavailable and releases the client', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ locked: false }] });
    const { pool, client } = createPool(query);
    const locks = new PostgresRankingLockService(pool as never);
    const work = jest.fn().mockResolvedValue('worked');

    await expect(locks.withLock('qidian', 'hotsales', work)).resolves.toEqual({ acquired: false });

    expect(work).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('releases the client when the advisory lock query fails', async () => {
    const query = jest.fn().mockRejectedValue(new Error('database unavailable'));
    const { pool, client } = createPool(query);
    const locks = new PostgresRankingLockService(pool as never);

    await expect(locks.withLock('qidian', 'hotsales', async () => 'worked'))
      .rejects.toThrow('database unavailable');

    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
