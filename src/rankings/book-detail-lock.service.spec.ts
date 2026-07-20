import { GatewayTimeoutException } from '@nestjs/common';
import { PostgresBookDetailLockService } from './book-detail-lock.service';

describe('PostgresBookDetailLockService', () => {
  afterEach(() => jest.useRealTimers());
  it('does not start a crawl when connecting to PostgreSQL exceeds the refresh deadline', async () => {
    jest.useFakeTimers();
    const client = { query: jest.fn(), release: jest.fn() };
    const connect = jest.fn(() => new Promise<typeof client>((resolve) => setTimeout(() => resolve(client), 100)));
    const locks = new PostgresBookDetailLockService({ connect } as never);
    const work = jest.fn();
    const promise = locks.withLock('qidian:book:123', Date.now() + 25, work);
    await jest.advanceTimersByTimeAsync(25);

    await expect(promise).resolves.toEqual({ acquired: false });
    expect(work).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(100);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('returns waiting callers without acquiring after the first holder releases', async () => {
    jest.useFakeTimers();
    const query = jest.fn().mockResolvedValue({ rows: [{ locked: false }] });
    const client = { query, release: jest.fn() };
    const locks = new PostgresBookDetailLockService({ connect: jest.fn().mockResolvedValue(client) } as never);

    const result = locks.withLock('qidian:book:123', Date.now() + 100, jest.fn());
    await jest.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toEqual({ acquired: false });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does not run waiting work after it observes the first holder release', async () => {
    jest.useFakeTimers();
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: false }] })
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] });
    const client = { query, release: jest.fn() };
    const locks = new PostgresBookDetailLockService({ connect: jest.fn().mockResolvedValue(client) } as never);
    const work = jest.fn();
    const result = locks.withLock('qidian:book:123', Date.now() + 100, work);
    await jest.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toEqual({ acquired: false });
    expect(work).not.toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('pg_advisory_unlock'), ['qidian:book:123']);
  });

  it('releases the connection when advisory unlock fails', async () => {
    const unlockError = new Error('unlock failed');
    const query = jest.fn().mockResolvedValueOnce({ rows: [{ locked: true }] }).mockRejectedValueOnce(unlockError);
    const client = { query, release: jest.fn() };
    const locks = new PostgresBookDetailLockService({ connect: jest.fn().mockResolvedValue(client) } as never);

    await expect(locks.withLock('qidian:book:123', Date.now() + 100, async () => 'worked')).rejects.toThrow(unlockError);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('times out a blocking advisory-lock query and destroys the client', async () => {
    jest.useFakeTimers();
    const query = jest.fn(() => new Promise(() => undefined));
    const client = { query, release: jest.fn() };
    const locks = new PostgresBookDetailLockService({ connect: jest.fn().mockResolvedValue(client) } as never);

    const result = locks.withLock('qidian:book:123', Date.now() + 25, jest.fn());
    const expected = expect(result).rejects.toThrow('BOOK_DETAIL_TIMEOUT');
    await jest.advanceTimersByTimeAsync(25);

    await expected;
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });

  it('preserves a callback timeout when advisory unlock exceeds the deadline', async () => {
    jest.useFakeTimers();
    const callbackError = new GatewayTimeoutException({ code: 'BOOK_DETAIL_FETCH_TIMEOUT' });
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockImplementationOnce(() => new Promise(() => undefined));
    const client = { query, release: jest.fn() };
    const locks = new PostgresBookDetailLockService({ connect: jest.fn().mockResolvedValue(client) } as never);

    const result = locks.withLock('qidian:book:123', Date.now() + 25, async () => { throw callbackError; });
    const expected = expect(result).rejects.toBe(callbackError);
    await jest.advanceTimersByTimeAsync(25);

    await expected;
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
  });
});
