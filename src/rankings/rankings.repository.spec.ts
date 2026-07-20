import type { PrismaService } from "../shared/database/prisma.service";
import { RankingsRepository } from "./rankings.repository";
import type { CrawledRanking } from "../crawlers/interfaces";

function makeCrawledRanking(): CrawledRanking {
  return {
    platform: "qidian",
    rankType: "yuepiao",
    sourceUrl: "https://www.qidian.com/rank/yuepiao/",
    fetchedAt: new Date("2026-07-20T02:00:00.000Z"),
    items: Array.from({ length: 10 }, (_, index) => ({
      rank: index + 1,
      externalBookId: String(1000 + index),
      title: `Book ${index + 1}`,
      author: `Author ${index + 1}`,
      coverUrl: null,
      sourceUrl: `https://www.qidian.com/book/${1000 + index}/`,
      metrics: { score: index + 1 },
    })),
  };
}

describe("RankingsRepository", () => {
  it("reads the newest matching snapshot with ordered items", async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: "snapshot-1" });
    const prisma = { rankingSnapshot: { findFirst } };
    const repository = new RankingsRepository(
      prisma as unknown as PrismaService,
    );

    await expect(repository.findLatest("qidian", "recom")).resolves.toEqual({
      id: "snapshot-1",
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { platform: "qidian", rankType: "recom" },
      orderBy: [{ fetchedAt: "desc" }, { createdAt: "desc" }],
      include: { items: { orderBy: { rank: "asc" } } },
    });
  });

  it("uses one transaction for all books, the snapshot, and ten items", async () => {
    const crawled = makeCrawledRanking();
    const upsert = jest.fn(async ({ where }) => ({
      id: `db-${where.platform_externalBookId.externalBookId}`,
    }));
    const snapshotCreate = jest.fn().mockResolvedValue({ id: "snapshot-1" });
    const itemCreateMany = jest.fn().mockResolvedValue({ count: 10 });
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: "snapshot-1",
      items: crawled.items,
    });
    const transactionClient = {
      book: { upsert },
      rankingSnapshot: {
        create: snapshotCreate,
        findUniqueOrThrow,
      },
      rankingItem: { createMany: itemCreateMany },
    };
    const transaction = jest.fn(async (callback) =>
      callback(transactionClient),
    );
    const prisma = { $transaction: transaction };
    const repository = new RankingsRepository(
      prisma as unknown as PrismaService,
    );

    await expect(repository.saveSnapshot(crawled)).resolves.toEqual({
      id: "snapshot-1",
      items: crawled.items,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(10);
    expect(snapshotCreate).toHaveBeenCalledTimes(1);
    expect(itemCreateMany).toHaveBeenCalledTimes(1);
    expect(itemCreateMany.mock.calls[0]?.[0].data).toHaveLength(10);
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "snapshot-1" },
      include: { items: { orderBy: { rank: "asc" } } },
    });
  });

  it("rejects the whole save when creating ranking items fails", async () => {
    const crawled = makeCrawledRanking();
    const transactionClient = {
      book: {
        upsert: jest.fn(async ({ where }) => ({
          id: `db-${where.platform_externalBookId.externalBookId}`,
        })),
      },
      rankingSnapshot: {
        create: jest.fn().mockResolvedValue({ id: "snapshot-partial" }),
      },
      rankingItem: {
        createMany: jest
          .fn()
          .mockRejectedValue(new Error("item insert failed")),
      },
    };
    const transaction = jest.fn(async (callback) =>
      callback(transactionClient),
    );
    const repository = new RankingsRepository({
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(repository.saveSnapshot(crawled)).rejects.toThrow(
      "item insert failed",
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
