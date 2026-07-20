import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma/prisma.service';
import { BooksController } from './api/books.controller';
import { BookDetailsService } from './rankings/book-details.service';
import { RankingsController } from './api/rankings.controller';
import { RankingsService } from './rankings/rankings.service';

describe('OpenAPI contract', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController, RankingsController, BooksController],
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: RankingsService, useValue: {} },
        { provide: BookDetailsService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Novel Ranking API')
        .setVersion('0.1')
        .addApiKey({ type: 'apiKey', in: 'header', name: 'X-API-Key' }, 'refresh-api-key')
        .build(),
    );
  });

  afterAll(async () => app.close());

  it('documents supported ranking route and history query parameters', () => {
    const latest = document.paths['/v1/rankings/{platform}/{rankType}'].get!;
    const latestParameters = latest.parameters as Array<Record<string, unknown>>;
    expect(latest.tags).toContain('rankings');
    expect(latestParameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'platform', in: 'path', required: true, schema: expect.objectContaining({ enum: ['qidian'] }) }),
      expect.objectContaining({ name: 'rankType', in: 'path', required: true, schema: expect.objectContaining({ enum: ['hotsales', 'yuepiao', 'recom', 'collect'] }) }),
    ]));
    expect(latest.responses['200'].content?.['application/json'].schema).toEqual({ $ref: '#/components/schemas/RankingSnapshotResponseDto' });

    const history = document.paths['/v1/rankings/{platform}/{rankType}/history'].get!;
    const queryParameters = history.parameters as Array<Record<string, unknown>>;
    expect(queryParameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'from', in: 'query', required: false }),
      expect.objectContaining({ name: 'to', in: 'query', required: false }),
      expect.objectContaining({ name: 'limit', in: 'query', required: false, schema: expect.objectContaining({ maximum: 100, default: 20 }) }),
      expect.objectContaining({ name: 'cursor', in: 'query', required: false }),
    ]));
    expect(history.responses['200'].content?.['application/json'].schema).toEqual({ $ref: '#/components/schemas/RankingHistoryResponseDto' });
  });

  it('documents refresh authentication and book detail response shape', () => {
    const refresh = document.paths['/v1/rankings/{platform}/{rankType}/refresh'].post!;
    expect(refresh.tags).toContain('rankings');
    expect(refresh.security).toEqual([{ 'refresh-api-key': [] }]);
    expect(refresh.responses).toEqual(expect.objectContaining({ '200': expect.any(Object), '401': expect.any(Object), '409': expect.any(Object), '502': expect.any(Object) }));

    const detail = document.paths['/v1/books/{platform}/{bookId}'].get!;
    expect(detail.tags).toContain('books');
    expect(detail.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'platform', in: 'path', schema: expect.objectContaining({ enum: ['qidian'] }) }),
      expect.objectContaining({ name: 'bookId', in: 'path', schema: expect.objectContaining({ pattern: '^\\d+$' }) }),
    ]));
    expect(detail.responses['200'].content?.['application/json'].schema).toEqual({ $ref: '#/components/schemas/BookDetailResponseDto' });
    expect(document.components.schemas?.BookDetailResponseDto).toEqual(expect.objectContaining({
      required: expect.arrayContaining(['bookId', 'title', 'author', 'genres', 'sourceUrl', 'fetchedAt', 'stale']),
      properties: expect.objectContaining({ stale: expect.objectContaining({ type: 'boolean' }) }),
    }));
  });
});
