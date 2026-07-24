import { CronTime } from "cron";

export const environmentDefaults = {
  PORT: 3000,
  QIDIAN_REQUEST_TIMEOUT_MS: 10_000,
  FANQIE_REQUEST_TIMEOUT_MS: 10_000,
  BOOK_DETAIL_TTL_HOURS: 3,
  RANKING_REFRESH_CRON: "0 0 6 * * *",
  FANQIE_RANKING_REFRESH_CRON: "0 30 0 * * *",
  RANKING_REFRESH_TIME_ZONE: "Asia/Shanghai",
} as const;

export interface AppEnvironmentVariables {
  PORT: number;
  BOOK_DETAIL_TTL_HOURS: number;
  RANKING_REFRESH_CRON: string;
  FANQIE_RANKING_REFRESH_CRON: string;
  RANKING_REFRESH_TIME_ZONE: string;
}

export interface DatabaseEnvironmentVariables {
  DATABASE_URL: string;
}

export interface CrawlerEnvironmentVariables {
  QIDIAN_USER_AGENT: string;
  QIDIAN_REQUEST_TIMEOUT_MS: number;
  FANQIE_REQUEST_TIMEOUT_MS: number;
}

export interface EnvironmentVariables
  extends AppEnvironmentVariables,
    DatabaseEnvironmentVariables,
    CrawlerEnvironmentVariables {}

function requireNonEmptyString(
  environment: Record<string, unknown>,
  key: string,
): string {
  const value = environment[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }

  return value.trim();
}

function readOptionalString(
  environment: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = environment[key];

  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }

  return value.trim();
}

function readPositiveInteger(
  environment: Record<string, unknown>,
  key: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const rawValue = environment[key];

  if (rawValue === undefined) {
    return fallback;
  }

  const normalizedValue =
    typeof rawValue === "number" ? String(rawValue) : rawValue;

  if (typeof normalizedValue !== "string" || !/^\d+$/.test(normalizedValue)) {
    throw new Error(`${key} must be a positive integer`);
  }

  const value = Number(normalizedValue);

  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${key} must be a positive integer`);
  }

  return value;
}

function validateCronExpression(key: string, value: string): void {
  try {
    new CronTime(value);
  } catch {
    throw new Error(`${key} must be a valid cron expression`);
  }
}

function validateTimeZone(value: string): void {
  if (value !== "UTC" && !value.includes("/")) {
    throw new Error("RANKING_REFRESH_TIME_ZONE must be a valid IANA time zone");
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new Error("RANKING_REFRESH_TIME_ZONE must be a valid IANA time zone");
  }
}

export function validateAppEnvironment(
  environment: Record<string, unknown>,
): AppEnvironmentVariables {
  const rankingRefreshCron = readOptionalString(
    environment,
    "RANKING_REFRESH_CRON",
    environmentDefaults.RANKING_REFRESH_CRON,
  );
  const rankingRefreshTimeZone = readOptionalString(
    environment,
    "RANKING_REFRESH_TIME_ZONE",
    environmentDefaults.RANKING_REFRESH_TIME_ZONE,
  );
  const fanqieRankingRefreshCron = readOptionalString(
    environment,
    "FANQIE_RANKING_REFRESH_CRON",
    environmentDefaults.FANQIE_RANKING_REFRESH_CRON,
  );

  validateCronExpression("RANKING_REFRESH_CRON", rankingRefreshCron);
  validateCronExpression(
    "FANQIE_RANKING_REFRESH_CRON",
    fanqieRankingRefreshCron,
  );
  validateTimeZone(rankingRefreshTimeZone);

  return {
    PORT: readPositiveInteger(
      environment,
      "PORT",
      environmentDefaults.PORT,
      65_535,
    ),
    BOOK_DETAIL_TTL_HOURS: readPositiveInteger(
      environment,
      "BOOK_DETAIL_TTL_HOURS",
      environmentDefaults.BOOK_DETAIL_TTL_HOURS,
    ),
    RANKING_REFRESH_CRON: rankingRefreshCron,
    FANQIE_RANKING_REFRESH_CRON: fanqieRankingRefreshCron,
    RANKING_REFRESH_TIME_ZONE: rankingRefreshTimeZone,
  };
}

export function validateDatabaseEnvironment(
  environment: Record<string, unknown>,
): DatabaseEnvironmentVariables {
  return {
    DATABASE_URL: requireNonEmptyString(environment, "DATABASE_URL"),
  };
}

export function validateCrawlerEnvironment(
  environment: Record<string, unknown>,
): CrawlerEnvironmentVariables {
  return {
    QIDIAN_USER_AGENT: requireNonEmptyString(environment, "QIDIAN_USER_AGENT"),
    QIDIAN_REQUEST_TIMEOUT_MS: readPositiveInteger(
      environment,
      "QIDIAN_REQUEST_TIMEOUT_MS",
      environmentDefaults.QIDIAN_REQUEST_TIMEOUT_MS,
      2_147_483_647,
    ),
    FANQIE_REQUEST_TIMEOUT_MS: readPositiveInteger(
      environment,
      "FANQIE_REQUEST_TIMEOUT_MS",
      environmentDefaults.FANQIE_REQUEST_TIMEOUT_MS,
      2_147_483_647,
    ),
  };
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): EnvironmentVariables {
  return {
    ...validateDatabaseEnvironment(environment),
    ...validateCrawlerEnvironment(environment),
    ...validateAppEnvironment(environment),
  };
}
