import type { Platform } from "../../shared/types/platform.type";
import type { CrawlerJsonObject } from "./crawler-json.type";

export interface CrawledRankingItem {
  rank: number;
  externalBookId: string;
  title: string;
  author: string;
  coverUrl: string | null;
  sourceUrl: string;
  metrics: CrawlerJsonObject;
}

export interface CrawledRanking {
  platform: Platform;
  rankTypeKey: string;
  rankType: string;
  sourceUrl: string;
  fetchedAt: Date;
  items: CrawledRankingItem[];
}

export interface RankingCrawler {
  crawl(rankTypeKey: string): Promise<CrawledRanking>;
}
