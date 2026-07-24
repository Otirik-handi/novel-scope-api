import { Injectable } from "@nestjs/common";
import type {
  RankingCatalog,
  RankingDefinition,
} from "../../interfaces";
import {
  FANQIE_CATEGORIES_BY_CHANNEL,
  FANQIE_CHANNELS,
  FANQIE_RANKING_TYPES,
} from "../fanqie.constants";

export interface FanqieCategoryConfig {
  readonly id: string;
  readonly name: string;
}

export interface FanqieRankingCatalogConfig {
  readonly channels: Readonly<Record<string, string>>;
  readonly rankingTypes: Readonly<Record<string, string>>;
  readonly categoriesByChannel: Readonly<
    Record<string, readonly FanqieCategoryConfig[]>
  >;
}

const DEFAULT_CONFIG: FanqieRankingCatalogConfig = {
  channels: FANQIE_CHANNELS,
  rankingTypes: FANQIE_RANKING_TYPES,
  categoriesByChannel: FANQIE_CATEGORIES_BY_CHANNEL,
};

const ALLOWED_CHANNELS = new Set(["0", "1"]);
const ALLOWED_RANKING_TYPES = new Set(["1", "2"]);

export class FanqieRankingCatalogError extends Error {
  override readonly name = "FanqieRankingCatalogError";
}

@Injectable()
export class FanqieRankingCatalog implements RankingCatalog {
  private readonly definitions: readonly RankingDefinition[];
  private readonly definitionsByKey: ReadonlyMap<string, RankingDefinition>;

  constructor(config: FanqieRankingCatalogConfig = DEFAULT_CONFIG) {
    const definitions = this.buildDefinitions(config);
    this.definitions = Object.freeze(
      definitions.map((definition) => Object.freeze(definition)),
    );
    this.definitionsByKey = new Map(
      this.definitions.map((definition) => [
        definition.rankTypeKey,
        definition,
      ]),
    );
  }

  list(): readonly RankingDefinition[] {
    return this.definitions;
  }

  resolve(rankTypeKey: string): RankingDefinition | null {
    return this.definitionsByKey.get(rankTypeKey) ?? null;
  }

  private buildDefinitions(
    config: FanqieRankingCatalogConfig,
  ): RankingDefinition[] {
    const channelEntries = Object.entries(config.channels);
    const rankingTypeEntries = Object.entries(config.rankingTypes);

    this.assertExactKeys(channelEntries, ALLOWED_CHANNELS, "channel");
    this.assertExactKeys(rankingTypeEntries, ALLOWED_RANKING_TYPES, "type");

    const configuredCategoryChannels = Object.keys(config.categoriesByChannel);
    this.assertExactKeys(
      configuredCategoryChannels.map((channel) => [channel, channel]),
      ALLOWED_CHANNELS,
      "category channel",
    );

    const definitions: RankingDefinition[] = [];
    const generatedKeys = new Set<string>();
    const generatedNames = new Set<string>();

    for (const [channel, rawChannelName] of channelEntries) {
      const channelName = this.requireName(rawChannelName, "channel name");
      const categories = config.categoriesByChannel[channel];

      if (!Array.isArray(categories) || categories.length === 0) {
        throw new FanqieRankingCatalogError(
          `Fanqie channel ${channel} must contain categories`,
        );
      }

      const categoryIds = new Set<string>();
      const categoryNames = new Set<string>();

      for (const category of categories) {
        if (typeof category.id !== "string" || !/^\d+$/.test(category.id)) {
          throw new FanqieRankingCatalogError(
            `Fanqie category ID must be numeric for channel ${channel}`,
          );
        }

        const categoryName = this.requireName(
          category.name,
          `category name for ${channel}/${category.id}`,
        );

        if (categoryIds.has(category.id) || categoryNames.has(categoryName)) {
          throw new FanqieRankingCatalogError(
            `Duplicate Fanqie category in channel ${channel}`,
          );
        }

        categoryIds.add(category.id);
        categoryNames.add(categoryName);

        for (const [type, rawTypeName] of rankingTypeEntries) {
          const typeName = this.requireName(rawTypeName, "ranking type name");
          const rankTypeKey = `${channel}_${type}_${category.id}`;
          const rankType = `${channelName}-${typeName}-${categoryName}`;

          if (
            generatedKeys.has(rankTypeKey) ||
            generatedNames.has(rankType)
          ) {
            throw new FanqieRankingCatalogError(
              "Duplicate generated Fanqie ranking definition",
            );
          }

          generatedKeys.add(rankTypeKey);
          generatedNames.add(rankType);
          definitions.push({ platform: "fanqie", rankTypeKey, rankType });
        }
      }
    }

    return definitions;
  }

  private assertExactKeys(
    entries: readonly (readonly [string, unknown])[],
    allowed: ReadonlySet<string>,
    label: string,
  ): void {
    const keys = entries.map(([key]) => key);

    if (
      keys.length !== allowed.size ||
      keys.some((key) => !allowed.has(key)) ||
      [...allowed].some((key) => !keys.includes(key))
    ) {
      throw new FanqieRankingCatalogError(
        `Invalid Fanqie ${label} configuration`,
      );
    }
  }

  private requireName(value: unknown, label: string): string {
    if (typeof value !== "string" || value.trim() === "") {
      throw new FanqieRankingCatalogError(`Invalid Fanqie ${label}`);
    }

    return value.trim();
  }
}
