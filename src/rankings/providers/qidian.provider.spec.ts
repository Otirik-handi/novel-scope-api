import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { QidianProvider, SourceParseError } from './qidian.provider';

describe('QidianProvider', () => {
  const key = { platform: 'qidian' as const, rank: 'hotsales', channel: null };

  it('normalizes SSR page records', async () => {
    const html = await readFile(
      join(process.cwd(), 'test', 'fixtures', 'qidian-hotsales.html'),
      'utf8',
    );
    const request = { get: jest.fn().mockResolvedValue(Buffer.from(html)) };
    const provider = new QidianProvider(request);

    const snapshot = await provider.fetch(key);

    expect(request.get).toHaveBeenCalledWith('https://m.qidian.com/rank/hotsales/');
    expect(snapshot.items[0]).toMatchObject({
      rank: 1,
      bookId: '123',
      title: '测试作品',
      author: '测试作者',
      genres: ['玄幻', '东方玄幻'],
      wordCount: 123000,
      url: 'https://m.qidian.com/book/123/',
    });
  });

  it('rejects pages without SSR ranking data', async () => {
    const provider = new QidianProvider(
      { get: jest.fn().mockResolvedValue(Buffer.from('<html></html>')) },
    );

    await expect(provider.fetch(key)).rejects.toBeInstanceOf(SourceParseError);
  });

  it.each([
    ['signnewbook', '/rank/sign/'],
    ['newsign', '/rank/sign/'],
    ['pubnewbook', '/rank/newbook/'],
    ['collect', '/rank/newfans/'],
  ])('supports %s through %s', async (rank, path) => {
    const html = await readFile(
      join(process.cwd(), 'test', 'fixtures', 'qidian-hotsales.html'),
      'utf8',
    );
    const request = { get: jest.fn().mockResolvedValue(Buffer.from(html)) };
    const provider = new QidianProvider(request);

    await provider.fetch({ platform: 'qidian', rank, channel: null });

    expect(request.get).toHaveBeenCalledWith(`https://m.qidian.com${path}`);
  });

  it.each(['unknown', 'toString'])('rejects %s before requesting a page', async (rank) => {
    const request = { get: jest.fn() };
    const provider = new QidianProvider(request);

    await expect(provider.fetch({ ...key, rank })).rejects.toThrow('Unsupported Qidian rank');
    expect(request.get).not.toHaveBeenCalled();
  });
});
