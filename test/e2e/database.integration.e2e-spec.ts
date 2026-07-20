import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const applicationDatabaseUrl = process.env.DATABASE_URL?.trim();

if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for database integration tests");
}

if (applicationDatabaseUrl && testDatabaseUrl === applicationDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL");
}

describe("database schema", () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  });
  const createdBookIds = new Set<string>();
  const createdSnapshotIds = new Set<string>();

  afterEach(async () => {
    if (createdSnapshotIds.size > 0) {
      await prisma.rankingSnapshot.deleteMany({
        where: { id: { in: [...createdSnapshotIds] } },
      });
      createdSnapshotIds.clear();
    }

    if (createdBookIds.size > 0) {
      await prisma.book.deleteMany({
        where: { id: { in: [...createdBookIds] } },
      });
      createdBookIds.clear();
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function bookData(suffix: string) {
    const id = randomUUID();
    createdBookIds.add(id);

    return {
      id,
      platform: "qidian",
      externalBookId: `integration-book-${suffix}-${id}`,
    };
  }

  function snapshotData(suffix: string) {
    const id = randomUUID();
    createdSnapshotIds.add(id);

    return {
      id,
      platform: "qidian",
      rankType: `integration-${suffix}`,
      sourceUrl: `https://www.qidian.com/rank/${suffix}`,
      fetchedAt: new Date(),
    };
  }

  async function expectUniqueViolation(action: Promise<unknown>) {
    await expect(action).rejects.toMatchObject({ code: "P2002" });
  }

  it("persists book detail and ranking item relationships", async () => {
    const book = await prisma.book.create({
      data: {
        ...bookData("relations"),
        detail: {
          create: {
            title: "测试作品",
            author: "测试作者",
            genres: ["玄幻"],
            metadata: { source: "integration" },
            sourceUrl: "https://book.qidian.com/info/integration",
            fetchedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
          },
        },
      },
    });
    const snapshot = await prisma.rankingSnapshot.create({
      data: snapshotData("relations"),
    });
    await prisma.rankingItem.create({
      data: {
        snapshotId: snapshot.id,
        bookId: book.id,
        rank: 1,
        externalBookId: book.externalBookId,
        title: "采集时标题",
        author: "采集时作者",
        sourceUrl: "https://book.qidian.com/info/integration",
        metrics: { monthlyTickets: 100 },
      },
    });

    const persisted = await prisma.rankingSnapshot.findUniqueOrThrow({
      where: { id: snapshot.id },
      include: { items: { include: { book: { include: { detail: true } } } } },
    });

    expect(persisted.items).toHaveLength(1);
    expect(persisted.items[0].book.detail).toMatchObject({
      bookId: book.id,
      title: "测试作品",
      author: "测试作者",
      genres: ["玄幻"],
      metadata: { source: "integration" },
    });
    expect(persisted.items[0].metrics).toEqual({ monthlyTickets: 100 });
  });

  it("enforces one book per platform and external id", async () => {
    const data = bookData("book-unique");
    await prisma.book.create({ data });

    await expectUniqueViolation(
      prisma.book.create({
        data: { ...bookData("discarded"), externalBookId: data.externalBookId },
      }),
    );
  });

  it("enforces at most one detail per book", async () => {
    const book = await prisma.book.create({ data: bookData("detail-unique") });
    const detail = {
      bookId: book.id,
      title: "测试作品",
      author: "测试作者",
      sourceUrl: "https://book.qidian.com/info/integration",
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };
    await prisma.bookDetail.create({ data: detail });

    await expectUniqueViolation(prisma.bookDetail.create({ data: detail }));
  });

  it("enforces rank and external book uniqueness within a snapshot", async () => {
    const firstBook = await prisma.book.create({ data: bookData("rank-first") });
    const secondBook = await prisma.book.create({ data: bookData("rank-second") });
    const snapshot = await prisma.rankingSnapshot.create({
      data: snapshotData("ranking-unique"),
    });
    const firstItem = {
      snapshotId: snapshot.id,
      bookId: firstBook.id,
      rank: 1,
      externalBookId: firstBook.externalBookId,
      title: "第一本",
      author: "作者一",
      sourceUrl: "https://book.qidian.com/info/first",
      metrics: {},
    };
    await prisma.rankingItem.create({ data: firstItem });

    await expectUniqueViolation(
      prisma.rankingItem.create({
        data: {
          ...firstItem,
          bookId: secondBook.id,
          externalBookId: secondBook.externalBookId,
        },
      }),
    );
    await expectUniqueViolation(
      prisma.rankingItem.create({
        data: { ...firstItem, rank: 2 },
      }),
    );
  });

  it("cascades deletion from snapshots and books", async () => {
    const book = await prisma.book.create({
      data: {
        ...bookData("cascade"),
        detail: {
          create: {
            title: "测试作品",
            author: "测试作者",
            sourceUrl: "https://book.qidian.com/info/cascade",
            fetchedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
          },
        },
      },
    });
    const snapshot = await prisma.rankingSnapshot.create({
      data: snapshotData("cascade"),
    });
    const item = await prisma.rankingItem.create({
      data: {
        snapshotId: snapshot.id,
        bookId: book.id,
        rank: 1,
        externalBookId: book.externalBookId,
        title: "测试作品",
        author: "测试作者",
        sourceUrl: "https://book.qidian.com/info/cascade",
        metrics: {},
      },
    });

    await prisma.rankingSnapshot.delete({ where: { id: snapshot.id } });
    createdSnapshotIds.delete(snapshot.id);
    expect(
      await prisma.rankingItem.findUnique({ where: { id: item.id } }),
    ).toBeNull();

    const secondSnapshot = await prisma.rankingSnapshot.create({
      data: snapshotData("book-cascade"),
    });
    const secondItem = await prisma.rankingItem.create({
      data: {
        snapshotId: secondSnapshot.id,
        bookId: book.id,
        rank: 1,
        externalBookId: book.externalBookId,
        title: "测试作品",
        author: "测试作者",
        sourceUrl: "https://book.qidian.com/info/cascade",
      },
    });

    await prisma.book.delete({ where: { id: book.id } });
    createdBookIds.delete(book.id);
    expect(
      await prisma.bookDetail.findUnique({ where: { bookId: book.id } }),
    ).toBeNull();
    expect(
      await prisma.rankingItem.findUnique({ where: { id: secondItem.id } }),
    ).toBeNull();
  });
});
