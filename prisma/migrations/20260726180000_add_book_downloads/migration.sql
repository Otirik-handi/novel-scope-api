-- CreateEnum
CREATE TYPE "BookDownloadStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'CANCELING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED'
);

-- CreateTable
CREATE TABLE "BookDownload" (
  "id" UUID NOT NULL,
  "bookId" UUID NOT NULL,
  "startChapter" INTEGER,
  "endChapter" INTEGER,
  "status" "BookDownloadStatus" NOT NULL DEFAULT 'QUEUED',
  "downstreamJobId" TEXT,
  "progress" JSONB NOT NULL DEFAULT '{}',
  "artifactPath" TEXT,
  "artifactFilename" TEXT,
  "artifactSizeBytes" INTEGER,
  "artifactSha256" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "BookDownload_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookDownload_chapter_range_check" CHECK (
    ("startChapter" IS NULL AND "endChapter" IS NULL)
    OR (
      "startChapter" IS NOT NULL
      AND "endChapter" IS NOT NULL
      AND "startChapter" >= 1
      AND "endChapter" >= "startChapter"
    )
  )
);

-- CreateIndex
CREATE INDEX "BookDownload_status_createdAt_idx"
  ON "BookDownload"("status", "createdAt");
CREATE INDEX "BookDownload_bookId_createdAt_idx"
  ON "BookDownload"("bookId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "BookDownload" ADD CONSTRAINT "BookDownload_bookId_fkey"
  FOREIGN KEY ("bookId") REFERENCES "Book"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
