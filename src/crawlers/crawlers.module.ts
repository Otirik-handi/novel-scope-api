import { Module } from "@nestjs/common";
import { CrawlersService } from "./crawlers.service";
import { FanqieModule } from "./fanqie/fanqie.module";
import { QidianModule } from "./qidian/qidian.module";

@Module({
  imports: [QidianModule, FanqieModule],
  providers: [CrawlersService],
  exports: [CrawlersService],
})
export class CrawlersModule {}
