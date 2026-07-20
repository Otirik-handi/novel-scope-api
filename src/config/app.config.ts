import { registerAs } from "@nestjs/config";

export default registerAs("app", () => ({
  port: Number(process.env.PORT),
  bookDetailTtlHours: Number(process.env.BOOK_DETAIL_TTL_HOURS),
  rankingRefreshCron: process.env.RANKING_REFRESH_CRON as string,
  rankingRefreshTimeZone: process.env.RANKING_REFRESH_TIME_ZONE as string,
}));
