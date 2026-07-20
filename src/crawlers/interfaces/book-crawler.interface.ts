import type { Platform } from "../../shared/types/platform.type";
import type { CrawlerJsonObject } from "./crawler-json.type";

export interface CrawledBook {
  platform: Platform;
  externalBookId: string;
  title: string;
  author: string;
  description: string | null;
  coverUrl: string | null;
  genres: string[];
  bookStatus: string | null;
  wordCount: number | null;
  metadata: CrawlerJsonObject;
  sourceUrl: string;
  fetchedAt: Date;
}

export interface BookCrawler {
  crawl(externalBookId: string): Promise<CrawledBook>;
}
