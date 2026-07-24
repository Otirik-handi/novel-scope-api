import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { CrawlersService } from "../crawlers/crawlers.service";
import type {
  CrawledRanking,
  RankingDefinition,
} from "../crawlers/interfaces";
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
    rankTypeKey: string,
  ): Promise<RankingSnapshot> {
    const definition = this.resolveDefinition(platform, rankTypeKey);
    const snapshot = await this.repository.findLatest(
      platform,
      definition.rankTypeKey,
    );

    if (snapshot === null) {
      throw new NotFoundException("Ranking snapshot not found");
    }

    return snapshot;
  }

  async refresh(
    platform: Platform,
    rankTypeKey: string,
  ): Promise<RankingSnapshot> {
    const definition = this.resolveDefinition(platform, rankTypeKey);
    const crawler = this.crawlersService.getRankingCrawler(platform);
    const ranking = await crawler.crawl(definition.rankTypeKey);

    this.assertCompleteRanking(ranking, definition);

    return this.repository.saveSnapshot(ranking);
  }

  async refreshAll(platform: Platform): Promise<RankingRefreshResult[]> {
    const definitions = this.crawlersService
      .getRankingCatalog(platform)
      .list();
    const results: RankingRefreshResult[] = [];

    for (const definition of definitions) {
      try {
        const snapshot = await this.refresh(
          platform,
          definition.rankTypeKey,
        );
        results.push({
          rankTypeKey: definition.rankTypeKey,
          rankType: definition.rankType,
          success: true,
          snapshot,
        });
      } catch (error) {
        this.logger.error(
          `Failed to refresh ranking ${platform}/${definition.rankTypeKey}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        results.push({
          rankTypeKey: definition.rankTypeKey,
          rankType: definition.rankType,
          success: false,
          error: RANKING_REFRESH_FAILED,
        });
      }
    }

    return results;
  }

  private resolveDefinition(
    platform: Platform,
    rankTypeKey: string,
  ): RankingDefinition {
    const definition = this.crawlersService
      .getRankingCatalog(platform)
      .resolve(rankTypeKey);

    if (definition === null || definition.platform !== platform) {
      throw new BadRequestException("Unsupported ranking type key");
    }

    return definition;
  }

  private assertCompleteRanking(
    ranking: CrawledRanking,
    definition: RankingDefinition,
  ): void {
    if (
      ranking.platform !== definition.platform ||
      ranking.rankTypeKey !== definition.rankTypeKey ||
      ranking.rankType !== definition.rankType
    ) {
      throw new RankingIntegrityError(
        "Crawler returned a ranking for a different platform or rank type",
      );
    }

    if (!this.isNonEmptyString(ranking.sourceUrl)) {
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
        !this.isNonEmptyString(item.externalBookId) ||
        !this.isNonEmptyString(item.title) ||
        !this.isNonEmptyString(item.author) ||
        !this.isNonEmptyString(item.sourceUrl)
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

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim() !== "";
  }
}
