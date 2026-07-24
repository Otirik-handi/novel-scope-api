import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { CrawledRanking } from "../crawlers/interfaces";
import type { Platform } from "../shared/types/platform.type";
import { PrismaService } from "../shared/database/prisma.service";
import type { RankingSnapshot } from "./interfaces/ranking.interface";

const snapshotWithOrderedItems = {
  items: { orderBy: { rank: "asc" as const } },
};

@Injectable()
export class RankingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findLatest(
    platform: Platform,
    rankTypeKey: string,
  ): Promise<RankingSnapshot | null> {
    return this.prisma.rankingSnapshot.findFirst({
      where: { platform, rankTypeKey },
      orderBy: [{ fetchedAt: "desc" }, { createdAt: "desc" }],
      include: snapshotWithOrderedItems,
    });
  }

  saveSnapshot(ranking: CrawledRanking): Promise<RankingSnapshot> {
    return this.prisma.$transaction(async (transaction) => {
      const bookIds = new Map<string, string>();

      for (const item of ranking.items) {
        const book = await transaction.book.upsert({
          where: {
            platform_externalBookId: {
              platform: ranking.platform,
              externalBookId: item.externalBookId,
            },
          },
          create: {
            platform: ranking.platform,
            externalBookId: item.externalBookId,
          },
          update: {},
          select: { id: true },
        });
        bookIds.set(item.externalBookId, book.id);
      }

      const snapshot = await transaction.rankingSnapshot.create({
        data: {
          platform: ranking.platform,
          rankTypeKey: ranking.rankTypeKey,
          rankType: ranking.rankType,
          sourceUrl: ranking.sourceUrl,
          fetchedAt: ranking.fetchedAt,
        },
        select: { id: true },
      });

      await transaction.rankingItem.createMany({
        data: ranking.items.map((item) => ({
          snapshotId: snapshot.id,
          bookId: this.requireBookId(bookIds, item.externalBookId),
          rank: item.rank,
          externalBookId: item.externalBookId,
          title: item.title,
          author: item.author,
          coverUrl: item.coverUrl,
          sourceUrl: item.sourceUrl,
          metrics: item.metrics as Prisma.InputJsonValue,
        })),
      });

      return transaction.rankingSnapshot.findUniqueOrThrow({
        where: { id: snapshot.id },
        include: snapshotWithOrderedItems,
      });
    });
  }

  private requireBookId(
    bookIds: ReadonlyMap<string, string>,
    externalBookId: string,
  ): string {
    const bookId = bookIds.get(externalBookId);

    if (bookId === undefined) {
      throw new Error(`Missing upserted book: ${externalBookId}`);
    }

    return bookId;
  }
}
