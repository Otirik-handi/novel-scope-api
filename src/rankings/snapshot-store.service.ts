import { Inject, Injectable, Optional } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RankingKey, RankingSnapshot } from './domain/ranking.types';

export const SNAPSHOT_DIR = Symbol('SNAPSHOT_DIR');

@Injectable()
export class SnapshotStoreService {
  constructor(
    @Optional() @Inject(SNAPSHOT_DIR) snapshotDir?: string,
  ) {
    this.snapshotDir =
      snapshotDir ?? process.env.SNAPSHOT_DIR ?? join(process.cwd(), 'data', 'snapshots');
  }

  private readonly snapshotDir: string;

  async read(key: RankingKey): Promise<RankingSnapshot | undefined> {
    try {
      const contents = await readFile(this.snapshotPath(key), 'utf8');
      return JSON.parse(contents) as RankingSnapshot;
    } catch (error: unknown) {
      if (this.isMissingFileError(error)) {
        return undefined;
      }

      throw error;
    }
  }

  async write(snapshot: RankingSnapshot): Promise<void> {
    await mkdir(this.snapshotDir, { recursive: true });

    const destination = this.snapshotPath(snapshot);
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot), 'utf8');
    await rename(temporary, destination);
  }

  private snapshotPath(key: RankingKey): string {
    const channel = key.channel ?? 'default';
    return join(this.snapshotDir, `${key.platform}--${key.rank}--${channel}.json`);
  }

  private isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    );
  }
}
