import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClient, type HttpRequestDelay, type HttpResponse } from '../../axios/http-client';

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const QIDIAN_REQUEST_CLOCK = Symbol('QIDIAN_REQUEST_CLOCK');
export const QIDIAN_REQUEST_DELAY = Symbol('QIDIAN_REQUEST_DELAY');

export type RequestClock = { now(): number };
export type RequestDelay = HttpRequestDelay;

const systemClock: RequestClock = { now: () => Date.now() };
const systemDelay: RequestDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

@Injectable()
export class QidianHttpClient extends HttpClient {
  private readonly qidianGovernor: QidianRequestGovernor;
  private readonly userAgent: string;

  constructor(
    @Optional() config?: ConfigService,
    @Optional() @Inject(QIDIAN_REQUEST_CLOCK) clock: RequestClock = systemClock,
    @Optional() @Inject(QIDIAN_REQUEST_DELAY) delay: RequestDelay = systemDelay,
  ) {
    super(config, delay);
    this.userAgent = config?.get<string>('qidianUserAgent') ?? config?.get<string>('QIDIAN_USER_AGENT') ?? BROWSER_USER_AGENT;
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

  async getResponse(url: string): Promise<HttpResponse> {
    return super.getResponse(url, {
      headers: { 'User-Agent': this.userAgent },
      executeAttempt: (work) => this.qidianGovernor.run(work),
    });
  }
}
