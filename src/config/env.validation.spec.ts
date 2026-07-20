import { validateEnvironment } from "./env.validation";

const requiredEnvironment = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/novel_scope",
  QIDIAN_USER_AGENT: "NovelScope/0.1",
};

describe("validateEnvironment", () => {
  it.each(["DATABASE_URL", "QIDIAN_USER_AGENT"] as const)(
    "requires %s",
    (key) => {
      const environment = { ...requiredEnvironment };
      delete environment[key];

      expect(() => validateEnvironment(environment)).toThrow(
        `${key} is required`,
      );
    },
  );

  it("applies defaults for optional settings", () => {
    expect(validateEnvironment(requiredEnvironment)).toEqual({
      ...requiredEnvironment,
      PORT: 3000,
      QIDIAN_REQUEST_TIMEOUT_MS: 10_000,
      BOOK_DETAIL_TTL_HOURS: 3,
      RANKING_REFRESH_CRON: "0 0 6 * * *",
      RANKING_REFRESH_TIME_ZONE: "Asia/Shanghai",
    });
  });

  it("normalizes explicitly configured numbers", () => {
    expect(
      validateEnvironment({
        ...requiredEnvironment,
        PORT: "3100",
        QIDIAN_REQUEST_TIMEOUT_MS: "15000",
        BOOK_DETAIL_TTL_HOURS: "6",
      }),
    ).toMatchObject({
      PORT: 3100,
      QIDIAN_REQUEST_TIMEOUT_MS: 15_000,
      BOOK_DETAIL_TTL_HOURS: 6,
    });
  });

  it.each([
    ["PORT", "not-a-number"],
    ["PORT", "3000.5"],
    ["PORT", "0"],
    ["PORT", "65536"],
    ["QIDIAN_REQUEST_TIMEOUT_MS", "0"],
    ["QIDIAN_REQUEST_TIMEOUT_MS", "10.5"],
    ["BOOK_DETAIL_TTL_HOURS", "-1"],
    ["BOOK_DETAIL_TTL_HOURS", "1.5"],
  ])("rejects invalid numeric setting %s=%s", (key, value) => {
    expect(() =>
      validateEnvironment({ ...requiredEnvironment, [key]: value }),
    ).toThrow(`${key} must be a positive integer`);
  });

  it("rejects an invalid ranking refresh cron expression", () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        RANKING_REFRESH_CRON: "not-a-cron-expression",
      }),
    ).toThrow("RANKING_REFRESH_CRON must be a valid cron expression");
  });

  it("rejects an invalid ranking refresh time zone", () => {
    expect(() =>
      validateEnvironment({
        ...requiredEnvironment,
        RANKING_REFRESH_TIME_ZONE: "Invalid/TimeZone",
      }),
    ).toThrow("RANKING_REFRESH_TIME_ZONE must be a valid IANA time zone");
  });
});
