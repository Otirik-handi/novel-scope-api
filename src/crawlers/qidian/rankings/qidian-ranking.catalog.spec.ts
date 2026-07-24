import { SUPPORTED_PLATFORMS } from "../../../shared/types/platform.type";
import {
  QIDIAN_RANKING_DEFINITIONS,
  QidianRankingCatalog,
} from "./qidian-ranking.catalog";

describe("QidianRankingCatalog", () => {
  const catalog = new QidianRankingCatalog();

  it("keeps the supported platform order stable", () => {
    expect(SUPPORTED_PLATFORMS).toEqual(["qidian", "fanqie"]);
  });

  it("lists the four stable Qidian keys and display names", () => {
    expect(catalog.list()).toEqual([
      { platform: "qidian", rankTypeKey: "yuepiao", rankType: "月票榜" },
      { platform: "qidian", rankTypeKey: "hotsales", rankType: "畅销榜" },
      { platform: "qidian", rankTypeKey: "recom", rankType: "推荐榜" },
      { platform: "qidian", rankTypeKey: "collect", rankType: "收藏榜" },
    ]);
    expect(catalog.list()).toBe(QIDIAN_RANKING_DEFINITIONS);
  });

  it("resolves only registered Qidian keys", () => {
    expect(catalog.resolve("yuepiao")).toEqual(QIDIAN_RANKING_DEFINITIONS[0]);
    expect(catalog.resolve("unknown")).toBeNull();
    expect(catalog.resolve("0_1_1139")).toBeNull();
  });
});
