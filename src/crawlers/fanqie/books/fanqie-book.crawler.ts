import type { BookCrawler, CrawledBook } from "../../interfaces";
import type { FanqieBrowserClient } from "../fanqie-browser.client";
import { FanqieBookParser } from "./fanqie-book.parser";

export class FanqieBookCrawlerError extends Error {
  override readonly name = "FanqieBookCrawlerError";
}

export class FanqieBookCrawler implements BookCrawler {
  constructor(
    private readonly client: Pick<FanqieBrowserClient, "fetchBook">,
    private readonly parser = new FanqieBookParser(),
  ) {}

  async crawl(externalBookId: string): Promise<CrawledBook> {
    if (!/^\d+$/.test(externalBookId)) {
      throw new FanqieBookCrawlerError("Invalid Fanqie book ID");
    }

    const page = await this.client.fetchBook(externalBookId);
    return this.parser.parse({ ...page, externalBookId });
  }
}
