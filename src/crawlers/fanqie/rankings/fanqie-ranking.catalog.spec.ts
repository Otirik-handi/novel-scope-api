import {
  FanqieRankingCatalog,
  FanqieRankingCatalogError,
  type FanqieRankingCatalogConfig,
} from "./fanqie-ranking.catalog";

function config(
  overrides: Partial<FanqieRankingCatalogConfig> = {},
): FanqieRankingCatalogConfig {
  return {
    channels: { "0": "女频", "1": "男频" },
    rankingTypes: { "1": "新书榜", "2": "阅读榜" },
    categoriesByChannel: {
      "0": [{ id: "1139", name: "古风世情" }],
      "1": [{ id: "1141", name: "西方奇幻" }],
    },
    ...overrides,
  };
}

describe("FanqieRankingCatalog", () => {
  it("generates all 74 definitions in stable order", () => {
    const catalog = new FanqieRankingCatalog();

    expect(catalog.list()).toHaveLength(74);
    expect(catalog.resolve("0_1_1139")).toEqual({
      platform: "fanqie",
      rankTypeKey: "0_1_1139",
      rankType: "女频-新书榜-古风世情",
    });
    expect(catalog.resolve("1_2_1141")?.rankType).toBe(
      "男频-阅读榜-西方奇幻",
    );
    expect(catalog.resolve("0_1_999999")).toBeNull();
  });

  it("exposes the same frozen definitions on every read", () => {
    const catalog = new FanqieRankingCatalog();

    expect(catalog.list()).toBe(catalog.list());
    expect(Object.isFrozen(catalog.list())).toBe(true);
    expect(catalog.list().every(Object.isFrozen)).toBe(true);
  });

  it.each([
    ["invalid channel", config({ channels: { "0": "女频", "2": "其他" } })],
    ["invalid type", config({ rankingTypes: { "1": "新书榜", "3": "其他" } })],
    [
      "missing category channel",
      config({ categoriesByChannel: { "0": [{ id: "1", name: "分类" }] } }),
    ],
    [
      "non-numeric category ID",
      config({
        categoriesByChannel: {
          "0": [{ id: "abc", name: "分类" }],
          "1": [{ id: "2", name: "分类二" }],
        },
      }),
    ],
    [
      "empty category ID",
      config({
        categoriesByChannel: {
          "0": [{ id: "", name: "分类" }],
          "1": [{ id: "2", name: "分类二" }],
        },
      }),
    ],
    ["empty channel name", config({ channels: { "0": " ", "1": "男频" } })],
    ["empty type name", config({ rankingTypes: { "1": " ", "2": "阅读榜" } })],
    [
      "empty category name",
      config({
        categoriesByChannel: {
          "0": [{ id: "1", name: " " }],
          "1": [{ id: "2", name: "分类二" }],
        },
      }),
    ],
    [
      "duplicate category ID",
      config({
        categoriesByChannel: {
          "0": [
            { id: "1", name: "分类一" },
            { id: "1", name: "分类二" },
          ],
          "1": [{ id: "2", name: "分类三" }],
        },
      }),
    ],
    [
      "duplicate category name",
      config({
        categoriesByChannel: {
          "0": [
            { id: "1", name: "分类" },
            { id: "2", name: "分类" },
          ],
          "1": [{ id: "3", name: "分类三" }],
        },
      }),
    ],
    [
      "duplicate generated name",
      config({
        channels: { "0": "同频道", "1": "同频道" },
        categoriesByChannel: {
          "0": [{ id: "1", name: "同分类" }],
          "1": [{ id: "1", name: "同分类" }],
        },
      }),
    ],
  ])("rejects %s", (_label, value) => {
    expect(() => new FanqieRankingCatalog(value)).toThrow(
      FanqieRankingCatalogError,
    );
  });

  it("allows category IDs and names to repeat across channels", () => {
    const reused = [
      { id: "8", name: "都市" },
      { id: "539", name: "幻想言情" },
      { id: "746", name: "悬疑" },
    ];
    const catalog = new FanqieRankingCatalog(
      config({ categoriesByChannel: { "0": reused, "1": reused } }),
    );

    expect(catalog.list()).toHaveLength(12);
    expect(catalog.resolve("0_1_8")).not.toBeNull();
    expect(catalog.resolve("1_2_746")).not.toBeNull();
  });
});
