import { ConfigService } from '@nestjs/config';
import axios, { type AxiosError, type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';

export type HttpResponse = {
  body: Buffer;
  finalUrl: string;
};

export type HttpRequestOptions = {
  headers?: AxiosRequestConfig['headers'];
  retries?: number;
  executeAttempt?: (work: () => Promise<AxiosResponse<ArrayBuffer>>) => Promise<AxiosResponse<ArrayBuffer>>;
};

export type HttpRequestDelay = (milliseconds: number) => Promise<void>;

const timeoutErrorCodes = new Set(['ECONNABORTED', 'ETIMEDOUT']);
const localAxiosErrorCodes = new Set([
  'ERR_BAD_OPTION',
  'ERR_BAD_OPTION_VALUE',
  'ERR_INVALID_URL',
  'ERR_NOT_SUPPORT',
]);
const idempotentMethods = new Set(['get', 'head', 'options', 'put', 'delete']);
const defaultDelay: HttpRequestDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class HttpRequestError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number | undefined,
    public readonly diagnostic: number | string | undefined,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    const context = diagnostic === undefined ? '' : ` (${diagnostic})`;
    super(`HTTP request to ${url} failed${context}: ${detail}`, { cause });
    this.name = 'HttpRequestError';
  }
}

export abstract class HttpClient {
  private readonly client: AxiosInstance;
  private readonly retries: number;

  constructor(
    config?: ConfigService,
    private readonly delay: HttpRequestDelay = defaultDelay,
  ) {
    const configuredRetries = config?.get<number>('httpRetries') ?? config?.get<number>('HTTP_RETRIES') ?? 2;
    this.retries = Math.min(2, Math.max(0, configuredRetries));
    this.client = axios.create({
      timeout: config?.get<number>('httpTimeoutMs') ?? config?.get<number>('HTTP_TIMEOUT_MS') ?? 10_000,
    });
  }

  protected async getResponse(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
    const retries = Math.min(2, Math.max(0, options.retries ?? this.retries));
    const requestConfig: AxiosRequestConfig = { responseType: 'arraybuffer' };
    if (options.headers !== undefined) requestConfig.headers = options.headers;
    const work: () => Promise<AxiosResponse<ArrayBuffer>> = () =>
      this.client.get<ArrayBuffer, AxiosResponse<ArrayBuffer>>(url, requestConfig);

    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await (options.executeAttempt?.(work) ?? work());
        return {
          body: Buffer.from(new Uint8Array(response.data)),
          finalUrl: response.request?.res?.responseUrl ?? response.config?.url ?? url,
        };
      } catch (error: unknown) {
        if (attempt >= retries || !this.isRetryable(error)) {
          throw this.normalizeError(url, error);
        }
        await this.delay(100 * 2 ** attempt);
      }
    }
  }

  private isRetryable(error: unknown): error is AxiosError {
    if (!axios.isAxiosError(error)) return false;

    const status = error.response?.status ?? error.status;
    if (status === 403) return false;
    if (localAxiosErrorCodes.has(error.code ?? '')) return false;
    if (timeoutErrorCodes.has(error.code ?? '')) return true;
    if (status === 408 || status === 429 || (status !== undefined && status >= 500 && status <= 599)) return true;

    return this.isNetworkError(error) || this.isIdempotentRequestError(error);
  }

  private isNetworkError(error: AxiosError): boolean {
    return !error.response &&
      error.code !== undefined &&
      !timeoutErrorCodes.has(error.code) &&
      error.code !== 'ERR_CANCELED' &&
      !localAxiosErrorCodes.has(error.code);
  }

  private isIdempotentRequestError(error: AxiosError): boolean {
    const method = error.config?.method?.toLowerCase();
    if (method === undefined || !idempotentMethods.has(method)) return false;

    const status = error.response?.status;
    return error.code !== 'ECONNABORTED' &&
      (!error.response || status === 429 || (status !== undefined && status >= 500 && status <= 599));
  }

  private normalizeError(url: string, error: unknown): HttpRequestError {
    const isAxiosError = axios.isAxiosError(error);
    const status = isAxiosError ? error.response?.status ?? error.status : undefined;
    const diagnostic = status ?? (isAxiosError ? error.code : undefined);
    return new HttpRequestError(url, status, diagnostic, error);
  }
}
