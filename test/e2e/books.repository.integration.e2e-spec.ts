import type { Prisma } from "@prisma/client";
import type { CrawledBook } from "../../src/crawlers/interfaces";
import { BooksRepository } from "../../src/books/books.repository";
import { PrismaService } from "../../src/shared/database/prisma.service";
import { assertDatabaseIsolation } from "../../scripts/database-isolation.cjs";

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const applicationDatabaseUrl = process.env.DATABASE_URL?.trim();

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

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

  it("does not let an older transaction overwrite a newer committed detail", async () => {
    const externalBookId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const base = makeBook(externalBookId);
    const older = {
      ...base,
      title: "older title",
      fetchedAt: new Date("2026-07-20T12:00:00.000Z"),
    };
    const newer = {
      ...base,
      title: "newer title",
      fetchedAt: new Date("2026-07-20T13:00:00.000Z"),
    };
    const olderExpiresAt = new Date("2026-07-20T15:00:00.000Z");
    const newerExpiresAt = new Date("2026-07-20T16:00:00.000Z");
    const olderTransactionStarted = deferred();
    const releaseOlderTransaction = deferred();
    const delayedPrisma = {
      $transaction: <T>(
        callback: (transaction: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> =>
        prisma.$transaction(async (transaction) => {
          olderTransactionStarted.resolve();
          await releaseOlderTransaction.promise;
          return callback(transaction);
        }),
    } as unknown as PrismaService;
    const delayedRepository = new BooksRepository(delayedPrisma);

    const olderSave = delayedRepository.upsertDetail(older, olderExpiresAt);
    await olderTransactionStarted.promise;

    let newerSaved;
    try {
      newerSaved = await repository.upsertDetail(newer, newerExpiresAt);
    } finally {
      releaseOlderTransaction.resolve();
    }
    const olderResult = await olderSave;
    const finalBook = await prisma.book.findUniqueOrThrow({
      where: {
        platform_externalBookId: { platform: "qidian", externalBookId },
      },
      include: { detail: true },
    });

    expect(newerSaved).toMatchObject({
      title: "newer title",
      fetchedAt: newer.fetchedAt,
      expiresAt: newerExpiresAt,
    });
    expect(olderResult).toMatchObject({
      title: "newer title",
      fetchedAt: newer.fetchedAt,
      expiresAt: newerExpiresAt,
    });
    expect(finalBook.detail).toMatchObject({
      title: "newer title",
      fetchedAt: newer.fetchedAt,
      expiresAt: newerExpiresAt,
    });
  });

  it("handles two concurrent first writes without a unique conflict", async () => {
    const externalBookId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const base = makeBook(externalBookId);
    const older = {
      ...base,
      title: "concurrent older title",
      fetchedAt: new Date("2026-07-20T12:00:00.000Z"),
    };
    const newer = {
      ...base,
      title: "concurrent newer title",
      fetchedAt: new Date("2026-07-20T13:00:00.000Z"),
    };
    const firstStarted = deferred();
    const secondStarted = deferred();
    const releaseBoth = deferred();
    const gatedRepository = (started: ReturnType<typeof deferred>) =>
      new BooksRepository({
        $transaction: <T>(
          callback: (transaction: Prisma.TransactionClient) => Promise<T>,
        ): Promise<T> =>
          prisma.$transaction(async (transaction) => {
            started.resolve();
            await releaseBoth.promise;
            return callback(transaction);
          }),
      } as unknown as PrismaService);

    const olderSave = gatedRepository(firstStarted).upsertDetail(
      older,
      new Date("2026-07-20T15:00:00.000Z"),
    );
    const newerSave = gatedRepository(secondStarted).upsertDetail(
      newer,
      new Date("2026-07-20T16:00:00.000Z"),
    );
    await Promise.all([firstStarted.promise, secondStarted.promise]);
    releaseBoth.resolve();

    await expect(Promise.all([olderSave, newerSave])).resolves.toHaveLength(2);
    const finalBook = await prisma.book.findUniqueOrThrow({
      where: {
        platform_externalBookId: { platform: "qidian", externalBookId },
      },
      include: { detail: true },
    });
    expect(finalBook.detail).toMatchObject({
      title: "concurrent newer title",
      fetchedAt: newer.fetchedAt,
      expiresAt: new Date("2026-07-20T16:00:00.000Z"),
    });
    await expect(
      prisma.book.count({ where: { platform: "qidian", externalBookId } }),
    ).resolves.toBe(1);
    await expect(
      prisma.bookDetail.count({ where: { bookId: finalBook.id } }),
    ).resolves.toBe(1);
  });

  it("lets the later complete write win when fetchedAt values are equal", async () => {
    const externalBookId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const first = makeBook(externalBookId);
    const fetchedAt = new Date("2026-07-20T12:00:00.000Z");
    const firstExpiresAt = new Date("2026-07-20T15:00:00.000Z");
    const secondExpiresAt = new Date("2026-07-20T16:00:00.000Z");

    await repository.upsertDetail(
      { ...first, title: "equal first title", fetchedAt },
      firstExpiresAt,
    );
    const second = await repository.upsertDetail(
      { ...first, title: "equal second title", fetchedAt },
      secondExpiresAt,
    );

    expect(second).toMatchObject({
      title: "equal second title",
      fetchedAt,
      expiresAt: secondExpiresAt,
    });
  });
});
