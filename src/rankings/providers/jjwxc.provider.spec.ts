import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { JjwxcProvider } from './jjwxc.provider';

describe('JjwxcProvider', () => {
  const key = { platform: 'jjwxc' as const, rank: 'income', channel: '0' };

  it('combines rank entries with GB18030 detail metrics', async () => {
    const rankHtml = await fixture('jjwxc-topten.html');
    const detailHtml = await fixture('jjwxc-onebook.html');
    const request = jest
      .fn()
      .mockResolvedValueOnce(Buffer.from(rankHtml))
      .mockResolvedValueOnce(iconv.encode(detailHtml, 'gb18030'));
    const provider = new JjwxcProvider({ get: request });

    const snapshot = await provider.fetch(key);

    expect(snapshot.sourceUrl).toContain('orderstr=12&t=0');
    expect(snapshot.items[0]).toMatchObject({
      rank: 1,
      bookId: '42',
      title: '测试小说',
      author: '测试作者',
      wordCount: 12345,
      status: '连载',
    });
    expect(snapshot.items[0].metrics).toEqual(
      expect.objectContaining({
        collectedCount: 100,
        nutritionCount: 20,
        scoreCount: 300,
        reviewCount: 40,
      }),
    );
  });

  it('keeps ranking entries when a detail request fails', async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce(Buffer.from(await fixture('jjwxc-topten.html')))
      .mockRejectedValueOnce(new Error('network failed'));
    const provider = new JjwxcProvider({ get: request });

    const snapshot = await provider.fetch(key);

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].wordCount).toBeNull();
    expect(snapshot.items[0].status).toBeNull();
  });

  it('rejects unsupported ranks before requesting a page', async () => {
    const request = jest.fn();
    const provider = new JjwxcProvider({ get: request });

    await expect(provider.fetch({ ...key, rank: 'unknown' })).rejects.toThrow(
      'Unsupported JJWXC rank',
    );
    expect(request).not.toHaveBeenCalled();
  });
});

function fixture(name: string): Promise<string> {
  return readFile(join(process.cwd(), 'test', 'fixtures', name), 'utf8');
}
