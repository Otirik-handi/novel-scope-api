import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { RankingsModule } from './rankings/rankings.module';

@Module({ controllers: [HealthController], imports: [RankingsModule] })
export class AppModule {}
