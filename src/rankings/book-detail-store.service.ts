import { Inject, Injectable, Optional } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BookDetailSnapshot } from './domain/book-detail.types';
import { SNAPSHOT_DIR } from './snapshot-store.service';

@Injectable()
export class BookDetailStoreService {
  private readonly snapshotDir: string;

  constructor(@Optional() @Inject(SNAPSHOT_DIR) snapshotDir?: string) {
    this.snapshotDir = join(snapshotDir ?? process.env.SNAPSHOT_DIR ?? join(process.cwd(), 'data', 'snapshots'), 'books');
  }

  async read(bookId: string): Promise<BookDetailSnapshot | undefined> {
    try {
      return JSON.parse(await readFile(this.path(bookId), 'utf8')) as BookDetailSnapshot;
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async write(snapshot: BookDetailSnapshot): Promise<void> {
    await mkdir(this.snapshotDir, { recursive: true });
    const destination = this.path(snapshot.bookId);
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot), 'utf8');
    await rename(temporary, destination);
  }

  private path(bookId: string): string {
    return join(this.snapshotDir, `qidian--${bookId}.json`);
  }
}
