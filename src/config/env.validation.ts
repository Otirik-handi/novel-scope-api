import { plainToInstance, Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, IsUrl, Min, validateSync } from 'class-validator';

class EnvironmentVariables {
  @IsString() @IsNotEmpty() @IsUrl({ protocols: ['postgresql', 'postgres'], require_tld: false }) DATABASE_URL!: string;
  @IsString() @IsNotEmpty() REFRESH_API_KEY!: string;
  @IsString() @IsNotEmpty() QIDIAN_USER_AGENT!: string;
  @Transform(({ value }) => Number(value ?? 3)) @IsInt() @Min(1) BOOK_DETAIL_TTL_HOURS!: number;
  @Transform(({ value }) => Number(value ?? 90)) @IsInt() @Min(1) CRAWL_LOG_RETENTION_DAYS!: number;
  @Transform(({ value }) => Number(value ?? 10_000)) @IsInt() @Min(1) HTTP_TIMEOUT_MS!: number;
  @Transform(({ value }) => Number(value ?? 2)) @IsInt() @Min(0) HTTP_RETRIES!: number;
  @Transform(({ value }) => Number(value ?? 2)) @IsInt() @Min(1) QIDIAN_MAX_CONCURRENCY!: number;
  @Transform(({ value }) => Number(value ?? 1_000)) @IsInt() @Min(0) QIDIAN_MIN_REQUEST_INTERVAL_MS!: number;
  @Transform(({ value }) => Number(value ?? 35_000)) @IsInt() @Min(1) BOOK_DETAIL_REFRESH_TIMEOUT_MS!: number;
}

export interface AppEnvironment {
  databaseUrl: string; refreshApiKey: string; qidianUserAgent: string; bookDetailTtlHours: number;
  crawlLogRetentionDays: number; httpTimeoutMs: number; httpRetries: number; qidianMaxConcurrency: number;
  qidianMinRequestIntervalMs: number; bookDetailRefreshTimeoutMs: number;
}

export function validateEnvironment(config: Record<string, unknown>): AppEnvironment {
  const environment = plainToInstance(EnvironmentVariables, {
    BOOK_DETAIL_TTL_HOURS: 3, CRAWL_LOG_RETENTION_DAYS: 90, HTTP_TIMEOUT_MS: 10_000,
    HTTP_RETRIES: 2, QIDIAN_MAX_CONCURRENCY: 2, QIDIAN_MIN_REQUEST_INTERVAL_MS: 1_000,
    BOOK_DETAIL_REFRESH_TIMEOUT_MS: 35_000, ...config,
  }, { enableImplicitConversion: false });
  if (validateSync(environment, { skipMissingProperties: false }).length > 0) {
    throw new Error('Invalid environment configuration');
  }
  return {
    databaseUrl: environment.DATABASE_URL, refreshApiKey: environment.REFRESH_API_KEY,
    qidianUserAgent: environment.QIDIAN_USER_AGENT, bookDetailTtlHours: environment.BOOK_DETAIL_TTL_HOURS,
    crawlLogRetentionDays: environment.CRAWL_LOG_RETENTION_DAYS, httpTimeoutMs: environment.HTTP_TIMEOUT_MS,
    httpRetries: environment.HTTP_RETRIES, qidianMaxConcurrency: environment.QIDIAN_MAX_CONCURRENCY,
    qidianMinRequestIntervalMs: environment.QIDIAN_MIN_REQUEST_INTERVAL_MS,
    bookDetailRefreshTimeoutMs: environment.BOOK_DETAIL_REFRESH_TIMEOUT_MS,
  };
}
