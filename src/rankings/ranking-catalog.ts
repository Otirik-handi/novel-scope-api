import { Platform } from './domain/ranking.types';

export const QIDIAN_RANK_PATHS: Readonly<Record<string, string>> = {
  hotsales: '/rank/hotsales/',
  yuepiao: '/rank/yuepiao/',
  recom: '/rank/rec/',
  collect: '/rank/newfans/',
};

export const JJWXC_ORDER_STRINGS: Readonly<Record<string, string>> = {
  income: '12',
  monthly: '7',
  quarterly: '8',
  completed: '14',
  newcomer: '15',
  thousandWords: '17',
};

export function isSupportedRank(platform: Platform, rank: string): boolean {
  const ranks = platform === 'qidian' ? QIDIAN_RANK_PATHS : JJWXC_ORDER_STRINGS;
  return Object.hasOwn(ranks, rank);
}
