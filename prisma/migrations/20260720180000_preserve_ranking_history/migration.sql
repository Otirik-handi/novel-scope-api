-- DropForeignKey
ALTER TABLE "RankingItem" DROP CONSTRAINT "RankingItem_bookId_fkey";

-- AddForeignKey
ALTER TABLE "RankingItem" ADD CONSTRAINT "RankingItem_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "Book"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
