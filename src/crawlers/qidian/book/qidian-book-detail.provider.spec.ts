import { QidianBookDetailProvider } from './qidian-book-detail.provider';
import { SourceParseError } from '../rank/qidian.provider';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('QidianBookDetailProvider', () => {
  it('parses the book detail fixture and normalizes HTML description to text', async () => {
    const provider = new QidianBookDetailProvider({ getResponse: jest.fn().mockResolvedValue({ body: Buffer.from('<h1><em>Title</em></h1><p class="writer"><a>Author</a></p><div class="book-intro"><p>First<br>Second <strong>line</strong></p></div>'), finalUrl: 'https://www.qidian.com/book/123/' }) });

    await expect(provider.fetch('123')).resolves.toMatchObject({ description: 'First\nSecond line' });
  });

  it('parses the captured Qidian detail fixture into the public detail fields', async () => {
    const html = await readFile(join(process.cwd(), 'test', 'fixtures', 'qidian-book-detail.html'), 'utf8');
    const provider = new QidianBookDetailProvider({ getResponse: jest.fn().mockResolvedValue({ body: Buffer.from(html), finalUrl: 'https://www.qidian.com/book/123/' }) });

    await expect(provider.fetch('123')).resolves.toMatchObject({
      bookId: '123', title: 'Test Book', author: 'Test Author', description: 'A test description',
      wordCount: 123000, sourceUrl: 'https://www.qidian.com/book/123/',
    });
  });

  it('rejects common captcha and anti-bot pages before parsing details', async () => {
    const provider = new QidianBookDetailProvider({ getResponse: jest.fn().mockResolvedValue({ body: Buffer.from('<title>安全验证</title><p>验证码</p>'), finalUrl: 'https://www.qidian.com/book/123/' }) });

    await expect(provider.fetch('123')).rejects.toBeInstanceOf(SourceParseError);
  });
});
