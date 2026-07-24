import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FanqieBookParseError,
  FanqieBookParser,
} from "./fanqie-book.parser";

const fixtureDirectory = join(process.cwd(), "test", "fixtures", "fanqie");
const fetchedAt = new Date("2026-07-24T00:31:00.000Z");

function fixture(name: string): string {
  return readFileSync(join(fixtureDirectory, name), "utf8");
}

function parse(html: string, externalBookId: string) {
  return new FanqieBookParser().parse({
    html,
    externalBookId,
    sourceUrl: `https://fanqienovel.com/page/${externalBookId}`,
    fetchedAt,
  });
}

function jsonHtml(value: unknown): string {
  return `<script type="application/json">${JSON.stringify(value)}</script>`;
}

describe("FanqieBookParser", () => {
  it("parses the fixed initial-state wrapper without executing it", () => {
    const result = parse(fixture("book-author-name.html"), "7001");

    expect(result).toEqual({
      platform: "fanqie",
      externalBookId: "7001",
      title: "书名 一",
      author: "作者甲",
      description: "第一行\n第二行",
      coverUrl: "https://example.com/book.jpg",
      genres: ["古风世情", "甜宠", "成长"],
      bookStatus: "连载中",
      wordCount: 123_000,
      metadata: {
        originalBookName: "原书名",
        firstChapterTitle: "第一章",
        lastChapterTitle: "最新章",
      },
      sourceUrl: "https://fanqienovel.com/page/7001",
      fetchedAt,
    });
  });

  it("uses the author fallback and object category", () => {
    expect(parse(fixture("book-author-fallback.html"), "7002")).toMatchObject({
      author: "作者乙",
      genres: ["都市"],
      bookStatus: "已完结",
      wordCount: 456_789,
    });
  });

  it("returns stable empty values for missing optional fields", () => {
    expect(
      parse(fixture("book-optional-fields-missing.html"), "7003"),
    ).toMatchObject({
      description: null,
      coverUrl: null,
      genres: [],
      bookStatus: null,
      wordCount: null,
      metadata: {},
    });
  });

  it.each([
    ["wrong book ID", fixture("book-wrong-id.html"), "7004"],
    ["missing title", jsonHtml({ bookId: "7005", authorName: "作者" }), "7005"],
    ["missing author", jsonHtml({ bookId: "7006", bookName: "书名" }), "7006"],
    ["invalid JSON", '<script type="application/json">{invalid}</script>', "7007"],
  ])("rejects %s", (_label, html, bookId) => {
    expect(() => parse(html, bookId)).toThrow(FanqieBookParseError);
  });

  it("rejects an invalid or empty source URL", () => {
    expect(() =>
      new FanqieBookParser().parse({
        html: fixture("book-author-fallback.html"),
        externalBookId: "7002",
        sourceUrl: " ",
        fetchedAt,
      }),
    ).toThrow(FanqieBookParseError);
  });

  it("rejects JSON deeper than the traversal limit", () => {
    let value: unknown = {
      bookId: "7008",
      bookName: "书名",
      authorName: "作者",
    };

    for (let index = 0; index < 65; index += 1) {
      value = { child: value };
    }

    expect(() => parse(jsonHtml(value), "7008")).toThrow(
      FanqieBookParseError,
    );
  });

  it("rejects JSON exceeding the traversal node limit", () => {
    const value = { nodes: Array.from({ length: 50_001 }, () => ({})) };

    expect(() => parse(jsonHtml(value), "7009")).toThrow(
      FanqieBookParseError,
    );
  });

  it.each(["NaN", "Infinity", 2_147_483_648])(
    "rejects invalid word count %s",
    (wordCount) => {
      expect(() =>
        parse(
          jsonHtml({
            bookId: "7010",
            bookName: "书名",
            authorName: "作者",
            wordCount,
          }),
          "7010",
        ),
      ).toThrow(FanqieBookParseError);
    },
  );
});
