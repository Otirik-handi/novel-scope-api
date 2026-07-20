import type { CrawledBook } from "../../crawlers/interfaces";

export interface StoredBookDetail extends CrawledBook {
  bookId: string;
  expiresAt: Date;
}

export interface BookDetailResource extends StoredBookDetail {
  stale: boolean;
}

export interface BooksClock {
  now(): Date;
}
