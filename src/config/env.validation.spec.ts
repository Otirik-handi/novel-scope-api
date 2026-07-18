import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const required = {
    DATABASE_URL: 'postgresql://ranker:secret@localhost:5432/rankings',
    REFRESH_API_KEY: 'test-refresh-key',
    QIDIAN_USER_AGENT: 'NovelRankingAPI/0.1',
  };

  it('provides documented defaults for optional runtime settings', () => {
    expect(validateEnvironment(required)).toMatchObject({
      bookDetailTtlHours: 3,
      crawlLogRetentionDays: 90,
      httpTimeoutMs: 10_000,
      httpRetries: 2,
      qidianMaxConcurrency: 2,
      qidianMinRequestIntervalMs: 1_000,
      bookDetailRefreshTimeoutMs: 35_000,
      trustProxy: false,
    });
  });

  it('rejects missing required variables without exposing supplied secrets', () => {
    expect(() =>
      validateEnvironment({ ...required, DATABASE_URL: undefined }),
    ).toThrow('Invalid environment configuration');

    try {
      validateEnvironment({ ...required, DATABASE_URL: undefined });
    } catch (error) {
      expect(String(error)).not.toContain(required.REFRESH_API_KEY);
    }
  });

  it('rejects invalid numeric settings', () => {
    expect(() =>
      validateEnvironment({ ...required, HTTP_TIMEOUT_MS: 'not-a-number' }),
    ).toThrow('Invalid environment configuration');
  });

  it('accepts only explicitly supported trusted proxy settings', () => {
    expect(validateEnvironment({ ...required, TRUST_PROXY: 'loopback' }).trustProxy).toBe('loopback');
    expect(() => validateEnvironment({ ...required, TRUST_PROXY: 'true' })).toThrow('Invalid environment configuration');
    expect(() => validateEnvironment({ ...required, TRUST_PROXY: '10.0.0.0/8' })).toThrow('Invalid environment configuration');
  });
});
