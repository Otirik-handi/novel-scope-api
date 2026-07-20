import { CronTime } from "cron";

export const environmentDefaults = {
  PORT: 3000,
  QIDIAN_REQUEST_TIMEOUT_MS: 10_000,
  BOOK_DETAIL_TTL_HOURS: 3,
  RANKING_REFRESH_CRON: "0 0 6 * * *",
  RANKING_REFRESH_TIME_ZONE: "Asia/Shanghai",
} as const;

export interface EnvironmentVariables {
  DATABASE_URL: string;
  QIDIAN_USER_AGENT: string;
  PORT: number;
  QIDIAN_REQUEST_TIMEOUT_MS: number;
  BOOK_DETAIL_TTL_HOURS: number;
  RANKING_REFRESH_CRON: string;
  RANKING_REFRESH_TIME_ZONE: string;
}

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

function validateCronExpression(value: string): void {
  try {
    new CronTime(value);
  } catch {
    throw new Error("RANKING_REFRESH_CRON must be a valid cron expression");
  }
}

function validateTimeZone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new Error("RANKING_REFRESH_TIME_ZONE must be a valid IANA time zone");
  }
}

export function validateEnvironment(
  environment: Record<string, unknown>,
): EnvironmentVariables {
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

  validateCronExpression(rankingRefreshCron);
  validateTimeZone(rankingRefreshTimeZone);

  return {
    DATABASE_URL: requireNonEmptyString(environment, "DATABASE_URL"),
    QIDIAN_USER_AGENT: requireNonEmptyString(environment, "QIDIAN_USER_AGENT"),
    PORT: readPositiveInteger(
      environment,
      "PORT",
      environmentDefaults.PORT,
      65_535,
    ),
    QIDIAN_REQUEST_TIMEOUT_MS: readPositiveInteger(
      environment,
      "QIDIAN_REQUEST_TIMEOUT_MS",
      environmentDefaults.QIDIAN_REQUEST_TIMEOUT_MS,
    ),
    BOOK_DETAIL_TTL_HOURS: readPositiveInteger(
      environment,
      "BOOK_DETAIL_TTL_HOURS",
      environmentDefaults.BOOK_DETAIL_TTL_HOURS,
    ),
    RANKING_REFRESH_CRON: rankingRefreshCron,
    RANKING_REFRESH_TIME_ZONE: rankingRefreshTimeZone,
  };
}
