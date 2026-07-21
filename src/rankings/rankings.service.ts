import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  RANK_TYPES,
  type CrawledRanking,
  type RankType,
} from "../crawlers/interfaces";
import { CrawlersService } from "../crawlers/crawlers.service";
import type { Platform } from "../shared/types/platform.type";
import type {
  RankingRefreshResult,
  RankingSnapshot,
} from "./interfaces/ranking.interface";
import { RankingsRepository } from "./rankings.repository";

export const RANKING_REFRESH_FAILED = "RANKING_REFRESH_FAILED";

export class RankingIntegrityError extends Error {
  override readonly name = "RankingIntegrityError";
}

@Injectable()
export class RankingsService {
  private readonly logger = new Logger(RankingsService.name);

  constructor(
    private readonly repository: RankingsRepository,
    private readonly crawlersService: CrawlersService,
  ) {}

  async getLatest(
    platform: Platform,
    rankType: RankType,
  ): Promise<RankingSnapshot> {
    const snapshot = await this.repository.findLatest(platform, rankType);

    if (snapshot === null) {
      throw new NotFoundException("Ranking snapshot not found");
    }

    return snapshot;
  }

  async refresh(
    platform: Platform,
    rankType: RankType,
  ): Promise<RankingSnapshot> {
    const crawler = this.crawlersService.getRankingCrawler(platform);
    const ranking = await crawler.crawl(rankType);

    this.assertCompleteRanking(ranking, platform, rankType);

    return this.repository.saveSnapshot(ranking);
  }

  async refreshAll(platform: Platform): Promise<RankingRefreshResult[]> {
    const results: RankingRefreshResult[] = [];

    for (const rankType of RANK_TYPES) {
      try {
        const snapshot = await this.refresh(platform, rankType);
        results.push({ rankType, success: true, snapshot });
      } catch {
        this.logger.error(`Failed to refresh ranking ${platform}/${rankType}`);
        results.push({
          rankType,
          success: false,
          error: RANKING_REFRESH_FAILED,
        });
      }
    }

    return results;
  }

  private assertCompleteRanking(
    ranking: CrawledRanking,
    platform: Platform,
    rankType: RankType,
  ): void {
    if (ranking.platform !== platform || ranking.rankType !== rankType) {
      throw new RankingIntegrityError(
        "Crawler returned a ranking for a different platform or rank type",
      );
    }

    if (
      typeof ranking.sourceUrl !== "string" ||
      ranking.sourceUrl.trim() === ""
    ) {
      throw new RankingIntegrityError("Ranking source URL is required");
    }

    if (ranking.items.length !== 10) {
      throw new RankingIntegrityError("Ranking must contain exactly 10 items");
    }

    const bookIds = new Set<string>();
    const ranks = new Set<number>();

    for (const item of ranking.items) {
      if (
        !Number.isInteger(item.rank) ||
        item.rank < 1 ||
        item.rank > 10 ||
        item.externalBookId.trim() === "" ||
        item.title.trim() === "" ||
        item.author.trim() === "" ||
        item.sourceUrl.trim() === ""
      ) {
        throw new RankingIntegrityError("Ranking contains an incomplete item");
      }

      bookIds.add(item.externalBookId);
      ranks.add(item.rank);
    }

    if (bookIds.size !== 10 || ranks.size !== 10) {
      throw new RankingIntegrityError(
        "Ranking must contain unique book IDs and ranks",
      );
    }
  }
}
