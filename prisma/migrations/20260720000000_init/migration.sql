-- CreateTable
CREATE TABLE "Book" (
    "id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "externalBookId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Book_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookDetail" (
    "bookId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "description" TEXT,
    "coverUrl" TEXT,
    "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bookStatus" TEXT,
    "wordCount" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sourceUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BookDetail_pkey" PRIMARY KEY ("bookId")
);

-- CreateTable
CREATE TABLE "RankingSnapshot" (
    "id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "rankType" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankingSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingItem" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "externalBookId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "coverUrl" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "RankingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Book_platform_externalBookId_key" ON "Book"("platform", "externalBookId");

-- CreateIndex
CREATE INDEX "RankingSnapshot_platform_rankType_fetchedAt_idx" ON "RankingSnapshot"("platform", "rankType", "fetchedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "RankingItem_snapshotId_rank_key" ON "RankingItem"("snapshotId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "RankingItem_snapshotId_externalBookId_key" ON "RankingItem"("snapshotId", "externalBookId");

-- CreateIndex
CREATE INDEX "RankingItem_bookId_idx" ON "RankingItem"("bookId");

-- AddForeignKey
ALTER TABLE "BookDetail" ADD CONSTRAINT "BookDetail_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingItem" ADD CONSTRAINT "RankingItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RankingSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingItem" ADD CONSTRAINT "RankingItem_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
