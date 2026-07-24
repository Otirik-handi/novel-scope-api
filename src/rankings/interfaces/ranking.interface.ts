import type { Prisma } from "@prisma/client";

export type RankingSnapshot = Prisma.RankingSnapshotGetPayload<{
  include: { items: true };
}>;

export type RankingRefreshResult =
  | {
      rankTypeKey: string;
      rankType: string;
      success: true;
      snapshot: RankingSnapshot;
    }
  | {
      rankTypeKey: string;
      rankType: string;
      success: false;
      error: "RANKING_REFRESH_FAILED";
    };
