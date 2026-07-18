import { BadGatewayException } from '@nestjs/common';
import { BookDetailsService } from './book-details.service';
import { BookDetailSnapshot } from './domain/book-detail.types';
import { QidianBookDetailProvider } from './providers/qidian-book-detail.provider';
import { BookDetailStoreService } from './book-detail-store.service';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('QidianBookDetailProvider', () => {
  it('normalizes book details from SSR pageContext', async () => {
    const html = await import('node:fs/promises').then(({ readFile }) =>
      readFile('test/fixtures/qidian-book-detail.html', 'utf8'),
    );
    const request = { get: jest.fn().mockResolvedValue(Buffer.from(html)) };
    const provider = new QidianBookDetailProvider(request);

    await expect(provider.fetch('123')).resolves.toMatchObject({
      bookId: '123', title: 'Test Book', author: 'Test Author',
      genres: ['Fantasy', 'Eastern Fantasy'], description: 'A test description',
      bookStatus: 'Completed', wordCount: 123000, url: 'https://m.qidian.com/book/123/',
      sourceUrl: 'https://m.qidian.com/book/123/', status: 'fresh',
    });
    expect(request.get).toHaveBeenCalledWith('https://m.qidian.com/book/123/');
  });

  it.each([123000, '123000'])('accepts an unqualified word count of %p', async (cnt) => {
    const html = `<script id="vite-plugin-ssr_pageContext">${JSON.stringify({
      pageContext: { pageProps: { pageData: { bookInfo: { bName: 'Test', bAuth: 'Author', cnt } } } },
    })}</script>`;
    const provider = new QidianBookDetailProvider({ get: jest.fn().mockResolvedValue(Buffer.from(html)) });

    await expect(provider.fetch('123')).resolves.toMatchObject({ wordCount: 123000 });
  });

  it('rejects SSR data without a non-empty title and author', async () => {
    const html = `<script id="vite-plugin-ssr_pageContext">${JSON.stringify({
      pageContext: { pageProps: { pageData: { bookInfo: { cnt: '12万字' } } } },
    })}</script>`;
    const provider = new QidianBookDetailProvider({ get: jest.fn().mockResolvedValue(Buffer.from(html)) });

    await expect(provider.fetch('123')).rejects.toThrow('Qidian SSR does not contain book details');
  });
});

describe('BookDetailsService', () => {
  const snapshot: BookDetailSnapshot = {
    bookId: '123', title: 'Test Book', author: 'Test Author', genres: [], description: null,
    bookStatus: null, wordCount: null, url: 'https://m.qidian.com/book/123/',
    sourceUrl: 'https://m.qidian.com/book/123/', fetchedAt: '2026-07-18T00:00:00.000Z',
    status: 'fresh',
  };

  it('fetches, persists, and reuses a fresh detail snapshot', async () => {
    const store = { read: jest.fn().mockResolvedValue(undefined), write: jest.fn() };
    const provider = { fetch: jest.fn().mockResolvedValue(snapshot) };
    const service = new BookDetailsService(store, provider, () => new Date('2026-07-18T00:05:00.000Z'));

    await expect(service.get('123')).resolves.toEqual(snapshot);
    await service.get('123');
    expect(provider.fetch).toHaveBeenCalledTimes(1);
    expect(store.write).toHaveBeenCalledWith(snapshot);
  });

  it('coalesces concurrent expired snapshot refreshes', async () => {
    let resolveFetch!: (value: BookDetailSnapshot) => void;
    const store = { read: jest.fn().mockResolvedValue({ ...snapshot, fetchedAt: '2026-07-18T00:00:00.000Z' }), write: jest.fn() };
    const provider = { fetch: jest.fn(() => new Promise<BookDetailSnapshot>((resolve) => { resolveFetch = resolve; })) };
    const service = new BookDetailsService(store, provider, () => new Date('2026-07-18T00:11:00.000Z'));

    const first = service.get('123');
    const second = service.get('123');
    await new Promise(setImmediate);
    resolveFetch(snapshot);
    await expect(Promise.all([first, second])).resolves.toEqual([snapshot, snapshot]);
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns a stale detail snapshot when a refresh fails', async () => {
    const store = { read: jest.fn().mockResolvedValue(snapshot), write: jest.fn() };
    const provider = { fetch: jest.fn().mockRejectedValue(new Error('source unavailable')) };
    const service = new BookDetailsService(store, provider, () => new Date('2026-07-18T00:11:00.000Z'));

    await expect(service.get('123')).resolves.toEqual({
      ...snapshot, status: 'stale', lastError: 'source unavailable',
    });
  });

  it('throws 502 when no detail snapshot exists and fetch fails', async () => {
    const store = { read: jest.fn().mockResolvedValue(undefined), write: jest.fn() };
    const provider = { fetch: jest.fn().mockRejectedValue(new Error('source unavailable')) };
    const service = new BookDetailsService(store, provider, () => new Date('2026-07-18T00:11:00.000Z'));

    await expect(service.get('123')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('propagates snapshot write failures instead of returning stale data', async () => {
    const store = { read: jest.fn().mockResolvedValue(snapshot), write: jest.fn().mockRejectedValue(new Error('disk full')) };
    const provider = { fetch: jest.fn().mockResolvedValue(snapshot) };
    const service = new BookDetailsService(store, provider, () => new Date('2026-07-18T00:11:00.000Z'));

    await expect(service.get('123')).rejects.toThrow('disk full');
  });

  it('allows a retry after a failed pending fetch', async () => {
    const store = { read: jest.fn().mockResolvedValue(undefined), write: jest.fn() };
    const provider = { fetch: jest.fn().mockRejectedValueOnce(new Error('source unavailable')).mockResolvedValueOnce(snapshot) };
    const service = new BookDetailsService(store, provider, () => new Date('2026-07-18T00:11:00.000Z'));

    await expect(service.get('123')).rejects.toBeInstanceOf(BadGatewayException);
    await expect(service.get('123')).resolves.toEqual(snapshot);
    expect(provider.fetch).toHaveBeenCalledTimes(2);
  });

  it('forces a refresh even for a fresh snapshot', async () => {
    const store = { read: jest.fn().mockResolvedValue(snapshot), write: jest.fn() };
    const refreshed = { ...snapshot, title: 'Updated Book' };
    const provider = { fetch: jest.fn().mockResolvedValue(refreshed) };
    const service = new BookDetailsService(store, provider, () => new Date('2026-07-18T00:05:00.000Z'));

    await expect(service.refresh('123')).resolves.toEqual(refreshed);
    expect(provider.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('BookDetailStoreService', () => {
  let snapshotDir: string;
  let store: BookDetailStoreService;
  const snapshot: BookDetailSnapshot = {
    bookId: '123', title: 'Test Book', author: 'Test Author', genres: [], description: null,
    bookStatus: null, wordCount: 123000, url: 'https://m.qidian.com/book/123/',
    sourceUrl: 'https://m.qidian.com/book/123/', fetchedAt: '2026-07-18T00:00:00.000Z', status: 'fresh',
  };

  beforeEach(async () => {
    snapshotDir = await mkdtemp(join(tmpdir(), 'book-detail-snapshots-'));
    store = new BookDetailStoreService(snapshotDir);
  });

  afterEach(async () => rm(snapshotDir, { recursive: true, force: true }));

  it('reads a persisted book detail snapshot', async () => {
    await store.write(snapshot);
    await expect(store.read('123')).resolves.toEqual(snapshot);
  });

  it('atomically replaces a prior snapshot for the same book', async () => {
    await store.write(snapshot);
    const replacement = { ...snapshot, title: 'Updated Book' };
    await store.write(replacement);

    await expect(store.read('123')).resolves.toEqual(replacement);
  });
});
