import { Injectable } from "@nestjs/common";
import type {
  RankingCatalog,
  RankingDefinition,
} from "../../interfaces";

export const QIDIAN_RANKING_DEFINITIONS = [
  { platform: "qidian", rankTypeKey: "yuepiao", rankType: "月票榜" },
  { platform: "qidian", rankTypeKey: "hotsales", rankType: "畅销榜" },
  { platform: "qidian", rankTypeKey: "recom", rankType: "推荐榜" },
  { platform: "qidian", rankTypeKey: "collect", rankType: "收藏榜" },
] as const satisfies readonly RankingDefinition[];

export type QidianRankTypeKey =
  (typeof QIDIAN_RANKING_DEFINITIONS)[number]["rankTypeKey"];
export type QidianRankingDefinition =
  (typeof QIDIAN_RANKING_DEFINITIONS)[number];

@Injectable()
export class QidianRankingCatalog implements RankingCatalog {
  list(): readonly QidianRankingDefinition[] {
    return QIDIAN_RANKING_DEFINITIONS;
  }

  resolve(rankTypeKey: string): QidianRankingDefinition | null {
    return this.list().find((item) => item.rankTypeKey === rankTypeKey) ?? null;
  }
}
