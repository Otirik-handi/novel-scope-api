import { Inject, Injectable, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { PrismaService } from '../db/prisma.service';

export const CRAWL_LOG_RETENTION_CLOCK = Symbol('CRAWL_LOG_RETENTION_CLOCK');

@Injectable()
export class CrawlLogRetentionService implements OnApplicationBootstrap {
  constructor(
    @Inject(PrismaService) private readonly prisma: Pick<PrismaService, 'crawlLog'>,
    private readonly config: ConfigService,
    @Inject(SchedulerRegistry) private readonly registry: Pick<SchedulerRegistry, 'addCronJob'>,
    @Optional() @Inject(CRAWL_LOG_RETENTION_CLOCK) private readonly now: () => Date = () => new Date(),
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const job = CronJob.from({
      cronTime: '0 30 0 * * *',
      timeZone: 'Asia/Shanghai',
      onTick: () => this.cleanup(),
      start: false,
      waitForCompletion: true,
      name: 'crawl-log-retention',
    });
    this.registry.addCronJob('crawl-log-retention', job);
    job.start();
  }

  async cleanup(): Promise<void> {
    const retentionDays = this.config.getOrThrow<number>('crawlLogRetentionDays');
    const cutoff = new Date(this.now().getTime() - retentionDays * 86_400_000);
    await this.prisma.crawlLog.deleteMany({ where: { startedAt: { lt: cutoff } } });
  }
}
