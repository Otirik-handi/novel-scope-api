import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { QidianPage } from "../qidian.client";
import { QidianBookCrawler } from "./qidian-book.crawler";

const FETCHED_AT = new Date("2026-07-20T12:00:00.000Z");

function fixture(name: string): string {
  return readFileSync(
    join(process.cwd(), "test", "fixtures", "qidian", name),
    "utf8",
  );
}

describe("QidianBookCrawler", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("fetches the requested book path and parses the returned page", async () => {
    jest.useFakeTimers().setSystemTime(FETCHED_AT);
    const page: QidianPage = {
      html: fixture("book-embedded-json.html"),
      sourceUrl: "https://www.qidian.com/book/3100000001/",
    };
    const fetchPage = jest.fn<Promise<QidianPage>, [string]>();
    fetchPage.mockResolvedValue(page);
    const crawler = new QidianBookCrawler({ fetchPage });

    const result = await crawler.crawl("3100000001");

    expect(fetchPage).toHaveBeenCalledWith("/book/3100000001/");
    expect(result).toMatchObject({
      platform: "qidian",
      externalBookId: "3100000001",
      sourceUrl: page.sourceUrl,
      fetchedAt: FETCHED_AT,
    });
  });

  it("rejects a final URL for a different Qidian book", async () => {
    const page: QidianPage = {
      html: `
        <script id="book-detail-data" type="application/json">
          {"book":{"bookId":"3100000002","title":"另一作品","author":"另一作者"}}
        </script>
      `,
      sourceUrl: "https://www.qidian.com/book/3100000002/?from=redirect",
    };
    const fetchPage = jest.fn<Promise<QidianPage>, [string]>();
    fetchPage.mockResolvedValue(page);
    const crawler = new QidianBookCrawler({ fetchPage });

    await expect(crawler.crawl("3100000001")).rejects.toThrow(
      "Qidian book final URL does not match requested book ID",
    );
  });

  it("rejects a chapter final URL for the requested Qidian book", async () => {
    const page: QidianPage = {
      html: fixture("book-embedded-json.html"),
      sourceUrl: "https://www.qidian.com/book/3100000001/chapter/99",
    };
    const fetchPage = jest.fn<Promise<QidianPage>, [string]>();
    fetchPage.mockResolvedValue(page);
    const crawler = new QidianBookCrawler({ fetchPage });

    await expect(crawler.crawl("3100000001")).rejects.toThrow(
      "Qidian book final URL does not match requested book ID",
    );
  });

  it.each([
    "https://example.com/book/3100000001/",
    "https://reader:secret@www.qidian.com/book/3100000001/",
  ])("rejects an untrusted book final URL: %s", async (sourceUrl) => {
    const page: QidianPage = {
      html: fixture("book-embedded-json.html"),
      sourceUrl,
    };
    const fetchPage = jest.fn<Promise<QidianPage>, [string]>();
    fetchPage.mockResolvedValue(page);
    const crawler = new QidianBookCrawler({ fetchPage });

    await expect(crawler.crawl("3100000001")).rejects.toThrow(
      "Qidian book final URL does not match requested book ID",
    );
  });

  it.each(["", " 3100000001", "3100000001/chapters", "abc"])(
    "rejects an invalid Qidian book ID before requesting it: %j",
    async (externalBookId) => {
      const fetchPage = jest.fn<Promise<QidianPage>, [string]>();
      const crawler = new QidianBookCrawler({ fetchPage });

      await expect(crawler.crawl(externalBookId)).rejects.toThrow(
        "Invalid Qidian book ID",
      );
      expect(fetchPage).not.toHaveBeenCalled();
    },
  );
});
