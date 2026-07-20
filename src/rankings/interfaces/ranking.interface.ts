import type { Prisma } from "@prisma/client";
import type { RankType } from "../../crawlers/interfaces";

export type RankingSnapshot = Prisma.RankingSnapshotGetPayload<{
  include: { items: true };
}>;

export type RankingRefreshResult =
  | {
      rankType: RankType;
      success: true;
      snapshot: RankingSnapshot;
    }
  | {
      rankType: RankType;
      success: false;
      error: string;
    };
