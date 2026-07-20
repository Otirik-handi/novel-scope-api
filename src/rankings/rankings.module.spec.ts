import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { QidianProvider } from './providers/qidian.provider';
import { RankingHttpClient } from './providers/ranking-http.client';
import { RANKING_PROVIDERS } from './rankings.service';

describe('RankingsModule', () => {
  it('registers only the Qidian provider for V0.1', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(module.get(QidianProvider)).toBeInstanceOf(QidianProvider);
    expect(module.get(RankingHttpClient)).toBeInstanceOf(RankingHttpClient);
    expect(module.get(RANKING_PROVIDERS)).toEqual([expect.any(QidianProvider)]);

    await module.close();
  });
});
