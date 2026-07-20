export const RANK_TYPES = [
  "yuepiao",
  "hotsales",
  "recom",
  "collect",
] as const;

export type RankType = (typeof RANK_TYPES)[number];
