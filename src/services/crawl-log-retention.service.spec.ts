import { CrawlLogRetentionService } from './crawl-log-retention.service';

describe('CrawlLogRetentionService', () => {
  it('deletes only crawl logs older than the configured retention period', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
    const registry = { addCronJob: jest.fn() };
    const now = new Date('2026-07-20T00:00:00.000Z');
    const service = new CrawlLogRetentionService(
      { crawlLog: { deleteMany } } as never,
      { getOrThrow: jest.fn().mockReturnValue(90) } as never,
      registry,
      () => now,
    );

    await service.cleanup();

    expect(deleteMany).toHaveBeenCalledWith({
      where: { startedAt: { lt: new Date('2026-04-21T00:00:00.000Z') } },
    });
  });
});
