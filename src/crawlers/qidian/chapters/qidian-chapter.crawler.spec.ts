import { QidianChapterCrawler } from "./qidian-chapter.crawler";
import { QidianChapterCrawlerError } from "./qidian-chapter.error";

describe("QidianChapterCrawler", () => {
  it("rejects invalid chapter ids before fetching", async () => {
    const client = { fetchPage: jest.fn() };
    const crawler = new QidianChapterCrawler(
      client as never,
    );

    await expect(
      crawler.fetchChapter("1", "../evil"),
    ).rejects.toMatchObject({ code: "QIDIAN_RANGE_INVALID" });
    expect(client.fetchPage).not.toHaveBeenCalled();
  });

  it("passes the requested book id to the catalog parser", async () => {
    const client = {
      fetchPage: jest.fn().mockResolvedValue({
        html: "<html></html>",
        sourceUrl: "https://www.qidian.com/book/1/",
      }),
    };
    const bookParser = {
      parse: jest.fn().mockReturnValue({
        title: "Title",
        author: "Author",
      }),
    };
    const catalogParser = {
      parse: jest.fn().mockReturnValue([]),
    };
    const chapterParser = { parse: jest.fn() };
    const crawler = new QidianChapterCrawler(
      client as never,
      bookParser as never,
      catalogParser as never,
      chapterParser as never,
    );

    await crawler.fetchCatalog("1");

    expect(catalogParser.parse).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: "1" }),
    );
  });

  it("prefers catalog parse failures over generic book parse errors", async () => {
    const client = {
      fetchPage: jest.fn().mockResolvedValue({
        html: "<html></html>",
        sourceUrl: "https://www.qidian.com/book/1/",
      }),
    };
    const bookParser = {
      parse: jest.fn().mockImplementation(() => {
        throw new Error("generic book parse failure");
      }),
    };
    const catalogParser = {
      parse: jest.fn().mockImplementation(() => {
        throw new QidianChapterCrawlerError(
          "QIDIAN_CATALOG_PARSE_FAILED",
          "invalid catalog",
        );
      }),
    };
    const crawler = new QidianChapterCrawler(
      client as never,
      bookParser as never,
      catalogParser as never,
      { parse: jest.fn() } as never,
    );

    await expect(crawler.fetchCatalog("1")).rejects.toMatchObject({
      code: "QIDIAN_CATALOG_PARSE_FAILED",
    });
    expect(bookParser.parse).not.toHaveBeenCalled();
  });

  it("forwards the abort signal when fetching a catalog", async () => {
    const client = {
      fetchPage: jest.fn().mockResolvedValue({
        html: "<html></html>",
        sourceUrl: "https://www.qidian.com/book/1/",
      }),
    };
    const bookParser = {
      parse: jest.fn().mockReturnValue({ title: "Title", author: "Author" }),
    };
    const catalogParser = { parse: jest.fn().mockReturnValue([]) };
    const crawler = new QidianChapterCrawler(
      client as never,
      bookParser as never,
      catalogParser as never,
      { parse: jest.fn() } as never,
    );
    const signal = new AbortController().signal;

    await crawler.fetchCatalog("1", signal);

    expect(client.fetchPage).toHaveBeenCalledWith("/book/1/", signal);
  });

  it("forwards the abort signal when fetching a chapter", async () => {
    const client = {
      fetchPage: jest.fn().mockResolvedValue({
        html: "<html></html>",
        sourceUrl: "https://www.qidian.com/chapter/1/2/",
      }),
    };
    const chapterParser = { parse: jest.fn().mockReturnValue({}) };
    const crawler = new QidianChapterCrawler(
      client as never,
      { parse: jest.fn() } as never,
      { parse: jest.fn() } as never,
      chapterParser as never,
    );
    const signal = new AbortController().signal;

    await crawler.fetchChapter("1", "2", signal);

    expect(client.fetchPage).toHaveBeenCalledWith("/chapter/1/2/", signal);
  });
});
