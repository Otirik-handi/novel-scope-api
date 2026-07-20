import { Platform, RankingKey, RankingSnapshot } from './ranking.types';

export interface RankingProvider {
  readonly platform: Platform;
  fetch(key: RankingKey): Promise<RankingSnapshot>;
}
