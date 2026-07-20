export interface BookDetailSnapshot {
  bookId: string;
  title: string;
  author: string;
  genres: string[];
  description: string | null;
  bookStatus: string | null;
  wordCount: number | null;
  totalRecCount: number | null;
  chaptersNum: number | null;
  monthCount: number | null;
  recCount: number | null;
  rewardNum: number | null;
  sourceUrl: string;
  fetchedAt: string;
  expiresAt: string;
  status: 'fresh' | 'stale';
  lastError: string | null;
  stale: boolean;
}

export type FetchedBookDetail = Omit<BookDetailSnapshot, 'fetchedAt' | 'expiresAt' | 'status' | 'lastError' | 'stale'>;
