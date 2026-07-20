import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/main';

describe('OpenAPI documentation', () => {
  let app: INestApplication;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('publishes the V0.1 HTTP contract outside production', async () => {
    const response = await request(app.getHttpServer()).get('/api-docs-json').expect(200);

    expect(response.body.info).toMatchObject({ title: 'Novel Ranking API', version: '0.1' });
    expect(Object.keys(response.body.paths)).toEqual(expect.arrayContaining([
      '/v1/rankings/{platform}/{rankType}',
      '/v1/rankings/{platform}/{rankType}/history',
      '/v1/rankings/{platform}/{rankType}/refresh',
      '/v1/rankings/{platform}/refresh',
      '/v1/books/{platform}/{bookId}',
      '/health/live',
      '/health/ready',
    ]));
  });

  it('does not publish the OpenAPI contract in production', async () => {
    process.env.NODE_ENV = 'production';
    const productionApp = await createApp();
    await productionApp.init();

    try {
      await request(productionApp.getHttpServer()).get('/api-docs-json').expect(404);
    } finally {
      await productionApp.close();
      process.env.NODE_ENV = 'test';
    }
  });
});
