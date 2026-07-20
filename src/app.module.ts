import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import appConfig from "./config/app.config";
import crawlerConfig from "./config/crawler.config";
import databaseConfig from "./config/database.config";
import { validateEnvironment } from "./config/env.validation";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, crawlerConfig],
      validate: validateEnvironment,
    }),
  ],
})
export class AppModule {}
