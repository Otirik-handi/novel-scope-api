import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { BookDetailStoreService } from './book-detail-store.service';
import { BookDetailSnapshot } from './domain/book-detail.types';
import { QidianBookDetailProvider } from './providers/qidian-book-detail.provider';

const TTL_MS = 10 * 60 * 1000;
export const BOOK_DETAILS_CLOCK = Symbol('BOOK_DETAILS_CLOCK');

@Injectable()
export class BookDetailsService {
  private readonly cache = new Map<string, BookDetailSnapshot>();
  private readonly pending = new Map<string, Promise<BookDetailSnapshot>>();

  constructor(
    @Inject(BookDetailStoreService)
    private readonly store: Pick<BookDetailStoreService, 'read' | 'write'>,
    @Inject(QidianBookDetailProvider)
    private readonly provider: Pick<QidianBookDetailProvider, 'fetch'>,
    @Inject(BOOK_DETAILS_CLOCK) private readonly now: () => Date,
  ) {}

  async get(bookId: string): Promise<BookDetailSnapshot> {
    const previous = this.cache.get(bookId) ?? await this.store.read(bookId);
    if (previous && !this.isExpired(previous)) {
      this.cache.set(bookId, previous);
      return previous;
    }
    return this.fetch(bookId, previous);
  }

  async refresh(bookId: string): Promise<BookDetailSnapshot> {
    return this.fetch(bookId, this.cache.get(bookId) ?? await this.store.read(bookId));
  }

  private fetch(bookId: string, previous?: BookDetailSnapshot): Promise<BookDetailSnapshot> {
    const pending = this.pending.get(bookId);
    if (pending) return pending;
    const request = this.fetchAndPersist(bookId, previous)
      .finally(() => this.pending.delete(bookId));
    this.pending.set(bookId, request);
    return request;
  }

  private async fetchAndPersist(
    bookId: string,
    previous?: BookDetailSnapshot,
  ): Promise<BookDetailSnapshot> {
    let snapshot: BookDetailSnapshot;
    try {
      snapshot = await this.provider.fetch(bookId);
    } catch (error: unknown) {
        if (previous) return { ...previous, status: 'stale' as const, lastError: error instanceof Error ? error.message : String(error) };
        throw new BadGatewayException({ code: 'BOOK_DETAIL_UNAVAILABLE', bookId });
    }

    await this.store.write(snapshot);
    this.cache.set(bookId, snapshot);
    return snapshot;
  }

  private isExpired(snapshot: BookDetailSnapshot): boolean {
    return this.now().getTime() - new Date(snapshot.fetchedAt).getTime() > TTL_MS;
  }
}
