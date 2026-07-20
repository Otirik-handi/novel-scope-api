import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { QidianProvider } from '../crawlers/qidian/rank/qidian.provider';
import { QidianHttpClient } from '../crawlers/qidian/qidian-http-client';
import { RANKING_PROVIDERS } from '../services/rankings.service';

describe('RankingsModule', () => {
  it('registers only the Qidian provider for V0.1', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(module.get(QidianProvider)).toBeInstanceOf(QidianProvider);
    expect(module.get(QidianHttpClient)).toBeInstanceOf(QidianHttpClient);
    expect(module.get(RANKING_PROVIDERS)).toEqual([expect.any(QidianProvider)]);

    await module.close();
  });
});
