import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QidianBookParser } from "./qidian-book.parser";

const FETCHED_AT = new Date("2026-07-20T12:00:00.000Z");

function fixture(name: string): string {
  return readFileSync(
    join(process.cwd(), "test", "fixtures", "qidian", name),
    "utf8",
  );
}

describe("QidianBookParser", () => {
  const parser = new QidianBookParser();

  it("prefers complete embedded JSON and normalizes the description", () => {
    const sourceUrl = "https://www.qidian.com/book/3100000001/";

    const result = parser.parse({
      html: fixture("book-embedded-json.html"),
      sourceUrl,
      fetchedAt: FETCHED_AT,
    });

    expect(result).toEqual({
      platform: "qidian",
      externalBookId: "3100000001",
      title: "内嵌数据小说",
      author: "内嵌数据作者",
      description: "第一段 内容\n第二段\n续行",
      coverUrl: "https://bookcover.yuewen.com/qdbimg/349573/3100000001/300",
      genres: ["玄幻", "东方玄幻"],
      bookStatus: "连载",
      wordCount: 1_234_000,
      metadata: { monthlyTickets: 4321, rating: 9.2 },
      sourceUrl,
      fetchedAt: FETCHED_AT,
    });
  });

  it("falls back to the book DOM when embedded JSON is unavailable", () => {
    const sourceUrl = "https://www.qidian.com/book/3200000001/";

    const result = parser.parse({
      html: fixture("book-dom-fallback.html"),
      sourceUrl,
      fetchedAt: FETCHED_AT,
    });

    expect(result).toEqual({
      platform: "qidian",
      externalBookId: "3200000001",
      title: "DOM 后备小说",
      author: "DOM 后备作者",
      description: "DOM 简介第一段\n第二段强调内容",
      coverUrl: "https://bookcover.yuewen.com/qdbimg/349573/3200000001/300",
      genres: ["科幻", "星际文明"],
      bookStatus: "完结",
      wordCount: 987_654,
      metadata: {},
      sourceUrl,
      fetchedAt: FETCHED_AT,
    });
  });

  it("accepts a detail with all optional fields absent", () => {
    const sourceUrl = "https://www.qidian.com/book/3300000001/";

    const result = parser.parse({
      html: fixture("book-optional-fields-missing.html"),
      sourceUrl,
      fetchedAt: FETCHED_AT,
    });

    expect(result).toEqual({
      platform: "qidian",
      externalBookId: "3300000001",
      title: "只有必需字段",
      author: "必需字段作者",
      description: null,
      coverUrl: null,
      genres: [],
      bookStatus: null,
      wordCount: null,
      metadata: {},
      sourceUrl,
      fetchedAt: FETCHED_AT,
    });
  });

  it("rejects a detail when a required field is absent", () => {
    expect(() =>
      parser.parse({
        html: fixture("book-required-field-missing.html"),
        sourceUrl: "https://www.qidian.com/book/3400000001/",
        fetchedAt: FETCHED_AT,
      }),
    ).toThrow("Qidian book is missing required fields");
  });

  it("bounds traversal when embedded JSON contains a large unrelated array", () => {
    const sourceUrl = "https://www.qidian.com/book/3500000001/";
    const json = JSON.stringify({
      book: {
        bookId: "3500000001",
        title: "大数组页面",
        author: "边界作者",
      },
      unrelated: Array.from({ length: 150_000 }, () => null),
    });

    expect(
      parser.parse({
        html: `<script id="book-detail-data" type="application/json">${json}</script>`,
        sourceUrl,
        fetchedAt: FETCHED_AT,
      }),
    ).toMatchObject({
      externalBookId: "3500000001",
      title: "大数组页面",
      author: "边界作者",
    });
  });

  it("drops excessively deep optional metadata without overflowing", () => {
    const sourceUrl = "https://www.qidian.com/book/3600000001/";
    const deeplyNestedMetadata = `${'{"nested":'.repeat(5_000)}null${"}".repeat(5_000)}`;
    const json = `{"book":{"bookId":"3600000001","title":"深层元数据页面","author":"边界作者","metadata":${deeplyNestedMetadata}}}`;

    expect(
      parser.parse({
        html: `<script id="book-detail-data" type="application/json">${json}</script>`,
        sourceUrl,
        fetchedAt: FETCHED_AT,
      }),
    ).toMatchObject({
      externalBookId: "3600000001",
      metadata: {},
    });
  });
});
