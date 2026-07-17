import { Injectable } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const RANKING_HTTP_CLIENT_CONFIG = {
  timeout: 10_000,
  headers: {
    'User-Agent': BROWSER_USER_AGENT,
  },
};

export class HttpRequestError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number | undefined,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`HTTP request to ${url} failed: ${detail}`, { cause });
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
      const status = axios.isAxiosError(error)
        ? (error.response?.status ?? error.status)
        : undefined;

      throw new HttpRequestError(url, status, error);
    }
  }
}
