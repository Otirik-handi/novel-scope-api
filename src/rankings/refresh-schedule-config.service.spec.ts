import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RefreshScheduleConfigService } from './refresh-schedule-config.service';

describe('RefreshScheduleConfigService', () => {
  let directory: string;
  let configPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'ranking-refresh-config-'));
    configPath = join(directory, 'refresh-rankings.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('loads the schedule and normalizes a qidian channel to null', async () => {
    await writeConfig({
      cron: '0 0 */6 * * *',
      targetConcurrency: 1,
      jjwxcDetailConcurrency: 4,
      targets: [
        { platform: 'qidian', rank: 'hotsales' },
        { platform: 'jjwxc', rank: 'income', channel: '0' },
      ],
    });
    const service = new RefreshScheduleConfigService(configPath);

    await service.onModuleInit();

    expect(service.get()).toEqual({
      cron: '0 0 */6 * * *',
      targetConcurrency: 1,
      jjwxcDetailConcurrency: 4,
      targets: [
        { platform: 'qidian', rank: 'hotsales', channel: null },
        { platform: 'jjwxc', rank: 'income', channel: '0' },
      ],
    });
  });

  it.each([
    ['missing file', undefined],
    ['invalid cron', {
      cron: 'not a cron', targetConcurrency: 1, jjwxcDetailConcurrency: 4, targets: [
        { platform: 'qidian', rank: 'hotsales' },
      ],
    }],
    ['five-field cron', {
      cron: '*/5 * * * *', targetConcurrency: 1, jjwxcDetailConcurrency: 4, targets: [
        { platform: 'qidian', rank: 'hotsales' },
      ],
    }],
    ['missing jjwxc channel', {
      cron: '0 0 */6 * * *', targetConcurrency: 1, jjwxcDetailConcurrency: 4, targets: [
        { platform: 'jjwxc', rank: 'income' },
      ],
    }],
    ['unsupported rank', {
      cron: '0 0 */6 * * *', targetConcurrency: 1, jjwxcDetailConcurrency: 4, targets: [
        { platform: 'jjwxc', rank: 'unknown', channel: '0' },
      ],
    }],
    ['prototype rank', {
      cron: '0 0 */6 * * *', targetConcurrency: 1, jjwxcDetailConcurrency: 4, targets: [
        { platform: 'qidian', rank: 'toString' },
      ],
    }],
  ])('rejects %s', async (_name, config) => {
    if (config) {
      await writeConfig(config);
    }

    await expect(new RefreshScheduleConfigService(configPath).onModuleInit()).rejects.toThrow();
  });

  async function writeConfig(config: object): Promise<void> {
    await writeFile(configPath, JSON.stringify(config), 'utf8');
  }
});
