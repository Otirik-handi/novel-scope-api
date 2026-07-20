import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import appConfig from "../config/app.config";
import { CrawlersModule } from "../crawlers/crawlers.module";
import { DatabaseModule } from "../shared/database/database.module";
import { RankingsController } from "./rankings.controller";
import { RankingsRepository } from "./rankings.repository";
import { RankingsScheduler } from "./rankings.scheduler";
import { RankingsService } from "./rankings.service";

@Module({
  imports: [
    ConfigModule.forFeature(appConfig),
    ScheduleModule.forRoot(),
    CrawlersModule,
    DatabaseModule,
  ],
  controllers: [RankingsController],
  providers: [RankingsRepository, RankingsService, RankingsScheduler],
  exports: [RankingsService],
})
export class RankingsModule {}
