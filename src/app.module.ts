import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BooksModule } from "./books/books.module";
import appConfig from "./config/app.config";
import crawlerConfig from "./config/crawler.config";
import databaseConfig from "./config/database.config";
import downloadConfig from "./config/download.config";
import { validateEnvironment } from "./config/env.validation";
import { RankingsModule } from "./rankings/rankings.module";
import { DatabaseModule } from "./shared/database/database.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, crawlerConfig, downloadConfig],
      validate: validateEnvironment,
    }),
    DatabaseModule,
    RankingsModule,
    BooksModule,
  ],
})
export class AppModule {}
