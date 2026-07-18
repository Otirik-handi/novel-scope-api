import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateCronExpression } from 'cron';
import { Platform, RankingKey } from './domain/ranking.types';
import { isSupportedRank } from './ranking-catalog';

export interface RefreshScheduleConfig {
  cron: string;
  targetConcurrency: number;
  jjwxcDetailConcurrency: number;
  targets: RankingKey[];
}

export const REFRESH_SCHEDULE_CONFIG_PATH = Symbol('REFRESH_SCHEDULE_CONFIG_PATH');

export class RefreshScheduleConfigError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'RefreshScheduleConfigError';
  }
}

@Injectable()
export class RefreshScheduleConfigService implements OnModuleInit {
  private config?: RefreshScheduleConfig;
  private readonly configPath: string;

  constructor(
    @Optional() @Inject(REFRESH_SCHEDULE_CONFIG_PATH) configPath?: string,
  ) {
    this.configPath = configPath ?? join(process.cwd(), 'refresh-rankings.json');
  }

  async onModuleInit(): Promise<void> {
    let contents: string;
    try {
      contents = await readFile(this.configPath, 'utf8');
    } catch (error: unknown) {
      throw new RefreshScheduleConfigError(
        `Unable to read refresh schedule config at ${this.configPath}`,
        error,
      );
    }

    let value: unknown;
    try {
      value = JSON.parse(contents);
    } catch (error: unknown) {
      throw new RefreshScheduleConfigError('Refresh schedule config is not valid JSON', error);
    }

    this.config = this.parse(value);
  }

  get(): RefreshScheduleConfig {
    if (!this.config) {
      throw new RefreshScheduleConfigError('Refresh schedule config has not been loaded');
    }

    return this.config;
  }

  private parse(value: unknown): RefreshScheduleConfig {
    const config = this.object(value, 'Refresh schedule config must be an object');
    const cron = this.string(config.cron, 'cron');
    if (cron.split(/\s+/).length !== 6 || !validateCronExpression(cron).valid) {
      throw new RefreshScheduleConfigError('cron must be a valid six-field Cron expression');
    }

    const targetConcurrency = this.positiveInteger(config.targetConcurrency, 'targetConcurrency');
    const jjwxcDetailConcurrency = this.positiveInteger(
      config.jjwxcDetailConcurrency,
      'jjwxcDetailConcurrency',
    );
    if (!Array.isArray(config.targets) || config.targets.length === 0) {
      throw new RefreshScheduleConfigError('targets must be a non-empty array');
    }

    const targets = config.targets.map((target, index) => this.target(target, index));
    const keys = new Set(targets.map((target) => this.key(target)));
    if (keys.size !== targets.length) {
      throw new RefreshScheduleConfigError('targets must not contain duplicate ranking keys');
    }

    return { cron, targetConcurrency, jjwxcDetailConcurrency, targets };
  }

  private target(value: unknown, index: number): RankingKey {
    const target = this.object(value, `targets[${index}] must be an object`);
    const platform = this.platform(target.platform, `targets[${index}].platform`);
    const rank = this.string(target.rank, `targets[${index}].rank`);
    if (!isSupportedRank(platform, rank)) {
      throw new RefreshScheduleConfigError(`targets[${index}].rank is not supported by ${platform}`);
    }

    if (platform === 'jjwxc') {
      return {
        platform,
        rank,
        channel: this.string(target.channel, `targets[${index}].channel`),
      };
    }

    return { platform, rank, channel: null };
  }

  private object(value: unknown, message: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new RefreshScheduleConfigError(message);
    }

    return value as Record<string, unknown>;
  }

  private string(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new RefreshScheduleConfigError(`${field} must be a non-empty string`);
    }

    return value.trim();
  }

  private positiveInteger(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      throw new RefreshScheduleConfigError(`${field} must be a positive integer`);
    }

    return value;
  }

  private platform(value: unknown, field: string): Platform {
    if (value !== 'qidian' && value !== 'jjwxc') {
      throw new RefreshScheduleConfigError(`${field} must be qidian or jjwxc`);
    }

    return value;
  }

  private key(target: RankingKey): string {
    return `${target.platform}--${target.rank}--${target.channel ?? 'default'}`;
  }
}
