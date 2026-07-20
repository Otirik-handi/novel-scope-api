import { CronJob } from 'cron';
import { RefreshScheduler } from './refresh.scheduler';

describe('RefreshScheduler', () => {
  it('registers a configured cron job that refreshes every target', async () => {
    const rankings = { refresh: jest.fn().mockResolvedValue(undefined) };
    const registry = { addCronJob: jest.fn() };
    const scheduler = new RefreshScheduler(rankings, registry);

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
    expect(rankings.refresh).toHaveBeenCalledTimes(4);
    expect(rankings.refresh).toHaveBeenCalledWith({ platform: 'qidian', rank: 'yuepiao', channel: null });
    expect(rankings.refresh).toHaveBeenCalledWith({ platform: 'qidian', rank: 'recom', channel: null });
    expect(rankings.refresh).toHaveBeenCalledWith({ platform: 'qidian', rank: 'collect', channel: null });
  });
});
