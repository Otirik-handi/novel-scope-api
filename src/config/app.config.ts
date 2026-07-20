import { registerAs } from "@nestjs/config";
import { validateAppEnvironment } from "./env.validation";

export default registerAs("app", () => {
  const environment = validateAppEnvironment(process.env);

  return {
    port: environment.PORT,
    bookDetailTtlHours: environment.BOOK_DETAIL_TTL_HOURS,
    rankingRefreshEnabled: process.env.NODE_ENV !== "test",
    rankingRefreshCron: environment.RANKING_REFRESH_CRON,
    rankingRefreshTimeZone: environment.RANKING_REFRESH_TIME_ZONE,
  };
});
