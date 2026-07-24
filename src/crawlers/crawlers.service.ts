import { Injectable } from "@nestjs/common";
import type { Platform } from "../shared/types/platform.type";
import type {
  BookCrawler,
  RankingCatalog,
  RankingCrawler,
} from "./interfaces";
import { QidianBookCrawler } from "./qidian/books/qidian-book.crawler";
import { QidianRankingCatalog } from "./qidian/rankings/qidian-ranking.catalog";
import { QidianRankingCrawler } from "./qidian/rankings/qidian-ranking.crawler";

@Injectable()
export class CrawlersService {
  constructor(
    private readonly qidianRankingCrawler: QidianRankingCrawler,
    private readonly qidianBookCrawler: QidianBookCrawler,
    private readonly qidianRankingCatalog: QidianRankingCatalog,
  ) {}

  getRankingCatalog(platform: Platform): RankingCatalog {
    switch (platform) {
      case "qidian":
        return this.qidianRankingCatalog;
      default:
        return this.unsupportedPlatform(platform);
    }
  }

  getRankingCrawler(platform: Platform): RankingCrawler {
    switch (platform) {
      case "qidian":
        return this.qidianRankingCrawler;
      default:
        return this.unsupportedPlatform(platform);
    }
  }

  getBookCrawler(platform: Platform): BookCrawler {
    switch (platform) {
      case "qidian":
        return this.qidianBookCrawler;
      default:
        return this.unsupportedPlatform(platform);
    }
  }

  private unsupportedPlatform(platform: Platform): never {
    throw new Error(`Unsupported crawler platform: ${String(platform)}`);
  }
}
