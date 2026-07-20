import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosError, type AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const RANKING_HTTP_CLIENT_CONFIG = Object.freeze({
  timeout: 10_000,
  headers: Object.freeze({
    'User-Agent': BROWSER_USER_AGENT,
  }),
});

export const QIDIAN_REQUEST_CLOCK = Symbol('QIDIAN_REQUEST_CLOCK');
export const QIDIAN_REQUEST_DELAY = Symbol('QIDIAN_REQUEST_DELAY');

export type RequestClock = { now(): number };
export type RequestDelay = (milliseconds: number) => Promise<void>;

const systemClock: RequestClock = { now: () => Date.now() };
const systemDelay: RequestDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const TIMEOUT_ERROR_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT']);

class QidianRequestGovernor {
  private readonly waiting: Array<{
    work: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }> = [];
  private active = 0;
  private lastStartedAt: number | undefined;
  private delaying = false;

  constructor(
    private readonly maxConcurrency: number,
    private readonly minIntervalMs: number,
    private readonly clock: RequestClock,
    private readonly delay: RequestDelay,
  ) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({ work, resolve: resolve as (value: unknown) => void, reject });
      this.drain();
    });
  }

  private drain(): void {
    if (this.active >= this.maxConcurrency || this.waiting.length === 0 || this.delaying) return;
    const elapsed = this.lastStartedAt === undefined ? this.minIntervalMs : this.clock.now() - this.lastStartedAt;
    const remaining = Math.max(0, this.minIntervalMs - elapsed);
    if (remaining > 0) {
      this.delaying = true;
      void this.delay(remaining).then(() => {
        this.delaying = false;
        this.drain();
      });
      return;
    }

    const request = this.waiting.shift();
    if (!request) return;
    this.active += 1;
    this.lastStartedAt = this.clock.now();
    Promise.resolve(request.work()).then(request.resolve, request.reject).finally(() => {
      this.active -= 1;
      this.drain();
    });
    this.drain();
  }
}

let sharedQidianGovernor: QidianRequestGovernor | undefined;

export class HttpRequestError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number | undefined,
    diagnostic: number | string | undefined,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const context = diagnostic === undefined ? '' : ` (${diagnostic})`;
    super(`HTTP request to ${url} failed${context}: ${detail}`, { cause });
    this.name = 'HttpRequestError';
  }
}

@Injectable()
export class RankingHttpClient {
  private readonly client: AxiosInstance;
  private readonly qidianGovernor: QidianRequestGovernor;
  private readonly retries: number;
  private readonly delay: RequestDelay;

  constructor(
    @Optional() config?: ConfigService,
    @Optional() @Inject(QIDIAN_REQUEST_CLOCK) clock: RequestClock = systemClock,
    @Optional() @Inject(QIDIAN_REQUEST_DELAY) delay: RequestDelay = systemDelay,
  ) {
    this.retries = Math.min(2, config?.get<number>('httpRetries') ?? config?.get<number>('HTTP_RETRIES') ?? 2);
    this.delay = delay;
    this.client = axios.create({
      timeout: config?.get<number>('httpTimeoutMs') ?? config?.get<number>('HTTP_TIMEOUT_MS') ?? 10_000,
      headers: { 'User-Agent': config?.get<string>('qidianUserAgent') ?? config?.get<string>('QIDIAN_USER_AGENT') ?? BROWSER_USER_AGENT },
    });
    if ('interceptors' in this.client) {
      axiosRetry(this.client, {
        retries: this.retries,
        shouldResetTimeout: true,
        retryCondition: (error) => !this.isQidianUrl(error.config?.url ?? '') && this.isRetryable(error),
        retryDelay: (count, error) => axiosRetry.exponentialDelay(count, error, 100),
      });
    }
    sharedQidianGovernor ??= new QidianRequestGovernor(
      config?.get<number>('qidianMaxConcurrency') ?? config?.get<number>('QIDIAN_MAX_CONCURRENCY') ?? 2,
      config?.get<number>('qidianMinRequestIntervalMs') ?? config?.get<number>('QIDIAN_MIN_REQUEST_INTERVAL_MS') ?? 1_000,
      clock,
      delay,
    );
    this.qidianGovernor = sharedQidianGovernor;
  }

  static resetQidianGovernanceForTests(): void {
    sharedQidianGovernor = undefined;
  }

  async get(url: string): Promise<Buffer> {
    return (await this.getResponse(url)).body;
  }

  async getResponse(url: string): Promise<{ body: Buffer; finalUrl: string }> {
    try {
      const response = await this.request(url);
      return { body: Buffer.from(response.data), finalUrl: response.request?.res?.responseUrl ?? response.config?.url ?? url };
    } catch (error: unknown) {
      const isAxiosError = axios.isAxiosError(error);
      const status = isAxiosError
        ? (error.response?.status ?? error.status)
        : undefined;
      const diagnostic = status ?? (isAxiosError ? error.code : undefined);

      throw new HttpRequestError(url, status, diagnostic, error);
    }
  }

  private async request(url: string) {
    const work = () => this.client.get(url, { responseType: 'arraybuffer' });
    if (!this.isQidianUrl(url)) return work();

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.qidianGovernor.run(work);
      } catch (error: unknown) {
        if (attempt >= this.retries || !this.isRetryable(error)) throw error;
        await this.delay(axiosRetry.exponentialDelay(attempt + 1, error, 100));
      }
    }
  }

  private isQidianUrl(url: string): boolean {
    try {
      const hostname = new URL(url).hostname;
      return hostname === 'qidian.com' || hostname.endsWith('.qidian.com');
    } catch {
      return false;
    }
  }

  private isRetryable(error: unknown): error is AxiosError {
    if (!axios.isAxiosError(error)) return false;
    const status = error.response?.status ?? error.status ?? 0;
    return ![403].includes(status) &&
      (TIMEOUT_ERROR_CODES.has(error.code ?? '') || axiosRetry.isNetworkOrIdempotentRequestError(error) || [408, 429].includes(status) || status >= 500);
  }
}
