import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health.controller';
import { RankingsModule } from './rankings/rankings.module';

@Module({ controllers: [HealthController], imports: [ScheduleModule.forRoot(), RankingsModule] })
export class AppModule {}
