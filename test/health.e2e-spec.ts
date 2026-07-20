import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('health probes', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns liveness without requiring a database query', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'ok' });

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps GET /health as a liveness compatibility alias', async () => {
    await request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });
});
