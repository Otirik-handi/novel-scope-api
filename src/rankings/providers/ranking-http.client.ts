import { Injectable } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const RANKING_HTTP_CLIENT_CONFIG = Object.freeze({
  timeout: 10_000,
  headers: Object.freeze({
    'User-Agent': BROWSER_USER_AGENT,
  }),
});

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

  constructor() {
    this.client = axios.create(RANKING_HTTP_CLIENT_CONFIG);
  }

  async get(url: string): Promise<Buffer> {
    try {
      const response = await this.client.get(url, { responseType: 'arraybuffer' });
      return Buffer.from(response.data);
    } catch (error: unknown) {
      const isAxiosError = axios.isAxiosError(error);
      const status = isAxiosError
        ? (error.response?.status ?? error.status)
        : undefined;
      const diagnostic = status ?? (isAxiosError ? error.code : undefined);

      throw new HttpRequestError(url, status, diagnostic, error);
    }
  }
}
