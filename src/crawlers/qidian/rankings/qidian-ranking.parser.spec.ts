import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CrawledRankingItem, RankType } from "../../interfaces";
import { QidianRankingParser } from "./qidian-ranking.parser";

const FETCHED_AT = new Date("2026-07-20T12:00:00.000Z");

function fixture(name: string): string {
  return readFileSync(
    join(process.cwd(), "test", "fixtures", "qidian", name),
    "utf8",
  );
}

describe("QidianRankingParser", () => {
  const parser = new QidianRankingParser();

  it.each<{
    rankType: RankType;
    fixtureName: string;
    metricName: string;
    firstBookId: string;
  }>([
    {
      rankType: "yuepiao",
      fixtureName: "ranking-yuepiao.html",
      metricName: "monthlyTickets",
      firstBookId: "1100000001",
    },
    {
      rankType: "hotsales",
      fixtureName: "ranking-hotsales.html",
      metricName: "sales",
      firstBookId: "1200000001",
    },
    {
      rankType: "recom",
      fixtureName: "ranking-recom.html",
      metricName: "recommendations",
      firstBookId: "1300000001",
    },
    {
      rankType: "collect",
      fixtureName: "ranking-collect.html",
      metricName: "collections",
      firstBookId: "1400000001",
    },
  ])(
    "parses the $rankType Top 10 fixture",
    ({ rankType, fixtureName, metricName, firstBookId }) => {
      const sourceUrl = `https://www.qidian.com/rank/${rankType}/`;

      const result = parser.parse({
        html: fixture(fixtureName),
        rankType,
        sourceUrl,
        fetchedAt: FETCHED_AT,
      });

      expect(result).toMatchObject({
        platform: "qidian",
        rankType,
        sourceUrl,
        fetchedAt: FETCHED_AT,
      });
      expect(result.items).toHaveLength(10);
      expect(result.items.map((item: CrawledRankingItem) => item.rank)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      expect(
        new Set(
          result.items.map(
            (item: CrawledRankingItem) => item.externalBookId,
          ),
        ).size,
      ).toBe(10);
      expect(result.items[0]).toMatchObject({
        externalBookId: firstBookId,
        title: `${rankType} 小说 1`,
        author: `${rankType} 作者 1`,
        sourceUrl: `https://www.qidian.com/book/${firstBookId}/`,
        metrics: { [metricName]: 12_345 },
      });
      expect(result.items[9]).toMatchObject({
        title: `${rankType} 小说 10`,
        author: `${rankType} 作者 10`,
        metrics: { [metricName]: 10 },
      });
    },
  );

  it.each([
    ["a required field is missing", "ranking-missing-author.html"],
    ["book IDs are duplicated", "ranking-duplicate-id.html"],
    ["fewer than 10 entries are available", "ranking-too-short.html"],
    ["the upstream structure is not recognized", "ranking-structure-changed.html"],
  ])("rejects the ranking when %s", (_reason, fixtureName) => {
    expect(() =>
      parser.parse({
        html: fixture(fixtureName),
        rankType: "yuepiao",
        sourceUrl: "https://www.qidian.com/rank/yuepiao/",
        fetchedAt: FETCHED_AT,
      }),
    ).toThrow("Qidian ranking must contain exactly 10 unique complete items");
  });

  it("rejects a chapter link used as a ranking book title", () => {
    const items = Array.from({ length: 10 }, (_, index) => {
      const bookId = `250000000${index}`;
      const href =
        index === 0 ? `/book/${bookId}/chapter/99` : `/book/${bookId}/`;

      return `<li><h2><a href="${href}">严格路径小说 ${index}</a></h2><p class="author"><a>作者 ${index}</a></p></li>`;
    }).join("");

    expect(() =>
      parser.parse({
        html: `<ol class="book-img-text">${items}</ol>`,
        rankType: "yuepiao",
        sourceUrl: "https://www.qidian.com/rank/yuepiao/",
        fetchedAt: FETCHED_AT,
      }),
    ).toThrow("Qidian ranking must contain exactly 10 unique complete items");
  });

  it("accepts relative and absolute strict book resource URLs", () => {
    const items = Array.from({ length: 10 }, (_, index) => {
      const bookId = `260000000${index}`;
      const href =
        index % 2 === 0
          ? `/book/${bookId}`
          : `https://www.qidian.com/book/${bookId}/?from=rank`;

      return `<li><h2><a href="${href}">严格路径小说 ${index}</a></h2><p class="author"><a>作者 ${index}</a></p></li>`;
    }).join("");

    const result = parser.parse({
      html: `<ol class="book-img-text">${items}</ol>`,
      rankType: "yuepiao",
      sourceUrl: "https://www.qidian.com/rank/yuepiao/",
      fetchedAt: FETCHED_AT,
    });

    expect(result.items).toHaveLength(10);
  });

  it("reads a deeply nested ranking title without recursive overflow", () => {
    const depth = 5_000;
    const deepTitle = `${"<span>".repeat(depth)}深层榜单标题${"</span>".repeat(depth)}`;
    const items = Array.from({ length: 10 }, (_, index) => {
      const title = index === 0 ? deepTitle : `普通标题 ${index}`;

      return `<li><h2><a href="/book/270000000${index}/">${title}</a></h2><p class="author"><a>作者 ${index}</a></p></li>`;
    }).join("");

    const result = parser.parse({
      html: `<ol class="book-img-text">${items}</ol>`,
      rankType: "yuepiao",
      sourceUrl: "https://www.qidian.com/rank/yuepiao/",
      fetchedAt: FETCHED_AT,
    });

    expect(result.items[0].title).toBe("深层榜单标题");
  });

  it("fails closed when ranking text exceeds the DOM depth budget", () => {
    const depth = 9_000;
    const deepTitle = `${"<span>".repeat(depth)}超限标题${"</span>".repeat(depth)}`;
    const items = Array.from({ length: 10 }, (_, index) => {
      const title = index === 0 ? deepTitle : `普通标题 ${index}`;

      return `<li><h2><a href="/book/280000000${index}/">${title}</a></h2><p class="author"><a>作者 ${index}</a></p></li>`;
    }).join("");

    expect(() =>
      parser.parse({
        html: `<ol class="book-img-text">${items}</ol>`,
        rankType: "yuepiao",
        sourceUrl: "https://www.qidian.com/rank/yuepiao/",
        fetchedAt: FETCHED_AT,
      }),
    ).toThrow("Qidian ranking must contain exactly 10 unique complete items");
  });
});
