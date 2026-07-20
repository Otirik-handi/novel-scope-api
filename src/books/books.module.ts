import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import appConfig from "../config/app.config";
import { CrawlersModule } from "../crawlers/crawlers.module";
import { DatabaseModule } from "../shared/database/database.module";
import { BooksController } from "./books.controller";
import { BooksRepository } from "./books.repository";
import { BOOKS_CLOCK, BooksService } from "./books.service";

@Module({
  imports: [ConfigModule.forFeature(appConfig), CrawlersModule, DatabaseModule],
  controllers: [BooksController],
  providers: [
    BooksRepository,
    BooksService,
    { provide: BOOKS_CLOCK, useValue: { now: () => new Date() } },
  ],
  exports: [BooksService],
})
export class BooksModule {}
