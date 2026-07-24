import { Injectable } from "@nestjs/common";
import type { Platform } from "../shared/types/platform.type";
import type {
  BookCrawler,
  RankingCatalog,
  RankingCrawler,
} from "./interfaces";
import { FanqieBookCrawler } from "./fanqie/books/fanqie-book.crawler";
import { FanqieRankingCatalog } from "./fanqie/rankings/fanqie-ranking.catalog";
import { FanqieRankingCrawler } from "./fanqie/rankings/fanqie-ranking.crawler";
import { QidianBookCrawler } from "./qidian/books/qidian-book.crawler";
import { QidianRankingCatalog } from "./qidian/rankings/qidian-ranking.catalog";
import { QidianRankingCrawler } from "./qidian/rankings/qidian-ranking.crawler";

@Injectable()
export class CrawlersService {
  constructor(
    private readonly qidianRankingCrawler: QidianRankingCrawler,
    private readonly qidianBookCrawler: QidianBookCrawler,
    private readonly qidianRankingCatalog: QidianRankingCatalog,
    private readonly fanqieRankingCrawler: FanqieRankingCrawler,
    private readonly fanqieBookCrawler: FanqieBookCrawler,
    private readonly fanqieRankingCatalog: FanqieRankingCatalog,
  ) {}

  getRankingCatalog(platform: Platform): RankingCatalog {
    switch (platform) {
      case "qidian":
        return this.qidianRankingCatalog;
      case "fanqie":
        return this.fanqieRankingCatalog;
      default:
        return this.unsupportedPlatform(platform);
    }
  }

  getRankingCrawler(platform: Platform): RankingCrawler {
    switch (platform) {
      case "qidian":
        return this.qidianRankingCrawler;
      case "fanqie":
        return this.fanqieRankingCrawler;
      default:
        return this.unsupportedPlatform(platform);
    }
  }

  getBookCrawler(platform: Platform): BookCrawler {
    switch (platform) {
      case "qidian":
        return this.qidianBookCrawler;
      case "fanqie":
        return this.fanqieBookCrawler;
      default:
        return this.unsupportedPlatform(platform);
    }
  }

  private unsupportedPlatform(platform: never): never {
    throw new Error(`Unsupported crawler platform: ${String(platform)}`);
  }
}
