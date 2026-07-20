import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: 404 })
  statusCode!: number;

  @ApiProperty({ example: 'RANKING_SNAPSHOT_NOT_FOUND' })
  code!: string;

  @ApiProperty({ example: '当前榜单没有可用的成功快照' })
  message!: string;

  @ApiProperty({ example: '7f455d68-b5fa-42c4-950d-8c5fb8d8be70' })
  requestId!: string;

  @ApiPropertyOptional({ type: [String] })
  details?: string[];
}

export class RankingItemResponseDto {
  @ApiProperty({ example: 1 })
  rank!: number;

  @ApiProperty({ example: '1035420986' })
  bookId!: string;

  @ApiProperty({ example: '玄鉴仙族' })
  title!: string;

  @ApiProperty({ example: '季越人' })
  author!: string;

  @ApiProperty({ type: [String], example: [] })
  genres!: string[];

  @ApiProperty({ type: String, nullable: true, example: null })
  status!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: null })
  wordCount!: number | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  description!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, example: { monthCount: 25416 } })
  metrics!: Record<string, string | number>;

  @ApiProperty({ example: 'https://www.qidian.com/book/1035420986/' })
  url!: string;
}

export class RankingSnapshotResponseDto {
  @ApiPropertyOptional({ format: 'uuid' })
  id?: string;

  @ApiProperty({ enum: ['qidian'] })
  platform!: 'qidian';

  @ApiProperty({ enum: ['hotsales', 'yuepiao', 'recom', 'collect'] })
  rank!: 'hotsales' | 'yuepiao' | 'recom' | 'collect';

  @ApiProperty({ type: String, nullable: true, example: null })
  channel!: string | null;

  @ApiProperty({ example: 'https://www.qidian.com/rank/hotsales/' })
  sourceUrl!: string;

  @ApiProperty({ format: 'date-time', example: '2026-07-18T07:34:48.339Z' })
  fetchedAt!: string;

  @ApiProperty({ enum: ['fresh', 'stale'], example: 'fresh' })
  status!: 'fresh' | 'stale';

  @ApiPropertyOptional({ example: 'UPSTREAM_ERROR' })
  lastError?: string;

  @ApiProperty({ type: () => [RankingItemResponseDto] })
  items!: RankingItemResponseDto[];
}

export class RankingHistoryResponseDto {
  @ApiProperty({ type: () => [RankingSnapshotResponseDto] })
  items!: RankingSnapshotResponseDto[];

  @ApiProperty({ type: String, nullable: true, example: null })
  nextCursor!: string | null;
}

export class RefreshResultItemDto {
  @ApiProperty({ enum: ['hotsales', 'yuepiao', 'recom', 'collect'] })
  rankType!: string;

  @ApiProperty({ enum: ['success', 'failed', 'skipped'] })
  status!: 'success' | 'failed' | 'skipped';

  @ApiPropertyOptional({ format: 'uuid' })
  snapshotId?: string;

  @ApiPropertyOptional({ example: 'REFRESH_IN_PROGRESS' })
  errorCode?: string;
}

export class PlatformRefreshResponseDto {
  @ApiProperty({ type: () => [RefreshResultItemDto] })
  results!: RefreshResultItemDto[];
}

export class BookDetailResponseDto {
  @ApiProperty({ example: '1035420986' })
  bookId!: string;

  @ApiProperty({ example: '玄鉴仙族' })
  title!: string;

  @ApiProperty({ example: '季越人' })
  author!: string;

  @ApiProperty({ type: [String], example: ['仙侠', '修真文明'] })
  genres!: string[];

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '连载' })
  bookStatus!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 6023613 })
  wordCount!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 158700 })
  totalRecCount!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 329 })
  chaptersNum!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 25416 })
  monthCount!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 5916 })
  recCount!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 23 })
  rewardNum!: number | null;

  @ApiProperty({ example: 'https://www.qidian.com/book/1035420986/' })
  sourceUrl!: string;

  @ApiProperty({ format: 'date-time', example: '2026-07-18T07:30:44.780Z' })
  fetchedAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-07-18T10:30:44.780Z' })
  expiresAt!: string;

  @ApiProperty({ enum: ['fresh', 'stale'] })
  status!: 'fresh' | 'stale';

  @ApiProperty({ type: String, nullable: true, example: null })
  lastError!: string | null;

  @ApiProperty({ example: false })
  stale!: boolean;
}
