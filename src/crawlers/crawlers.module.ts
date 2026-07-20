import { Module } from "@nestjs/common";
import { CrawlersService } from "./crawlers.service";
import { QidianModule } from "./qidian/qidian.module";

@Module({
  imports: [QidianModule],
  providers: [CrawlersService],
  exports: [CrawlersService],
})
export class CrawlersModule {}
