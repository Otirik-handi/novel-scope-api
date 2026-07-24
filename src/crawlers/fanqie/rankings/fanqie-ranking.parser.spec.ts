import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RankingDefinition } from "../../interfaces";
import {
  FanqieRankingParseError,
  FanqieRankingParser,
} from "./fanqie-ranking.parser";

const fixtureDirectory = join(process.cwd(), "test", "fixtures", "fanqie");
const definition: RankingDefinition = {
  platform: "fanqie",
  rankTypeKey: "0_1_1139",
  rankType: "女频-新书榜-古风世情",
};
const fetchedAt = new Date("2026-07-24T00:30:00.000Z");

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(fixtureDirectory, name), "utf8"),
  ) as unknown;
}

function parse(initialState: unknown) {
  return new FanqieRankingParser().parse({
    initialState,
    definition,
    sourceUrl: "https://fanqienovel.com/rank/0_1_1139",
    fetchedAt,
  });
}

describe("FanqieRankingParser", () => {
  it("normalizes a complete Top 10 ranking", () => {
    const result = parse(fixture("ranking-valid.json"));

    expect(result).toMatchObject({
      platform: "fanqie",
      rankTypeKey: "0_1_1139",
      rankType: "女频-新书榜-古风世情",
      sourceUrl: "https://fanqienovel.com/rank/0_1_1139",
      fetchedAt,
    });
    expect(result.items).toHaveLength(10);
    expect(result.items.map((item) => item.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(result.items[0]).toEqual({
      rank: 1,
      externalBookId: "1001",
      title: "书名一",
      author: "作者一",
      coverUrl: "https://example.com/1.jpg",
      sourceUrl: "https://fanqienovel.com/page/1001",
      metrics: {
        readCount: 12_000,
        wordCount: 123_000,
        creationStatus: "连载中",
        lastChapterTitle: "第一章",
        category: "古风世情",
      },
    });
    expect(result.items[1]).toMatchObject({
      externalBookId: "1002",
      title: "书名二",
      author: "作者二",
    });
  });

  it("omits optional metrics and cover fields", () => {
    const result = parse(fixture("ranking-optional-fields-missing.json"));

    expect(result.items[0]).toMatchObject({ coverUrl: null, metrics: {} });
  });

  it.each([
    "ranking-duplicate-book.json",
    "ranking-too-short.json",
    "ranking-required-field-missing.json",
  ])("rejects invalid fixture %s", (name) => {
    expect(() => parse(fixture(name))).toThrow(FanqieRankingParseError);
  });

  it.each([null, [], {}, { unrelated: [] }])(
    "rejects an invalid initial state",
    (initialState) => {
      expect(() => parse(initialState)).toThrow(FanqieRankingParseError);
    },
  );

  it("rejects a definition from another platform", () => {
    expect(() =>
      new FanqieRankingParser().parse({
        initialState: fixture("ranking-valid.json"),
        definition: { ...definition, platform: "qidian" },
        sourceUrl: "https://fanqienovel.com/rank/0_1_1139",
        fetchedAt,
      }),
    ).toThrow(FanqieRankingParseError);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an unsafe metric value %s",
    (readCount) => {
      const items = Array.from({ length: 10 }, (_, index) => ({
        bookId: String(6000 + index),
        bookName: `样本${index}`,
        authorName: `作者${index}`,
        readCount,
      }));

      expect(() => parse({ rankData: { bookList: items } })).toThrow(
        FanqieRankingParseError,
      );
    },
  );
});
