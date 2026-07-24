import type {
  BookCrawler,
  CrawledBook,
  CrawledRanking,
  RankingCrawler,
} from "./index";

describe("crawler contracts", () => {
  it("represents a platform ranking without persistence or HTTP fields", async () => {
    const ranking: CrawledRanking = {
      platform: "qidian",
      rankTypeKey: "yuepiao",
      rankType: "月票榜",
      sourceUrl: "https://www.qidian.com/rank/yuepiao/",
      fetchedAt: new Date("2026-07-20T12:00:00.000Z"),
      items: [
        {
          rank: 1,
          externalBookId: "1031940621",
          title: "示例小说",
          author: "示例作者",
          coverUrl: null,
          sourceUrl: "https://www.qidian.com/book/1031940621/",
          metrics: { monthlyTickets: 1234, badges: ["new", null] },
        },
      ],
    };
    const crawler: RankingCrawler = {
      crawl: async (rankTypeKey) => ({ ...ranking, rankTypeKey }),
    };

    await expect(crawler.crawl("yuepiao")).resolves.toEqual(ranking);
  });

  it("represents a crawled book using an external platform identifier", async () => {
    const book: CrawledBook = {
      platform: "qidian",
      externalBookId: "1031940621",
      title: "示例小说",
      author: "示例作者",
      description: null,
      coverUrl: null,
      genres: ["玄幻"],
      bookStatus: "连载",
      wordCount: 123_000,
      metadata: { labels: ["VIP"], editorRecommended: true },
      sourceUrl: "https://www.qidian.com/book/1031940621/",
      fetchedAt: new Date("2026-07-20T12:00:00.000Z"),
    };
    const crawler: BookCrawler = {
      crawl: async (externalBookId) => ({ ...book, externalBookId }),
    };

    await expect(crawler.crawl("1031940621")).resolves.toEqual(book);
  });
});
