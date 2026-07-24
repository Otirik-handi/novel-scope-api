import { randomUUID } from "node:crypto";
import type { CrawledRanking } from "../../src/crawlers/interfaces";
import { RankingsRepository } from "../../src/rankings/rankings.repository";
import { PrismaService } from "../../src/shared/database/prisma.service";
import { assertDatabaseIsolation } from "../../scripts/database-isolation.cjs";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const applicationDatabaseUrl = process.env.DATABASE_URL?.trim();

describe("RankingsRepository transaction", () => {
  const prisma = new PrismaService({
    datasources: { db: { url: testDatabaseUrl ?? "" } },
  });
  const repository = new RankingsRepository(prisma);
  const createdSnapshotIds = new Set<string>();
  const createdExternalBookIds = new Set<string>();
  let isolationVerified = false;

  beforeAll(async () => {
    await assertDatabaseIsolation({
      applicationDatabaseUrl,
      testDatabaseUrl,
    });
    isolationVerified = true;
  });

  afterEach(async () => {
    if (!isolationVerified) return;

    if (createdSnapshotIds.size > 0) {
      await prisma.rankingSnapshot.deleteMany({
        where: { id: { in: [...createdSnapshotIds] } },
      });
      createdSnapshotIds.clear();
    }
    if (createdExternalBookIds.size > 0) {
      await prisma.book.deleteMany({
        where: { externalBookId: { in: [...createdExternalBookIds] } },
      });
      createdExternalBookIds.clear();
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rolls back books and the snapshot when ranking item insertion fails", async () => {
    const runId = randomUUID();
    const externalBookIds = Array.from(
      { length: 10 },
      (_, index) => `transaction-rollback-${runId}-${index}`,
    );
    externalBookIds.forEach((id) => createdExternalBookIds.add(id));
    const sourceUrl = `https://fanqienovel.com/rank/0_1_1139?run=${runId}`;
    const ranking: CrawledRanking = {
      platform: "fanqie",
      rankTypeKey: "0_1_1139",
      rankType: "女频-新书榜-古风世情",
      sourceUrl,
      fetchedAt: new Date(),
      items: externalBookIds.map((externalBookId, index) => ({
        rank: index === 9 ? 1 : index + 1,
        externalBookId,
        title: `Transaction Book ${index + 1}`,
        author: `Transaction Author ${index + 1}`,
        coverUrl: null,
        sourceUrl: `https://fanqienovel.com/page/${externalBookId}`,
        metrics: {},
      })),
    };

    await expect(repository.saveSnapshot(ranking)).rejects.toMatchObject({
      code: "P2002",
    });

    expect(isolationVerified).toBe(true);
    await expect(prisma.rankingSnapshot.count({ where: { sourceUrl } })).resolves.toBe(0);
    await expect(
      prisma.book.count({
        where: { externalBookId: { in: externalBookIds } },
      }),
    ).resolves.toBe(0);
  });

  it("keeps the same external book IDs isolated across platform rankings", async () => {
    const runId = randomUUID();
    const externalBookIds = Array.from(
      { length: 10 },
      (_, index) => `cross-platform-${runId}-${index + 1}`,
    );
    externalBookIds.forEach((id) => createdExternalBookIds.add(id));
    const makeRanking = (
      platform: "qidian" | "fanqie",
      rankTypeKey: string,
      rankType: string,
    ): CrawledRanking => ({
      platform,
      rankTypeKey,
      rankType,
      sourceUrl:
        platform === "qidian"
          ? `https://www.qidian.com/rank/yuepiao/?run=${runId}`
          : `https://fanqienovel.com/rank/0_1_1139?run=${runId}`,
      fetchedAt: new Date(),
      items: externalBookIds.map((externalBookId, index) => ({
        rank: index + 1,
        externalBookId,
        title: `${platform} title ${index + 1}`,
        author: `${platform} author ${index + 1}`,
        coverUrl: null,
        sourceUrl:
          platform === "qidian"
            ? `https://www.qidian.com/book/${externalBookId}/`
            : `https://fanqienovel.com/page/${externalBookId}`,
        metrics: {},
      })),
    });

    const qidian = await repository.saveSnapshot(makeRanking("qidian", "yuepiao", "月票榜"));
    const fanqie = await repository.saveSnapshot(
      makeRanking("fanqie", "0_1_1139", "女频-新书榜-古风世情"),
    );
    createdSnapshotIds.add(qidian.id);
    createdSnapshotIds.add(fanqie.id);

    await expect(
      prisma.book.count({
        where: { externalBookId: { in: externalBookIds } },
      }),
    ).resolves.toBe(20);
    await expect(
      prisma.book.count({
        where: { platform: "qidian", externalBookId: externalBookIds[0] },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.book.count({
        where: { platform: "fanqie", externalBookId: externalBookIds[0] },
      }),
    ).resolves.toBe(1);
    const latestQidian = await repository.findLatest("qidian", "yuepiao");
    const latestFanqie = await repository.findLatest(
      "fanqie",
      "0_1_1139",
    );
    expect(latestQidian).toMatchObject({ id: qidian.id });
    expect(latestQidian?.items).toHaveLength(10);
    expect(latestQidian?.items[0].title).toBe("qidian title 1");
    expect(latestFanqie).toMatchObject({ id: fanqie.id });
    expect(latestFanqie?.items).toHaveLength(10);
    expect(latestFanqie?.items[0].title).toBe("fanqie title 1");
  });
});
