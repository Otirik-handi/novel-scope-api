import { Injectable } from "@nestjs/common";
import type { Platform } from "../shared/types/platform.type";
import type { BookCrawler, RankingCrawler } from "./interfaces";
import { QidianBookCrawler } from "./qidian/books/qidian-book.crawler";
import { QidianRankingCrawler } from "./qidian/rankings/qidian-ranking.crawler";

@Injectable()
export class CrawlersService {
  constructor(
    private readonly qidianRankingCrawler: QidianRankingCrawler,
    private readonly qidianBookCrawler: QidianBookCrawler,
  ) {}

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

  private unsupportedPlatform(platform: never): never {
    throw new Error(`Unsupported crawler platform: ${String(platform)}`);
  }
}
