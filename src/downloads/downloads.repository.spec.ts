import type { PrismaService } from "../shared/database/prisma.service";
import { DownloadsRepository } from "./downloads.repository";

const createdAt = new Date("2026-07-26T10:00:00.000Z");
const startedAt = new Date("2026-07-26T10:01:00.000Z");

function stored(overrides: Record<string, unknown> = {}) {
  return {
    id: "download-1",
    bookId: "book-1",
    startChapter: 20,
    endChapter: 30,
    status: "QUEUED",
    downstreamJobId: null,
    progress: {},
    artifactPath: null,
    artifactFilename: null,
    artifactSizeBytes: null,
    artifactSha256: null,
    errorCode: null,
    errorMessage: null,
    createdAt,
    startedAt: null,
    finishedAt: null,
    updatedAt: createdAt,
    book: {
      id: "book-1",
      platform: "fanqie",
      externalBookId: "7069948840148732967",
    },
    ...overrides,
  };
}

describe("DownloadsRepository", () => {
  it("atomically upserts the requested book identity and creates a queued task", async () => {
    const bookCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    const bookFind = jest.fn().mockResolvedValue({ id: "book-1" });
    const downloadCreate = jest.fn().mockResolvedValue(stored());
    const transactionClient = {
      book: { createMany: bookCreateMany, findUniqueOrThrow: bookFind },
      bookDownload: { create: downloadCreate },
    };
    const transaction = jest.fn(async (callback) => callback(transactionClient));
    const repository = new DownloadsRepository({
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(
      repository.createQueued("qidian", "1043182343", {
        startChapter: 20,
        endChapter: 30,
      }),
    ).resolves.toEqual(stored());
    expect(bookCreateMany).toHaveBeenCalledWith({
      data: [{ platform: "qidian", externalBookId: "1043182343" }],
      skipDuplicates: true,
    });
    expect(bookFind).toHaveBeenCalledWith({
      where: {
        platform_externalBookId: {
          platform: "qidian",
          externalBookId: "1043182343",
        },
      },
      select: { id: true },
    });
    expect(downloadCreate).toHaveBeenCalledWith({
      data: {
        bookId: "book-1",
        startChapter: 20,
        endChapter: 30,
      },
      include: { book: true },
    });
  });

  it("claims the oldest queued task with a conditional update", async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: "download-1" });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = jest
      .fn()
      .mockResolvedValue(stored({ status: "RUNNING", startedAt }));
    const transaction = jest.fn(async (callback) =>
      callback({
        bookDownload: { findFirst, updateMany, findUniqueOrThrow },
      }),
    );
    const repository = new DownloadsRepository({
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(repository.claimNextQueued(startedAt)).resolves.toMatchObject({
      id: "download-1",
      status: "RUNNING",
      startedAt,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { status: "QUEUED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "download-1", status: "QUEUED" },
      data: { status: "RUNNING", startedAt },
    });
  });

  it("returns null when no queued task exists", async () => {
    const transaction = jest.fn(async (callback) =>
      callback({ bookDownload: { findFirst: jest.fn().mockResolvedValue(null) } }),
    );
    const repository = new DownloadsRepository({
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(repository.claimNextQueued(startedAt)).resolves.toBeNull();
  });

  it("lists recoverable running and canceling tasks in deterministic order", async () => {
    const findMany = jest.fn().mockResolvedValue([
      stored({ status: "RUNNING" }),
      stored({ id: "download-2", status: "CANCELING" }),
    ]);
    const repository = new DownloadsRepository({
      bookDownload: { findMany },
    } as unknown as PrismaService);

    await expect(repository.findRecoverable()).resolves.toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith({
      where: { status: { in: ["RUNNING", "CANCELING"] } },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      include: { book: true },
    });
  });

  it("uses conditional state updates for cancellation", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = jest
      .fn()
      .mockResolvedValue(stored({ status: "CANCELED", finishedAt: startedAt }));
    const repository = new DownloadsRepository({
      bookDownload: { updateMany, findUniqueOrThrow },
    } as unknown as PrismaService);

    await expect(
      repository.cancelQueued("download-1", startedAt),
    ).resolves.toMatchObject({ status: "CANCELED" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "download-1", status: "QUEUED" },
      data: { status: "CANCELED", finishedAt: startedAt },
    });
  });

  it("persists successful artifact metadata as one terminal transition", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = jest.fn().mockResolvedValue(
      stored({
        status: "SUCCEEDED",
        artifactPath: "download-1.txt",
        artifactFilename: "测试小说.txt",
        artifactSizeBytes: 123,
        artifactSha256: "abc",
        finishedAt: startedAt,
      }),
    );
    const repository = new DownloadsRepository({
      bookDownload: { updateMany, findUniqueOrThrow },
    } as unknown as PrismaService);

    await expect(
      repository.succeed("download-1", {
        artifactPath: "download-1.txt",
        filename: "测试小说.txt",
        sizeBytes: 123,
        sha256: "abc",
        finishedAt: startedAt,
      }),
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "download-1", status: { in: ["RUNNING", "CANCELING"] } },
      data: {
        status: "SUCCEEDED",
        artifactPath: "download-1.txt",
        artifactFilename: "测试小说.txt",
        artifactSizeBytes: 123,
        artifactSha256: "abc",
        errorCode: null,
        errorMessage: null,
        finishedAt: startedAt,
      },
    });
  });

  it("deletes only terminal tasks", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const repository = new DownloadsRepository({
      bookDownload: { deleteMany },
    } as unknown as PrismaService);

    await expect(repository.deleteTerminal("download-1")).resolves.toBe(true);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: "download-1",
        status: { in: ["SUCCEEDED", "FAILED", "CANCELED"] },
      },
    });
  });
});
