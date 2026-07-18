export interface BookDetailSnapshot {
  bookId: string;
  title: string;
  author: string;
  genres: string[];
  description: string | null;
  bookStatus: string | null;
  wordCount: number | null;
  url: string;
  sourceUrl: string;
  fetchedAt: string;
  status: 'fresh' | 'stale';
  lastError?: string;
}
