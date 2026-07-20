import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { QidianProvider, SourceParseError } from './qidian.provider';

describe('QidianProvider', () => {
  const ranks = ['yuepiao', 'hotsales', 'recom', 'collect'] as const;

  it.each(ranks)('parses the %s PC ranking sample into exactly ten ordered books', async (rank) => {
    const html = await readFile(join(process.cwd(), 'test', 'fixtures', `qidian-${rank}-pc.html`), 'utf8');
    const request = {
      getResponse: jest.fn().mockResolvedValue({ body: Buffer.from(html), finalUrl: `https://www.qidian.com/rank/${rank}/?page=1` }),
    };
    const provider = new QidianProvider(request);

    const snapshot = await provider.fetch({ platform: 'qidian', rank, channel: null });

    expect(request.getResponse).toHaveBeenCalledWith(`https://www.qidian.com/rank/${rank}/`);
    expect(snapshot.sourceUrl).toBe(`https://www.qidian.com/rank/${rank}/?page=1`);
    expect(snapshot.items).toHaveLength(10);
    expect(snapshot.items.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(snapshot.items[0]).toMatchObject({
      bookId: '1001', title: 'Book 1', author: 'Author 1', url: 'https://www.qidian.com/book/1001/',
    });
  });

  it('rejects a PC page with duplicate book identifiers', async () => {
    const html = await readFile(join(process.cwd(), 'test', 'fixtures', 'qidian-hotsales-pc.html'), 'utf8');
    const provider = new QidianProvider({
      getResponse: jest.fn().mockResolvedValue({ body: Buffer.from(html.replace('/book/1010/', '/book/1001/')), finalUrl: 'https://www.qidian.com/rank/hotsales/' }),
    });

    await expect(provider.fetch({ platform: 'qidian', rank: 'hotsales', channel: null }))
      .rejects.toBeInstanceOf(SourceParseError);
  });

  it('rejects a PC page with fewer than ten entries', async () => {
    const provider = new QidianProvider({
      getResponse: jest.fn().mockResolvedValue({ body: Buffer.from('<div class="book-img-text"><ul><li>bad</li></ul></div>'), finalUrl: 'https://www.qidian.com/rank/hotsales/' }),
    });

    await expect(provider.fetch({ platform: 'qidian', rank: 'hotsales', channel: null }))
      .rejects.toBeInstanceOf(SourceParseError);
  });

  it.each(['signnewbook', 'newbook', 'sanjiang'])('rejects unsupported rank %s before requesting a page', async (rank) => {
    const request = { getResponse: jest.fn() };
    const provider = new QidianProvider(request);

    await expect(provider.fetch({ platform: 'qidian', rank, channel: null })).rejects.toThrow('Unsupported Qidian rank');
    expect(request.getResponse).not.toHaveBeenCalled();
  });
});
