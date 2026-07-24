import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { QidianPage } from "../qidian.client";
import { QidianRankingCrawler } from "./qidian-ranking.crawler";

const FETCHED_AT = new Date("2026-07-20T12:00:00.000Z");

function fixture(name: string): string {
  return readFileSync(
    join(process.cwd(), "test", "fixtures", "qidian", name),
    "utf8",
  );
}

describe("QidianRankingCrawler", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("fetches the selected ranking path and parses the returned page", async () => {
    jest.useFakeTimers().setSystemTime(FETCHED_AT);
    const page: QidianPage = {
      html: fixture("ranking-yuepiao.html"),
      sourceUrl: "https://www.qidian.com/rank/yuepiao/?ref=redirect",
    };
    const fetchPage = jest.fn<Promise<QidianPage>, [string]>();
    fetchPage.mockResolvedValue(page);
    const crawler = new QidianRankingCrawler({ fetchPage });

    const result = await crawler.crawl("yuepiao");

    expect(fetchPage).toHaveBeenCalledWith("/rank/yuepiao/");
    expect(result).toMatchObject({
      platform: "qidian",
      rankTypeKey: "yuepiao",
      rankType: "月票榜",
      sourceUrl: page.sourceUrl,
      fetchedAt: FETCHED_AT,
    });
    expect(result.items).toHaveLength(10);
  });

  it("rejects a Fanqie ranking key before fetching a page", async () => {
    const fetchPage = jest.fn<Promise<QidianPage>, [string]>();
    const crawler = new QidianRankingCrawler({ fetchPage });

    await expect(crawler.crawl("0_1_1139")).rejects.toThrow(
      "Unknown Qidian ranking key",
    );
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("rejects a final URL for a different Qidian ranking", async () => {
    const page: QidianPage = {
      html: fixture("ranking-hotsales.html"),
      sourceUrl: "https://www.qidian.com/rank/hotsales/?from=redirect",
    };
    const fetchPage = jest.fn<Promise<QidianPage>, [string]>();
    fetchPage.mockResolvedValue(page);
    const crawler = new QidianRankingCrawler({ fetchPage });

    await expect(crawler.crawl("yuepiao")).rejects.toThrow(
      "Qidian ranking final URL does not match requested rank type",
    );
  });

  it.each([
    "https://example.com/rank/yuepiao/",
    "https://reader:secret@www.qidian.com/rank/yuepiao/",
  ])("rejects an untrusted ranking final URL: %s", async (sourceUrl) => {
    const page: QidianPage = {
      html: fixture("ranking-yuepiao.html"),
      sourceUrl,
    };
    const fetchPage = jest.fn<Promise<QidianPage>, [string]>();
    fetchPage.mockResolvedValue(page);
    const crawler = new QidianRankingCrawler({ fetchPage });

    await expect(crawler.crawl("yuepiao")).rejects.toThrow(
      "Qidian ranking final URL does not match requested rank type",
    );
  });
});
