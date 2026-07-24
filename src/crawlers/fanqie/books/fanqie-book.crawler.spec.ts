import type { CrawledBook } from "../../interfaces";
import type { FanqieBrowserClient } from "../fanqie-browser.client";
import {
  FanqieBookCrawler,
  FanqieBookCrawlerError,
} from "./fanqie-book.crawler";
import type { FanqieBookParser } from "./fanqie-book.parser";

describe("FanqieBookCrawler", () => {
  const page = {
    html: "<html></html>",
    sourceUrl: "https://fanqienovel.com/page/7001",
    fetchedAt: new Date("2026-07-24T00:31:00.000Z"),
  };

  function createSubject() {
    const client = { fetchBook: jest.fn().mockResolvedValue(page) };
    const book = { platform: "fanqie" } as CrawledBook;
    const parser = { parse: jest.fn().mockReturnValue(book) };
    const crawler = new FanqieBookCrawler(
      client as unknown as Pick<FanqieBrowserClient, "fetchBook">,
      parser as unknown as FanqieBookParser,
    );
    return { crawler, client, parser, book };
  }

  it.each(["", "abc", "12-34", " 7001"])(
    "rejects invalid book ID %p before opening the browser",
    async (bookId) => {
      const { crawler, client } = createSubject();

      await expect(crawler.crawl(bookId)).rejects.toBeInstanceOf(
        FanqieBookCrawlerError,
      );
      expect(client.fetchBook).not.toHaveBeenCalled();
    },
  );

  it("passes the same requested book ID through the client and parser", async () => {
    const { crawler, client, parser, book } = createSubject();

    await expect(crawler.crawl("7001")).resolves.toBe(book);
    expect(client.fetchBook).toHaveBeenCalledWith("7001");
    expect(parser.parse).toHaveBeenCalledWith({ ...page, externalBookId: "7001" });
  });
});
