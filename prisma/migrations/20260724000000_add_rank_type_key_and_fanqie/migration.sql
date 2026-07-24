ALTER TABLE "RankingSnapshot" ADD COLUMN "rankTypeKey" TEXT;

UPDATE "RankingSnapshot"
SET "rankTypeKey" = "rankType"
WHERE "platform" = 'qidian'
  AND "rankType" IN ('yuepiao', 'hotsales', 'recom', 'collect');

UPDATE "RankingSnapshot"
SET "rankType" = CASE "rankType"
  WHEN 'yuepiao' THEN '月票榜'
  WHEN 'hotsales' THEN '畅销榜'
  WHEN 'recom' THEN '推荐榜'
  WHEN 'collect' THEN '收藏榜'
END
WHERE "platform" = 'qidian'
  AND "rankType" IN ('yuepiao', 'hotsales', 'recom', 'collect');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "RankingSnapshot" WHERE "rankTypeKey" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot backfill RankingSnapshot.rankTypeKey';
  END IF;
END $$;

ALTER TABLE "RankingSnapshot" ALTER COLUMN "rankTypeKey" SET NOT NULL;
DROP INDEX "RankingSnapshot_platform_rankType_fetchedAt_idx";
CREATE INDEX "RankingSnapshot_platform_rankTypeKey_fetchedAt_idx"
  ON "RankingSnapshot"("platform", "rankTypeKey", "fetchedAt" DESC);
