CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "books" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "platform" TEXT NOT NULL, "external_book_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "books_platform_external_book_id_key" ON "books"("platform", "external_book_id");

CREATE TABLE "book_details" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "book_id" UUID NOT NULL, "title" TEXT NOT NULL, "author" TEXT NOT NULL,
  "genres" JSONB NOT NULL DEFAULT '[]', "description" TEXT, "book_status" TEXT, "word_count" INTEGER,
  "total_rec_count" INTEGER, "chapters_num" INTEGER, "month_count" INTEGER, "rec_count" INTEGER, "reward_num" INTEGER,
  "source_url" TEXT NOT NULL, "fetched_at" TIMESTAMPTZ(6) NOT NULL, "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "status" TEXT NOT NULL, "last_error" TEXT, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL, CONSTRAINT "book_details_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "book_details_book_id_key" ON "book_details"("book_id");
CREATE INDEX "book_details_expires_at_idx" ON "book_details"("expires_at");

CREATE TABLE "ranking_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "platform" TEXT NOT NULL, "rank_type" TEXT NOT NULL,
  "source_url" TEXT NOT NULL, "fetched_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "ranking_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ranking_snapshots_platform_rank_type_fetched_at_idx" ON "ranking_snapshots"("platform", "rank_type", "fetched_at" DESC);

CREATE TABLE "ranking_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "snapshot_id" UUID NOT NULL, "book_id" UUID,
  "external_book_id" TEXT NOT NULL, "rank" INTEGER NOT NULL, "title" TEXT NOT NULL, "author" TEXT NOT NULL,
  "metrics" JSONB NOT NULL DEFAULT '{}', "source_url" TEXT NOT NULL, CONSTRAINT "ranking_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ranking_items_snapshot_id_rank_key" ON "ranking_items"("snapshot_id", "rank");
CREATE UNIQUE INDEX "ranking_items_snapshot_id_external_book_id_key" ON "ranking_items"("snapshot_id", "external_book_id");
CREATE INDEX "ranking_items_book_id_idx" ON "ranking_items"("book_id");

CREATE TABLE "crawl_log" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "target_type" TEXT NOT NULL, "target_key" TEXT NOT NULL,
  "platform" TEXT NOT NULL, "started_at" TIMESTAMPTZ(6) NOT NULL, "finished_at" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL, "error_message" TEXT, "snapshot_id" UUID, CONSTRAINT "crawl_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "crawl_log_started_at_idx" ON "crawl_log"("started_at");
CREATE INDEX "crawl_log_platform_target_type_target_key_started_at_idx" ON "crawl_log"("platform", "target_type", "target_key", "started_at" DESC);

ALTER TABLE "book_details" ADD CONSTRAINT "book_details_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ranking_items" ADD CONSTRAINT "ranking_items_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "ranking_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ranking_items" ADD CONSTRAINT "ranking_items_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crawl_log" ADD CONSTRAINT "crawl_log_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "ranking_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
