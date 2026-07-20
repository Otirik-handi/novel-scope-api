import type { CrawledBook } from "../../src/crawlers/interfaces";
import { BooksRepository } from "../../src/books/books.repository";
import { PrismaService } from "../../src/shared/database/prisma.service";
import { assertDatabaseIsolation } from "../../scripts/database-isolation.cjs";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const applicationDatabaseUrl = process.env.DATABASE_URL?.trim();

describe("BooksRepository transaction", () => {
  const prisma = new PrismaService({
    datasources: { db: { url: testDatabaseUrl ?? "" } },
  });
  const repository = new BooksRepository(prisma);
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
    if (!isolationVerified || createdExternalBookIds.size === 0) {
      return;
    }

    await prisma.book.deleteMany({
      where: {
        platform: "qidian",
        externalBookId: { in: [...createdExternalBookIds] },
      },
    });
    createdExternalBookIds.clear();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function makeBook(externalBookId: string): CrawledBook {
    createdExternalBookIds.add(externalBookId);
    return {
      platform: "qidian",
      externalBookId,
      title: "首次成功标题",
      author: "测试作者",
      description: "首次简介",
      coverUrl: null,
      genres: ["玄幻"],
      bookStatus: "连载",
      wordCount: 100,
      metadata: { source: "integration" },
      sourceUrl: `https://www.qidian.com/book/${externalBookId}/`,
      fetchedAt: new Date("2026-07-20T12:00:00.000Z"),
    };
  }

  it("atomically creates and then updates one Book with one latest detail", async () => {
    const externalBookId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const first = makeBook(externalBookId);
    const firstExpiresAt = new Date("2026-07-20T15:00:00.000Z");

    const created = await repository.upsertDetail(first, firstExpiresAt);
    const refreshed = await repository.upsertDetail(
      {
        ...first,
        title: "刷新成功标题",
        description: "刷新简介",
        fetchedAt: new Date("2026-07-20T16:00:00.000Z"),
      },
      new Date("2026-07-20T19:00:00.000Z"),
    );

    expect(refreshed.bookId).toBe(created.bookId);
    expect(refreshed).toMatchObject({
      title: "刷新成功标题",
      description: "刷新简介",
      fetchedAt: new Date("2026-07-20T16:00:00.000Z"),
      expiresAt: new Date("2026-07-20T19:00:00.000Z"),
    });
    await expect(
      prisma.book.count({ where: { platform: "qidian", externalBookId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.bookDetail.count({ where: { bookId: created.bookId } }),
    ).resolves.toBe(1);
  });

  it("rolls back a newly created Book when detail persistence fails", async () => {
    const externalBookId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const invalid = {
      ...makeBook(externalBookId),
      wordCount: 2_147_483_648,
    };

    await expect(
      repository.upsertDetail(
        invalid,
        new Date("2026-07-20T15:00:00.000Z"),
      ),
    ).rejects.toBeDefined();

    await expect(
      prisma.book.count({ where: { platform: "qidian", externalBookId } }),
    ).resolves.toBe(0);
  });
});
