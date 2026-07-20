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

  it("uses the authoritative bookInfo instead of an earlier recommendation", () => {
    const sourceUrl = "https://www.qidian.com/book/3700000001/";

    const result = parser.parse({
      html: fixture("book-authoritative-json.html"),
      sourceUrl,
      fetchedAt: FETCHED_AT,
    });

    expect(result).toMatchObject({
      externalBookId: "3700000001",
      title: "权威详情标题",
      author: "权威详情作者",
      description: "权威详情简介",
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

  it.each(["chapter/99", "anything"])(
    "rejects a detail URL with an extra pathname segment: %s",
    (suffix) => {
      expect(() =>
        parser.parse({
          html: fixture("book-optional-fields-missing.html"),
          sourceUrl: `https://www.qidian.com/book/3300000001/${suffix}`,
          fetchedAt: FETCHED_AT,
        }),
      ).toThrow("Qidian book is missing required fields");
    },
  );

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

  it.each<[number, number | null]>([
    [0, 0],
    [2_147_483_647, 2_147_483_647],
    [1.5, null],
    [-1, null],
    [2_147_483_648, null],
  ])("maps wordCount %s to %s within the Prisma Int range", (value, expected) => {
    const json = JSON.stringify({
      book: {
        bookId: "3800000001",
        title: "字数边界小说",
        author: "字数边界作者",
        wordCount: value,
      },
    });

    const result = parser.parse({
      html: `<script id="book-detail-data" type="application/json">${json}</script>`,
      sourceUrl: "https://www.qidian.com/book/3800000001/",
      fetchedAt: FETCHED_AT,
    });

    expect(result.wordCount).toBe(expected);
  });

  it("reads deeply nested book DOM text without recursive overflow", () => {
    const depth = 5_000;
    const deepTitle = `${"<span>".repeat(depth)}深层 DOM 小说${"</span>".repeat(depth)}`;
    const deepDescription = `${"<span>".repeat(depth)}深层简介${"</span>".repeat(depth)}`;

    const result = parser.parse({
      html: `
        <section class="book-information" data-book-id="3900000001">
          <h1><em>${deepTitle}</em></h1>
          <a class="writer">深层作者</a>
        </section>
        <div class="book-intro"><p>第一段</p><p>${deepDescription}</p></div>
      `,
      sourceUrl: "https://www.qidian.com/book/3900000001/",
      fetchedAt: FETCHED_AT,
    });

    expect(result).toMatchObject({
      title: "深层 DOM 小说",
      author: "深层作者",
      description: "第一段\n深层简介",
    });
  });

  it("fails closed when book DOM text exceeds the depth budget", () => {
    const depth = 9_000;
    const deepTitle = `${"<span>".repeat(depth)}超限标题${"</span>".repeat(depth)}`;

    expect(() =>
      parser.parse({
        html: `
          <section class="book-information" data-book-id="4000000001">
            <h1><em>${deepTitle}</em></h1>
            <a class="writer">超限作者</a>
          </section>
        `,
        sourceUrl: "https://www.qidian.com/book/4000000001/",
        fetchedAt: FETCHED_AT,
      }),
    ).toThrow("Qidian book is missing required fields");
  });
});
