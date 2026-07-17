import { RefreshScheduler } from './refresh.scheduler';

describe('RefreshScheduler', () => {
  it('refreshes configured rankings once per scheduled run', async () => {
    const rankings = { refresh: jest.fn().mockResolvedValue(undefined) };
    const scheduler = new RefreshScheduler(rankings);

    await scheduler.refreshConfiguredRankings();

    expect(rankings.refresh).toHaveBeenCalledWith({
      platform: 'qidian', rank: 'hotsales', channel: null,
    });
    expect(rankings.refresh).toHaveBeenCalledWith({
      platform: 'jjwxc', rank: 'income', channel: '0',
    });
  });
});
