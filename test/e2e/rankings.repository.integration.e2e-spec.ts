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
  let isolationVerified = false;

  beforeAll(async () => {
    await assertDatabaseIsolation({
      applicationDatabaseUrl,
      testDatabaseUrl,
    });
    isolationVerified = true;
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
    const sourceUrl = `https://www.qidian.com/rank/transaction-${runId}/`;
    const ranking: CrawledRanking = {
      platform: "qidian",
      rankType: "yuepiao",
      sourceUrl,
      fetchedAt: new Date(),
      items: externalBookIds.map((externalBookId, index) => ({
        rank: index === 9 ? 1 : index + 1,
        externalBookId,
        title: `Transaction Book ${index + 1}`,
        author: `Transaction Author ${index + 1}`,
        coverUrl: null,
        sourceUrl: `https://www.qidian.com/book/${externalBookId}/`,
        metrics: {},
      })),
    };

    await expect(repository.saveSnapshot(ranking)).rejects.toMatchObject({
      code: "P2002",
    });

    expect(isolationVerified).toBe(true);
    await expect(
      prisma.rankingSnapshot.count({ where: { sourceUrl } }),
    ).resolves.toBe(0);
    await expect(
      prisma.book.count({
        where: { externalBookId: { in: externalBookIds } },
      }),
    ).resolves.toBe(0);
  });
});
