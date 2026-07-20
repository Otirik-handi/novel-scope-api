import { Platform } from './domain/ranking.types';

export const QIDIAN_RANK_PATHS: Readonly<Record<string, string>> = {
  hotsales: '/rank/hotsales/',
  yuepiao: '/rank/yuepiao/',
  recom: '/rank/rec/',
  collect: '/rank/newfans/',
};

export function isSupportedRank(platform: Platform, rank: string): boolean {
  return platform === 'qidian' && Object.hasOwn(QIDIAN_RANK_PATHS, rank);
}
