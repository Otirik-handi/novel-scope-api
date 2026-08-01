import { Module } from "@nestjs/common";
import { CrawlersService } from "./crawlers.service";
import { FanqieModule } from "./fanqie/fanqie.module";
import { QidianChapterCrawler } from "./qidian/chapters/qidian-chapter.crawler";
import { QidianModule } from "./qidian/qidian.module";

@Module({
  imports: [QidianModule, FanqieModule],
  providers: [CrawlersService],
  exports: [CrawlersService, QidianChapterCrawler],
})
export class CrawlersModule {}
