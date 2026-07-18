export type Platform = 'qidian' | 'jjwxc';

export interface RankingKey {
  platform: Platform;
  rank: string;
  channel: string | null;
}

export interface RankingItem {
  rank: number;
  bookId: string;
  title: string;
  author: string;
  genres: string[];
  status: string | null;
  wordCount: number | null;
  description: string | null;
  metrics: Record<string, string | number>;
  url: string;
}

export interface RankingSnapshot extends RankingKey {
  id?: string;
  sourceUrl: string;
  fetchedAt: string;
  status: 'fresh' | 'stale';
  lastError?: string;
  items: RankingItem[];
}
