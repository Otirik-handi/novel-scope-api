import type { Platform } from "../../shared/types/platform.type";

export interface RankingDefinition {
  platform: Platform;
  rankTypeKey: string;
  rankType: string;
}

export interface RankingCatalog {
  list(): readonly RankingDefinition[];
  resolve(rankTypeKey: string): RankingDefinition | null;
}
