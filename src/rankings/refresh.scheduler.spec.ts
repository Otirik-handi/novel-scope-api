import { CronJob } from 'cron';
import { RefreshScheduleConfigService } from './refresh-schedule-config.service';
import { RefreshScheduler } from './refresh.scheduler';

describe('RefreshScheduler', () => {
  it('registers a configured cron job that refreshes every target', async () => {
    const rankings = { refresh: jest.fn().mockResolvedValue(undefined) };
    const registry = { addCronJob: jest.fn() };
    const config = {
      get: jest.fn().mockReturnValue({
        cron: '0 0 */6 * * *',
        targetConcurrency: 1,
        jjwxcDetailConcurrency: 4,
        targets: [
          { platform: 'qidian', rank: 'hotsales', channel: null },
          { platform: 'jjwxc', rank: 'income', channel: '0' },
        ],
      }),
    } as unknown as RefreshScheduleConfigService;
    const scheduler = new RefreshScheduler(rankings, registry, config);

    await scheduler.onApplicationBootstrap();

    expect(registry.addCronJob).toHaveBeenCalledWith(
      'ranking-refresh',
      expect.any(CronJob),
    );

    const job = registry.addCronJob.mock.calls[0][1] as CronJob;
    await job.fireOnTick();
    await job.stop();

    expect(rankings.refresh).toHaveBeenCalledWith({
      platform: 'qidian', rank: 'hotsales', channel: null,
    });
    expect(rankings.refresh).toHaveBeenCalledWith({
      platform: 'jjwxc', rank: 'income', channel: '0',
    });
  });
});
