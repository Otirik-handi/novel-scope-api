import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BookDetailsService } from '../src/services/book-details.service';

describe('Book details API', () => {
  let app: INestApplication;
  const snapshot = { bookId: '123', title: 'Test Book', author: 'Test Author', genres: [], description: null, bookStatus: null, wordCount: null, totalRecCount: null, chaptersNum: null, monthCount: null, recCount: null, rewardNum: null, sourceUrl: 'https://www.qidian.com/book/123/', fetchedAt: '2026-07-18T00:00:00.000Z', expiresAt: '2026-07-18T03:00:00.000Z', status: 'fresh', lastError: null, stale: false };
  const details = { get: jest.fn().mockResolvedValue(snapshot) };
  beforeAll(async () => { process.env.REFRESH_API_KEY = 'test-key'; const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(BookDetailsService).useValue(details).compile(); app = moduleRef.createNestApplication(); await app.init(); });
  afterAll(async () => { delete process.env.REFRESH_API_KEY; await app.close(); });
  it('returns the only public V1 book-detail contract', async () => { await request(app.getHttpServer()).get('/v1/books/qidian/123').expect(200).expect(snapshot); expect(details.get).toHaveBeenCalledWith('123'); });
  it('rejects unsupported platforms and non-numeric identifiers', async () => { await request(app.getHttpServer()).get('/v1/books/unsupported/123').expect(400); await request(app.getHttpServer()).get('/v1/books/qidian/abc').expect(400); });
  it('does not expose the removed admin refresh endpoint', async () => { await request(app.getHttpServer()).post('/v1/admin/books/qidian/123/refresh').expect(404); });
  it('enforces the dedicated ten-per-minute book detail limit', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(BookDetailsService).useValue({ get: jest.fn().mockResolvedValue(snapshot) }).compile();
    const rateLimitedApp = moduleRef.createNestApplication();
    await rateLimitedApp.init();
    try {
      for (let index = 0; index < 10; index += 1) await request(rateLimitedApp.getHttpServer()).get('/v1/books/qidian/123').expect(200);
      await request(rateLimitedApp.getHttpServer()).get('/v1/books/qidian/123').expect(429).expect((response) => expect(response.body).toMatchObject({ code: 'RATE_LIMITED' }));
    } finally {
      await rateLimitedApp.close();
    }
  });
});
