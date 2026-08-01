import { Injectable } from "@nestjs/common";
import {
  BookDownloadStatus,
  type Prisma,
} from "@prisma/client";
import { PrismaService } from "../shared/database/prisma.service";
import type { ChapterRange } from "./runners/book-download-runner.interface";

export type StoredBookDownload = Prisma.BookDownloadGetPayload<{
  include: { book: true };
}>;

export interface SuccessfulArtifactData {
  artifactPath: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  finishedAt: Date;
}

export interface FailedDownloadData {
  code: string;
  message: string;
  finishedAt: Date;
}

const INCLUDE_BOOK = { book: true } as const;
const ACTIVE_STATUSES = [
  BookDownloadStatus.RUNNING,
  BookDownloadStatus.CANCELING,
] as const;
const TERMINAL_STATUSES = [
  BookDownloadStatus.SUCCEEDED,
  BookDownloadStatus.FAILED,
  BookDownloadStatus.CANCELED,
] as const;

@Injectable()
export class DownloadsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createQueued(
    externalBookId: string,
    range: ChapterRange | null,
  ): Promise<StoredBookDownload> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.book.createMany({
        data: [{ platform: "fanqie", externalBookId }],
        skipDuplicates: true,
      });
      const book = await transaction.book.findUniqueOrThrow({
        where: {
          platform_externalBookId: { platform: "fanqie", externalBookId },
        },
        select: { id: true },
      });
      return transaction.bookDownload.create({
        data: {
          bookId: book.id,
          startChapter: range?.startChapter ?? null,
          endChapter: range?.endChapter ?? null,
        },
        include: INCLUDE_BOOK,
      });
    });
  }

  findById(id: string): Promise<StoredBookDownload | null> {
    return this.prisma.bookDownload.findUnique({
      where: { id },
      include: INCLUDE_BOOK,
    });
  }

  findByDownstreamJobId(
    downstreamJobId: string,
  ): Promise<StoredBookDownload | null> {
    return this.prisma.bookDownload.findFirst({
      where: { downstreamJobId, status: { in: [...ACTIVE_STATUSES] } },
      include: INCLUDE_BOOK,
    });
  }

  findRecoverable(): Promise<StoredBookDownload[]> {
    return this.prisma.bookDownload.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] } },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      include: INCLUDE_BOOK,
    });
  }

  async claimNextQueued(startedAt: Date): Promise<StoredBookDownload | null> {
    return this.prisma.$transaction(async (transaction) => {
      const candidate = await transaction.bookDownload.findFirst({
        where: { status: BookDownloadStatus.QUEUED },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      if (candidate === null) return null;
      const updated = await transaction.bookDownload.updateMany({
        where: { id: candidate.id, status: BookDownloadStatus.QUEUED },
        data: { status: BookDownloadStatus.RUNNING, startedAt },
      });
      if (updated.count !== 1) return null;
      return transaction.bookDownload.findUniqueOrThrow({
        where: { id: candidate.id },
        include: INCLUDE_BOOK,
      });
    });
  }

  async setDownstreamJobId(
    id: string,
    downstreamJobId: string,
  ): Promise<StoredBookDownload | null> {
    return this.updateActive(id, { downstreamJobId });
  }

  async updateProgress(
    id: string,
    progress: Prisma.InputJsonValue,
  ): Promise<StoredBookDownload | null> {
    return this.updateActive(id, { progress });
  }

  async cancelQueued(
    id: string,
    finishedAt: Date,
  ): Promise<StoredBookDownload | null> {
    return this.conditionalUpdate(
      id,
      { status: BookDownloadStatus.QUEUED },
      { status: BookDownloadStatus.CANCELED, finishedAt },
    );
  }

  async markCanceling(id: string): Promise<StoredBookDownload | null> {
    return this.conditionalUpdate(
      id,
      { status: BookDownloadStatus.RUNNING },
      { status: BookDownloadStatus.CANCELING },
    );
  }

  async markCanceled(
    id: string,
    finishedAt: Date,
  ): Promise<StoredBookDownload | null> {
    return this.conditionalUpdate(
      id,
      { status: { in: [...ACTIVE_STATUSES] } },
      { status: BookDownloadStatus.CANCELED, finishedAt },
    );
  }

  async succeed(
    id: string,
    artifact: SuccessfulArtifactData,
  ): Promise<StoredBookDownload | null> {
    return this.conditionalUpdate(
      id,
      { status: { in: [...ACTIVE_STATUSES] } },
      {
        status: BookDownloadStatus.SUCCEEDED,
        artifactPath: artifact.artifactPath,
        artifactFilename: artifact.filename,
        artifactSizeBytes: artifact.sizeBytes,
        artifactSha256: artifact.sha256,
        errorCode: null,
        errorMessage: null,
        finishedAt: artifact.finishedAt,
      },
    );
  }

  async fail(
    id: string,
    failure: FailedDownloadData,
  ): Promise<StoredBookDownload | null> {
    return this.conditionalUpdate(
      id,
      { status: { in: [...ACTIVE_STATUSES] } },
      {
        status: BookDownloadStatus.FAILED,
        errorCode: failure.code,
        errorMessage: failure.message,
        finishedAt: failure.finishedAt,
      },
    );
  }

  async deleteTerminal(id: string): Promise<boolean> {
    const result = await this.prisma.bookDownload.deleteMany({
      where: { id, status: { in: [...TERMINAL_STATUSES] } },
    });
    return result.count === 1;
  }

  private updateActive(
    id: string,
    data: Prisma.BookDownloadUpdateManyMutationInput,
  ): Promise<StoredBookDownload | null> {
    return this.conditionalUpdate(
      id,
      { status: { in: [...ACTIVE_STATUSES] } },
      data,
    );
  }

  private async conditionalUpdate(
    id: string,
    where: Prisma.BookDownloadWhereInput,
    data: Prisma.BookDownloadUpdateManyMutationInput,
  ): Promise<StoredBookDownload | null> {
    const updated = await this.prisma.bookDownload.updateMany({
      where: { id, ...where },
      data,
    });
    if (updated.count !== 1) return null;
    return this.prisma.bookDownload.findUniqueOrThrow({
      where: { id },
      include: INCLUDE_BOOK,
    });
  }
}
