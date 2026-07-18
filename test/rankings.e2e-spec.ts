import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SnapshotStoreService } from '../src/rankings/snapshot-store.service';

describe('Rankings API', () => {
  let app: INestApplication;
  const snapshots = new Map<string, Parameters<SnapshotStoreService['write']>[0]>();
  const store = {
    read: jest.fn(async (key) => snapshots.get(`${key.platform}:${key.rank}`)),
    write: jest.fn(async (snapshot) => { snapshots.set(`${snapshot.platform}:${snapshot.rank}`, snapshot); }),
    recordFailure: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SnapshotStoreService).useValue(store).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await store.write({
      platform: 'qidian', rank: 'hotsales', channel: null,
      sourceUrl: 'https://example.test', fetchedAt: '2026-07-17T00:00:00.000Z',
      status: 'stale', lastError: 'source unavailable', items: [],
    });
  });

  afterAll(async () => app.close());

  it('returns a stale persisted snapshot', async () => {
    await request(app.getHttpServer())
      .get('/v1/rankings?platform=qidian&rank=hotsales')
      .expect(200)
      .expect((response) => expect(response.body.status).toBe('stale'));
  });

  it('requires an API key for manual refresh', async () => {
    await request(app.getHttpServer())
      .post('/v1/admin/refresh')
      .send({ platform: 'qidian', rank: 'hotsales' })
      .expect(401);
  });
});
