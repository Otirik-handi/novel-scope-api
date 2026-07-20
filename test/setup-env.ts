if (process.env.RUN_DATABASE_INTEGRATION_TESTS !== 'true') {
  process.env.DATABASE_URL ??= 'postgresql://ranker:password@localhost:5432/rankings';
}
process.env.REFRESH_API_KEY ??= 'test-key';
process.env.QIDIAN_USER_AGENT ??= 'NovelRankingAPI/test';
