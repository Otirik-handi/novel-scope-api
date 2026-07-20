import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import appConfig from "./config/app.config";
import crawlerConfig from "./config/crawler.config";
import databaseConfig from "./config/database.config";
import { validateEnvironment } from "./config/env.validation";
import { DatabaseModule } from "./shared/database/database.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, crawlerConfig],
      validate: validateEnvironment,
    }),
    DatabaseModule,
  ],
})
export class AppModule {}
