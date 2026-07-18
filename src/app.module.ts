import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health.controller';
import { RankingsModule } from './rankings/rankings.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    RankingsModule,
  ],
})
export class AppModule {}
