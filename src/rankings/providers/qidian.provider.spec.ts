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
    const request = jest.fn().mockResolvedValue(new Response(html));
    const provider = new QidianProvider(request);

    const snapshot = await provider.fetch(key);

    expect(request).toHaveBeenCalledWith('https://m.qidian.com/rank/hotsales/');
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
      jest.fn().mockResolvedValue(new Response('<html></html>')),
    );

    await expect(provider.fetch(key)).rejects.toBeInstanceOf(SourceParseError);
  });

  it('rejects unsupported ranks before requesting a page', async () => {
    const request = jest.fn();
    const provider = new QidianProvider(request);

    await expect(provider.fetch({ ...key, rank: 'unknown' })).rejects.toThrow(
      'Unsupported Qidian rank',
    );
    expect(request).not.toHaveBeenCalled();
  });
});
