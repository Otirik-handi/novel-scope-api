import { BadRequestException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RankingsService, RefreshInProgressError } from '../src/rankings/rankings.service';
import { BadGatewayException } from '@nestjs/common';
import { configureTrustProxy } from '../src/main';

type HistorySnapshot = {
  id: string;
  platform: 'qidian';
  rank: 'hotsales';
  channel: null;
  sourceUrl: string;
  fetchedAt: string;
  status: 'fresh';
  items: [];
};

const encodeCursor = (snapshot: HistorySnapshot): string =>
  Buffer.from(JSON.stringify({ fetchedAt: snapshot.fetchedAt, id: snapshot.id })).toString('base64url');

function createInMemoryHistory(snapshots: HistorySnapshot[]) {
  return (query: { from?: string; to?: string; limit?: number; cursor?: string }) => {
    let cursor: { fetchedAt: string; id: string } | undefined;
    if (query.cursor) {
      try {
        const decoded: unknown = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (typeof decoded !== 'object' || decoded === null || typeof (decoded as { fetchedAt?: unknown }).fetchedAt !== 'string' || typeof (decoded as { id?: unknown }).id !== 'string') throw new Error();
        cursor = decoded as { fetchedAt: string; id: string };
        if (Number.isNaN(new Date(cursor.fetchedAt).getTime())) throw new Error();
      } catch {
        throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Invalid cursor' });
      }
    }

    const limit = query.limit ?? 20;
    const rows = snapshots
      .filter((snapshot) => (!query.from || snapshot.fetchedAt >= query.from) && (!query.to || snapshot.fetchedAt <= query.to))
      .filter((snapshot) => !cursor || snapshot.fetchedAt < cursor.fetchedAt || (snapshot.fetchedAt === cursor.fetchedAt && snapshot.id < cursor.id))
      .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt) || right.id.localeCompare(left.id));
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? encodeCursor(items.at(-1)!) : null };
  };
}

describe('Rankings API', () => {
  let app: INestApplication;
  const rankings = {
    get: jest.fn(),
    history: jest.fn(),
    refresh: jest.fn(),
    refreshStrict: jest.fn(),
    refreshPlatform: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RankingsService).useValue(rankings).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => jest.clearAllMocks());

  it('reads the latest successful snapshot from the canonical route', async () => {
    rankings.get.mockResolvedValue({ id: 'snapshot-1', platform: 'qidian', rank: 'hotsales', fetchedAt: '2026-07-17T00:00:00.000Z', items: [] });

    await request(app.getHttpServer())
      .get('/v1/rankings/qidian/hotsales')
      .expect(200)
      .expect((response) => expect(response.body.id).toBe('snapshot-1'));

    expect(rankings.get).toHaveBeenCalledWith({ platform: 'qidian', rank: 'hotsales', channel: null });
  });

  it('returns a stable structured error when no snapshot exists', async () => {
    rankings.get.mockRejectedValue(Object.assign(new Error('missing'), { code: 'RANKING_SNAPSHOT_NOT_FOUND', status: 404 }));

    await request(app.getHttpServer())
      .get('/v1/rankings/qidian/hotsales')
      .expect(404)
      .expect((response) => expect(response.body).toMatchObject({ statusCode: 404, code: 'RANKING_SNAPSHOT_NOT_FOUND', message: expect.any(String), requestId: expect.any(String) }));
  });

  it('paginates history by fetchedAt then id and returns a null cursor at the end', async () => {
    const snapshots: HistorySnapshot[] = [
      { id: 'snapshot-c', platform: 'qidian', rank: 'hotsales', channel: null, sourceUrl: 'https://example.test/c', fetchedAt: '2026-07-18T12:00:00.000Z', status: 'fresh', items: [] },
      { id: 'snapshot-b', platform: 'qidian', rank: 'hotsales', channel: null, sourceUrl: 'https://example.test/b', fetchedAt: '2026-07-18T12:00:00.000Z', status: 'fresh', items: [] },
      { id: 'snapshot-a', platform: 'qidian', rank: 'hotsales', channel: null, sourceUrl: 'https://example.test/a', fetchedAt: '2026-07-18T11:00:00.000Z', status: 'fresh', items: [] },
    ];
    rankings.history.mockImplementation((_key: unknown, query: { from?: string; to?: string; limit?: number; cursor?: string }) => createInMemoryHistory(snapshots)(query));

    const first = await request(app.getHttpServer()).get('/v1/rankings/qidian/hotsales/history?limit=2').expect(200);
    expect(first.body.items.map((item: HistorySnapshot) => item.id)).toEqual(['snapshot-c', 'snapshot-b']);
    expect(first.body.nextCursor).toBe(encodeCursor(snapshots[1]));

    const second = await request(app.getHttpServer()).get(`/v1/rankings/qidian/hotsales/history?limit=2&cursor=${first.body.nextCursor}`).expect(200);
    expect(second.body.items.map((item: HistorySnapshot) => item.id)).toEqual(['snapshot-a']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('includes both history time boundaries', async () => {
    const snapshots: HistorySnapshot[] = [
      { id: 'snapshot-after', platform: 'qidian', rank: 'hotsales', channel: null, sourceUrl: 'https://example.test/after', fetchedAt: '2026-07-18T00:00:01.000Z', status: 'fresh', items: [] },
      { id: 'snapshot-at-to', platform: 'qidian', rank: 'hotsales', channel: null, sourceUrl: 'https://example.test/to', fetchedAt: '2026-07-18T00:00:00.000Z', status: 'fresh', items: [] },
      { id: 'snapshot-at-from', platform: 'qidian', rank: 'hotsales', channel: null, sourceUrl: 'https://example.test/from', fetchedAt: '2026-07-17T00:00:00.000Z', status: 'fresh', items: [] },
      { id: 'snapshot-before', platform: 'qidian', rank: 'hotsales', channel: null, sourceUrl: 'https://example.test/before', fetchedAt: '2026-07-16T23:59:59.000Z', status: 'fresh', items: [] },
    ];
    rankings.history.mockImplementation((_key: unknown, query: { from?: string; to?: string; limit?: number; cursor?: string }) => createInMemoryHistory(snapshots)(query));

    const response = await request(app.getHttpServer())
      .get('/v1/rankings/qidian/hotsales/history?from=2026-07-17T00:00:00.000Z&to=2026-07-18T00:00:00.000Z')
      .expect(200);

    expect(response.body.items.map((item: HistorySnapshot) => item.id)).toEqual(['snapshot-at-to', 'snapshot-at-from']);
  });

  it.each([
    '/v1/rankings/qidian/hotsales/history?from=2026-07-18T00:00:00',
    '/v1/rankings/qidian/hotsales/history?to=not-a-time',
    '/v1/rankings/qidian/hotsales/history?from=2026-07-19T00:00:00.000Z&to=2026-07-18T00:00:00.000Z',
    '/v1/rankings/qidian/hotsales/history?limit=0',
    '/v1/rankings/qidian/hotsales/history?limit=101',
    '/v1/rankings/qidian/hotsales/history?cursor=not-a-cursor',
  ])('rejects invalid history query parameters with a structured 400: %s', async (path) => {
    await request(app.getHttpServer())
      .get(path)
      .expect(400)
      .expect((response) => expect(response.body).toMatchObject({ statusCode: 400, code: expect.any(String), requestId: expect.any(String) }));
  });

  it('requires an API key without exposing whether it was absent or wrong', async () => {
    await request(app.getHttpServer())
      .post('/v1/rankings/qidian/hotsales/refresh')
      .expect(401)
      .expect((response) => expect(response.body.code).toBe('INVALID_API_KEY'));
  });

  it.each([
    ['returns 200 when every ranking refresh succeeds', [{ rankType: 'hotsales', status: 'success', snapshotId: '1' }, { rankType: 'yuepiao', status: 'success', snapshotId: '2' }, { rankType: 'recom', status: 'success', snapshotId: '3' }, { rankType: 'collect', status: 'success', snapshotId: '4' }], 200],
    ['returns 207 when any ranking refresh fails', [{ rankType: 'hotsales', status: 'success', snapshotId: '1' }, { rankType: 'yuepiao', status: 'failed', errorCode: 'UPSTREAM_ERROR' }, { rankType: 'recom', status: 'skipped', errorCode: 'REFRESH_IN_PROGRESS' }, { rankType: 'collect', status: 'success', snapshotId: '4' }], 207],
    ['returns 207 when every ranking refresh is skipped', [{ rankType: 'hotsales', status: 'skipped', errorCode: 'REFRESH_IN_PROGRESS' }, { rankType: 'yuepiao', status: 'skipped', errorCode: 'REFRESH_IN_PROGRESS' }, { rankType: 'recom', status: 'skipped', errorCode: 'REFRESH_IN_PROGRESS' }, { rankType: 'collect', status: 'skipped', errorCode: 'REFRESH_IN_PROGRESS' }], 207],
    ['returns 502 when every ranking refresh fails', [{ rankType: 'hotsales', status: 'failed', errorCode: 'UPSTREAM_ERROR' }, { rankType: 'yuepiao', status: 'failed', errorCode: 'TIMEOUT' }, { rankType: 'recom', status: 'failed', errorCode: 'NETWORK_ERROR' }, { rankType: 'collect', status: 'failed', errorCode: 'UNKNOWN_ERROR' }], 502],
  ])('%s', async (_description, results, expectedStatus) => {
    rankings.refreshPlatform.mockResolvedValue({ results });

    const response = await request(app.getHttpServer())
      .post('/v1/rankings/qidian/refresh')
      .set('X-API-Key', 'test-key')
      .expect(expectedStatus);

    expect(response.body.results).toEqual(results);
  });

  it('returns a request-correlated 409 when a single refresh lock is already held', async () => {
    rankings.refreshStrict.mockRejectedValue(new RefreshInProgressError());

    await request(app.getHttpServer())
      .post('/v1/rankings/qidian/hotsales/refresh')
      .set('X-API-Key', 'test-key')
      .set('X-Request-Id', 'refresh-conflict-request')
      .expect(409)
      .expect((response) => {
        expect(response.headers['x-request-id']).toBe('refresh-conflict-request');
        expect(response.body).toEqual({ statusCode: 409, code: 'REFRESH_IN_PROGRESS', message: 'Ranking refresh already in progress', requestId: 'refresh-conflict-request' });
      });
  });

  it('returns a stable 502 when a manual refresh crawl fails despite an existing snapshot', async () => {
    rankings.refresh.mockResolvedValue({ id: 'stale-snapshot', platform: 'qidian', rank: 'hotsales', fetchedAt: '2026-07-18T00:00:00.000Z', status: 'stale', items: [] });
    rankings.refreshStrict.mockRejectedValue(new BadGatewayException({ code: 'UPSTREAM_ERROR', message: 'Ranking refresh failed' }));

    await request(app.getHttpServer())
      .post('/v1/rankings/qidian/hotsales/refresh')
      .set('X-API-Key', 'test-key')
      .expect(502)
      .expect((response) => expect(response.body).toMatchObject({ statusCode: 502, code: 'UPSTREAM_ERROR', requestId: expect.any(String) }));
  });

  it('limits public ranking reads by client IP while allowing API-key refresh after the limit', async () => {
    rankings.get.mockResolvedValue({ id: 'snapshot-1', platform: 'qidian', rank: 'hotsales', fetchedAt: '2026-07-17T00:00:00.000Z', items: [] });
    rankings.refreshStrict.mockResolvedValue({ id: 'snapshot-2', platform: 'qidian', rank: 'hotsales', fetchedAt: '2026-07-18T00:00:00.000Z', items: [] });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RankingsService).useValue(rankings).compile();
    const rateLimitedApp = moduleRef.createNestApplication();
    await rateLimitedApp.init();

    try {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await request(rateLimitedApp.getHttpServer()).get('/v1/rankings/qidian/hotsales').expect(200);
      }

      await request(rateLimitedApp.getHttpServer())
        .get('/v1/rankings/qidian/hotsales')
        .expect(429)
        .expect((response) => expect(response.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED', requestId: expect.any(String) }));

      await request(rateLimitedApp.getHttpServer())
        .post('/v1/rankings/qidian/hotsales/refresh')
        .set('X-API-Key', 'test-key')
        .expect(201);
    } finally {
      await rateLimitedApp.close();
    }
  });

  it('ignores X-Forwarded-For by default when applying the public rate limit', async () => {
    rankings.get.mockResolvedValue({ id: 'snapshot-1', platform: 'qidian', rank: 'hotsales', fetchedAt: '2026-07-17T00:00:00.000Z', items: [] });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RankingsService).useValue(rankings).compile();
    const rateLimitedApp = moduleRef.createNestApplication();
    configureTrustProxy(rateLimitedApp, false);
    await rateLimitedApp.init();

    try {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await request(rateLimitedApp.getHttpServer()).get('/v1/rankings/qidian/hotsales').set('X-Forwarded-For', '203.0.113.10').expect(200);
      }
      await request(rateLimitedApp.getHttpServer())
        .get('/v1/rankings/qidian/hotsales')
        .set('X-Forwarded-For', '198.51.100.10')
        .expect(429);
    } finally {
      await rateLimitedApp.close();
    }
  });

  it('uses forwarded client IPs only when the loopback proxy range is explicitly trusted', async () => {
    rankings.get.mockResolvedValue({ id: 'snapshot-1', platform: 'qidian', rank: 'hotsales', fetchedAt: '2026-07-17T00:00:00.000Z', items: [] });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RankingsService).useValue(rankings).compile();
    const rateLimitedApp = moduleRef.createNestApplication();
    configureTrustProxy(rateLimitedApp, 'loopback');
    await rateLimitedApp.init();

    try {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await request(rateLimitedApp.getHttpServer()).get('/v1/rankings/qidian/hotsales').set('X-Forwarded-For', '203.0.113.10').expect(200);
      }
      await request(rateLimitedApp.getHttpServer())
        .get('/v1/rankings/qidian/hotsales')
        .set('X-Forwarded-For', '198.51.100.10')
        .expect(200);
    } finally {
      await rateLimitedApp.close();
    }
  });
});
