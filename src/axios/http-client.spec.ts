import axios, { AxiosError, type AxiosInstance, type AxiosResponse } from 'axios';
import { HttpClient, HttpRequestError, type HttpRequestOptions } from './http-client';

class TestHttpClient extends HttpClient {
  async request(url: string, options?: HttpRequestOptions) {
    return this.getResponse(url, options);
  }
}

describe('HttpClient', () => {
  const url = 'https://example.test/source';
  let axiosInstance: Pick<AxiosInstance, 'get'>;

  beforeEach(() => {
    axiosInstance = { get: jest.fn() };
    jest.spyOn(axios, 'create').mockReturnValue(axiosInstance as AxiosInstance);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the generic configured timeout', () => {
    const config = {
      get: jest.fn((key: string) => ({ httpTimeoutMs: 5_000, HTTP_TIMEOUT_MS: 9_000 }[key])),
    } as never;

    new TestHttpClient(config);

    expect(axios.create).toHaveBeenCalledWith({ timeout: 5_000 });
  });

  it('uses the default timeout and caps default retries at two', async () => {
    axiosInstance.get
      .mockRejectedValueOnce(new AxiosError('offline', 'ERR_NETWORK'))
      .mockRejectedValueOnce(new AxiosError('offline', 'ERR_NETWORK'))
      .mockResolvedValueOnce({ data: Buffer.from('ok'), config: { url } });
    const client = new TestHttpClient(undefined, jest.fn().mockResolvedValue(undefined));

    await expect(client.request(url)).resolves.toEqual({ body: Buffer.from('ok'), finalUrl: url });

    expect(axios.create).toHaveBeenCalledWith({ timeout: 10_000 });
    expect(axiosInstance.get).toHaveBeenCalledTimes(3);
  });

  it('runs executeAttempt for each network request attempt', async () => {
    const executeAttempt = jest.fn(async (work: () => Promise<unknown>) => work());
    axiosInstance.get
      .mockRejectedValueOnce(new AxiosError('offline', 'ERR_NETWORK'))
      .mockResolvedValueOnce({ data: Buffer.from('ok'), config: { url } });
    const client = new TestHttpClient(
      { get: jest.fn((key: string) => key === 'httpRetries' ? 1 : undefined) } as never,
      jest.fn().mockResolvedValue(undefined),
    );

    await expect(client.request(url, { executeAttempt })).resolves.toEqual({
      body: Buffer.from('ok'),
      finalUrl: url,
    });
    expect(executeAttempt).toHaveBeenCalledTimes(2);
    expect(axiosInstance.get).toHaveBeenCalledTimes(2);
  });

  it('passes request headers and converts an arraybuffer response to a Buffer', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    axiosInstance.get.mockResolvedValue({ data: bytes, config: { url } });
    const client = new TestHttpClient();

    await expect(client.request(url, { headers: { Accept: 'application/octet-stream' } })).resolves.toEqual({
      body: Buffer.from(bytes),
      finalUrl: url,
    });
    expect(axiosInstance.get).toHaveBeenCalledWith(url, {
      headers: { Accept: 'application/octet-stream' },
      responseType: 'arraybuffer',
    });
  });

  it('prefers a persisted final response URL over the configured URL', async () => {
    axiosInstance.get.mockResolvedValue({
      data: Buffer.from('ok'),
      request: { res: { responseUrl: 'https://example.test/final' } },
      config: { url: 'https://example.test/configured' },
    });
    const client = new TestHttpClient();

    await expect(client.request(url)).resolves.toEqual({
      body: Buffer.from('ok'),
      finalUrl: 'https://example.test/final',
    });
  });

  it('falls back from the configured URL to the input URL', async () => {
    axiosInstance.get
      .mockResolvedValueOnce({ data: Buffer.from('ok'), config: { url: 'https://example.test/configured' } })
      .mockResolvedValueOnce({ data: Buffer.from('ok'), config: {} });
    const client = new TestHttpClient();

    await expect(client.request(url)).resolves.toEqual({
      body: Buffer.from('ok'),
      finalUrl: 'https://example.test/configured',
    });
    await expect(client.request(url)).resolves.toEqual({ body: Buffer.from('ok'), finalUrl: url });
  });

  it('does not retry a forbidden response', async () => {
    const response = { status: 403 } as AxiosResponse;
    const failure = new AxiosError('forbidden', undefined, undefined, undefined, response);
    axiosInstance.get.mockRejectedValue(failure);
    const client = new TestHttpClient(
      { get: jest.fn((key: string) => key === 'HTTP_RETRIES' ? 2 : undefined) } as never,
      jest.fn().mockResolvedValue(undefined),
    );

    await expect(client.request(url)).rejects.toMatchObject({
      name: 'HttpRequestError', url, status: 403, cause: failure,
    });
    expect(axiosInstance.get).toHaveBeenCalledTimes(1);
  });

  it('does not retry a forbidden response even when Axios reports a timeout code', async () => {
    const response = { status: 403 } as AxiosResponse;
    const failure = new AxiosError('forbidden timeout', 'ECONNABORTED', undefined, undefined, response);
    axiosInstance.get.mockRejectedValue(failure);
    const client = new TestHttpClient(
      { get: jest.fn((key: string) => key === 'httpRetries' ? 2 : undefined) } as never,
      jest.fn().mockResolvedValue(undefined),
    );

    await expect(client.request(url)).rejects.toMatchObject({ status: 403, cause: failure });
    expect(axiosInstance.get).toHaveBeenCalledTimes(1);
  });

  it('retries a DNS network error and returns the later response', async () => {
    const failure = new AxiosError('host not found', 'ENOTFOUND');
    axiosInstance.get
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ data: Buffer.from('ok'), config: { url } });
    const client = new TestHttpClient(
      { get: jest.fn((key: string) => key === 'httpRetries' ? 1 : undefined) } as never,
      jest.fn().mockResolvedValue(undefined),
    );

    await expect(client.request(url)).resolves.toEqual({ body: Buffer.from('ok'), finalUrl: url });
    expect(axiosInstance.get).toHaveBeenCalledTimes(2);
  });

  it('does not retry a local Axios option validation error', async () => {
    const failure = new AxiosError('invalid option value', 'ERR_BAD_OPTION_VALUE');
    axiosInstance.get.mockRejectedValue(failure);
    const client = new TestHttpClient(
      { get: jest.fn((key: string) => key === 'httpRetries' ? 2 : undefined) } as never,
      jest.fn().mockResolvedValue(undefined),
    );

    await expect(client.request(url)).rejects.toMatchObject({ cause: failure });
    expect(axiosInstance.get).toHaveBeenCalledTimes(1);
  });

  it('does not retry a response status outside the 5xx range', async () => {
    const response = { status: 600 } as AxiosResponse;
    const failure = new AxiosError('unknown status', undefined, undefined, undefined, response);
    axiosInstance.get.mockRejectedValue(failure);
    const client = new TestHttpClient(
      { get: jest.fn((key: string) => key === 'httpRetries' ? 2 : undefined) } as never,
      jest.fn().mockResolvedValue(undefined),
    );

    await expect(client.request(url)).rejects.toMatchObject({ status: 600, cause: failure });
    expect(axiosInstance.get).toHaveBeenCalledTimes(1);
  });

  it('normalizes unknown failures while retaining the original cause', async () => {
    const failure = new Error('unexpected');
    axiosInstance.get.mockRejectedValue(failure);
    const client = new TestHttpClient();

    const error = await client.request(url).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpRequestError);
    expect(error).toMatchObject({ url, status: undefined, cause: failure });
    expect((error as Error).message).toContain(url);
  });

  it('preserves the normalized error diagnostic', async () => {
    const failure = new AxiosError('offline', 'ERR_NETWORK');
    axiosInstance.get.mockRejectedValue(failure);
    const client = new TestHttpClient(
      { get: jest.fn((key: string) => key === 'httpRetries' ? 0 : undefined) } as never,
    );

    await expect(client.request(url)).rejects.toMatchObject({
      diagnostic: 'ERR_NETWORK',
      cause: failure,
    });
  });
});
