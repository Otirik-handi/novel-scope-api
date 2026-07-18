import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BookDetailsService } from '../src/rankings/book-details.service';

describe('Book details API', () => {
  let app: INestApplication;
  const snapshot = {
    bookId: '123', title: 'Test Book', author: 'Test Author', genres: [], description: null,
    bookStatus: null, wordCount: null, url: 'https://m.qidian.com/book/123/',
    sourceUrl: 'https://m.qidian.com/book/123/', fetchedAt: '2026-07-18T00:00:00.000Z', status: 'fresh' as const,
  };
  const details = { get: jest.fn().mockResolvedValue(snapshot), refresh: jest.fn().mockResolvedValue(snapshot) };

  beforeAll(async () => {
    process.env.REFRESH_API_KEY = 'test-key';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BookDetailsService).useValue(details).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    delete process.env.REFRESH_API_KEY;
    await app.close();
  });

  it('returns a Qidian book detail snapshot', async () => {
    await request(app.getHttpServer()).get('/v1/books/qidian/123').expect(200).expect(snapshot);
    expect(details.get).toHaveBeenCalledWith('123');
  });

  it('rejects an invalid book id', async () => {
    await request(app.getHttpServer()).get('/v1/books/qidian/abc').expect(400);
  });

  it('requires an API key for forced refresh', async () => {
    await request(app.getHttpServer()).post('/v1/admin/books/qidian/123/refresh').expect(401);
  });

  it('forces a refresh with a valid API key', async () => {
    await request(app.getHttpServer())
      .post('/v1/admin/books/qidian/123/refresh')
      .set('X-API-Key', 'test-key')
      .expect(201)
      .expect(snapshot);
    expect(details.refresh).toHaveBeenCalledWith('123');
  });

  it('allows API-key refresh after the global throttle would otherwise be exhausted', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BookDetailsService).useValue(details).compile();
    const rateLimitedApp = moduleRef.createNestApplication();
    await rateLimitedApp.init();

    try {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await request(rateLimitedApp.getHttpServer())
          .post('/v1/admin/books/qidian/123/refresh')
          .set('X-API-Key', 'test-key')
          .expect(201);
      }

      await request(rateLimitedApp.getHttpServer())
        .post('/v1/admin/books/qidian/123/refresh')
        .set('X-API-Key', 'test-key')
        .expect(201);
    } finally {
      await rateLimitedApp.close();
    }
  });

  it('limits public book detail reads to ten requests per minute', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BookDetailsService).useValue(details).compile();
    const rateLimitedApp = moduleRef.createNestApplication();
    await rateLimitedApp.init();

    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await request(rateLimitedApp.getHttpServer()).get('/v1/books/qidian/123').expect(200);
      }

      await request(rateLimitedApp.getHttpServer())
        .get('/v1/books/qidian/123')
        .expect(429)
        .expect((response) => expect(response.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED', requestId: expect.any(String) }));
    } finally {
      await rateLimitedApp.close();
    }
  });
});
