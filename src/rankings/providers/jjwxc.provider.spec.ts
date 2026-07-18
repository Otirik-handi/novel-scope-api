import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { RefreshScheduleConfigService } from '../refresh-schedule-config.service';
import { JjwxcProvider } from './jjwxc.provider';

describe('JjwxcProvider', () => {
  const key = { platform: 'jjwxc' as const, rank: 'income', channel: '0' };

  it('combines rank entries with GB18030 detail metrics', async () => {
    const rankHtml = await fixture('jjwxc-topten.html');
    const detailHtml = await fixture('jjwxc-onebook.html');
    const request = jest
      .fn()
      .mockResolvedValueOnce(iconv.encode(rankHtml, 'gb18030'))
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
      .mockResolvedValueOnce(iconv.encode(await fixture('jjwxc-topten.html'), 'gb18030'))
      .mockRejectedValueOnce(new Error('network failed'));
    const provider = new JjwxcProvider({ get: request });

    const snapshot = await provider.fetch(key);

    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.items[0].wordCount).toBeNull();
    expect(snapshot.items[0].status).toBeNull();
  });

  it('limits concurrent detail requests to the configured maximum', async () => {
    let active = 0;
    let maximumActive = 0;
    const rankHtml = `
      <table>
        <tr><td><a href="onebook.php?novelid=1">作品一</a></td></tr>
        <tr><td><a href="onebook.php?novelid=2">作品二</a></td></tr>
        <tr><td><a href="onebook.php?novelid=3">作品三</a></td></tr>
      </table>`;
    const request = {
      get: jest.fn(async (url: string) => {
        if (url.includes('topten.php')) {
          return iconv.encode(rankHtml, 'gb18030');
        }

        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return iconv.encode('<span itemprop="wordCount">1</span>', 'gb18030');
      }),
    };
    const config = {
      get: jest.fn().mockReturnValue({ jjwxcDetailConcurrency: 2 }),
    } as unknown as RefreshScheduleConfigService;
    const provider = new JjwxcProvider(request, config);

    const snapshot = await provider.fetch(key);

    expect(snapshot.items).toHaveLength(3);
    expect(maximumActive).toBe(2);
  });

  it.each(['unknown', 'toString'])('rejects %s before requesting a page', async (rank) => {
    const request = jest.fn();
    const provider = new JjwxcProvider({ get: request });

    await expect(provider.fetch({ ...key, rank })).rejects.toThrow('Unsupported JJWXC rank');
    expect(request).not.toHaveBeenCalled();
  });
});

function fixture(name: string): Promise<string> {
  return readFile(join(process.cwd(), 'test', 'fixtures', name), 'utf8');
}
