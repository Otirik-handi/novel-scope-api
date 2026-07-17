import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { JjwxcProvider } from './providers/jjwxc.provider';
import { QidianProvider } from './providers/qidian.provider';
import { RankingHttpClient } from './providers/ranking-http.client';

describe('RankingsModule', () => {
  it('injects the shared HTTP client into both ranking providers', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(module.get(QidianProvider)).toBeInstanceOf(QidianProvider);
    expect(module.get(JjwxcProvider)).toBeInstanceOf(JjwxcProvider);
    expect(module.get(RankingHttpClient)).toBeInstanceOf(RankingHttpClient);

    await module.close();
  });
});
