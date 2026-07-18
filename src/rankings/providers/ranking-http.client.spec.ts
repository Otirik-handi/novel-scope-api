import axios, { AxiosError, type AxiosAdapter, type AxiosInstance, type AxiosResponse } from 'axios';
import {
  HttpRequestError,
  RankingHttpClient,
  RANKING_HTTP_CLIENT_CONFIG,
} from './ranking-http.client';

describe('RankingHttpClient', () => {
  const url = 'https://example.test/rankings';
  let axiosInstance: Pick<AxiosInstance, 'get'>;

  beforeEach(() => {
    axiosInstance = { get: jest.fn() };
    jest.spyOn(axios, 'create').mockReturnValue(axiosInstance as AxiosInstance);
  });

  afterEach(() => {
    RankingHttpClient.resetQidianGovernanceForTests();
    jest.restoreAllMocks();
  });

  it.each([1, 3])('uses the configured Qidian concurrency limit of %i', async (concurrency) => {
    const completions: Array<() => void> = [];
    axiosInstance.get.mockImplementation(() => new Promise((resolve) => {
      completions.push(() => resolve({ data: Buffer.from('ok') }));
    }));
    const config = {
      get: jest.fn((key: string) => ({ qidianMinRequestIntervalMs: 0, QIDIAN_MAX_CONCURRENCY: concurrency }[key])),
    } as never;
    const client = new RankingHttpClient(config);

    const requests = Array.from({ length: concurrency + 1 }, (_, index) =>
      client.get(`https://www.qidian.com/rank/${index}/`),
    );
    await Promise.resolve();

    expect(axiosInstance.get).toHaveBeenCalledTimes(concurrency);
    completions.slice(0, concurrency).forEach((complete) => complete());
    await Promise.resolve();
    await Promise.resolve();
    expect(axiosInstance.get).toHaveBeenCalledTimes(concurrency + 1);

    completions.slice(concurrency).forEach((complete) => complete());
    await expect(Promise.all(requests)).resolves.toHaveLength(concurrency + 1);
  });

  it('spaces shared Qidian request starts using the configured interval and injected clock/delay', async () => {
    let now = 0;
    const clock = { now: () => now };
    const delay = jest.fn(async (milliseconds: number) => { now += milliseconds; });
    const config = { get: jest.fn((key: string) => key === 'qidianMinRequestIntervalMs' ? 1_000 : undefined) } as never;
    axiosInstance.get.mockResolvedValue({ data: Buffer.from('ok') });
    const first = new RankingHttpClient(config, clock, delay);
    const second = new RankingHttpClient(config, clock, delay);

    await Promise.all([
      first.get('https://www.qidian.com/rank/hotsales/'),
      second.get('https://m.qidian.com/book/1/'),
    ]);

    expect(delay).toHaveBeenCalledWith(1_000);
    expect(axiosInstance.get.mock.invocationCallOrder).toHaveLength(2);
    expect(now).toBe(1_000);
  });

  it('governs every retry attempt for a Qidian request', async () => {
    let now = 0;
    const starts: number[] = [];
    const clock = { now: () => now };
    const delay = jest.fn(async (milliseconds: number) => { now += milliseconds; });
    const config = { get: jest.fn((key: string) => ({ qidianMinRequestIntervalMs: 1_000, httpRetries: 1 }[key])) } as never;
    axiosInstance.get.mockImplementation(() => {
      starts.push(now);
      return starts.length === 1
        ? Promise.reject(new AxiosError('temporary', 'ERR_NETWORK'))
        : Promise.resolve({ data: Buffer.from('ok') });
    });
    const client = new RankingHttpClient(config, clock, delay);

    await expect(client.get('https://www.qidian.com/rank/hotsales/')).resolves.toEqual(Buffer.from('ok'));

    expect(starts).toEqual([0, 1_000]);
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT'])('retries Qidian timeout error %s', async (code) => {
    const config = { get: jest.fn((key: string) => ({ qidianMinRequestIntervalMs: 0, httpRetries: 1 }[key])) } as never;
    axiosInstance.get
      .mockRejectedValueOnce(new AxiosError('timeout', code))
      .mockResolvedValueOnce({ data: Buffer.from('ok') });
    const client = new RankingHttpClient(config, { now: () => 0 }, jest.fn().mockResolvedValue(undefined));

    await expect(client.get('https://www.qidian.com/rank/hotsales/')).resolves.toEqual(Buffer.from('ok'));
    expect(axiosInstance.get).toHaveBeenCalledTimes(2);
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT'])('retries a non-Qidian timeout error %s with a fresh timeout budget', async (code) => {
    jest.restoreAllMocks();
    let now = 1;
    const adapter: AxiosAdapter = jest.fn(async (config) => {
      if ((adapter as jest.Mock).mock.calls.length === 1) {
        now = 10_001;
        throw new AxiosError('timeout', code, config);
      }
      return {
        data: Buffer.from('ok'),
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    });
    const actualCreate = axios.create;
    jest.spyOn(axios, 'create').mockImplementation((config) => actualCreate({ ...config, adapter }));
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const client = new RankingHttpClient();

    await expect(client.get('https://www.jjwxc.net/topten.php')).resolves.toEqual(Buffer.from('ok'));
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('requests an arraybuffer and returns its bytes as a Buffer', async () => {
    const responseBytes = new Uint8Array([0, 1, 2, 255]);
    axiosInstance.get.mockResolvedValue({ data: responseBytes });
    const client = new RankingHttpClient();

    await expect(client.get(url)).resolves.toEqual(Buffer.from(responseBytes));
    expect(axiosInstance.get).toHaveBeenCalledWith(url, {
      responseType: 'arraybuffer',
    });
  });

  it('returns the final response URL for providers that persist a source URL', async () => {
    axiosInstance.get.mockResolvedValue({ data: Buffer.from('ok'), request: { res: { responseUrl: 'https://example.test/final' } } });
    const client = new RankingHttpClient();

    await expect(client.getResponse(url)).resolves.toEqual({
      body: Buffer.from('ok'), finalUrl: 'https://example.test/final',
    });
  });

  it.each([
    ['a timeout', new AxiosError('timeout', 'ECONNABORTED')],
    ['a network failure', new AxiosError('network failure', 'ERR_NETWORK')],
  ])('normalizes %s with request diagnostics', async (_scenario, axiosError) => {
    axiosInstance.get.mockRejectedValue(axiosError);
    const client = new RankingHttpClient();

    const error = await client.get(url).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(HttpRequestError);
    expect(error).toMatchObject({
      message: expect.stringContaining(url),
      cause: axiosError,
    });
    expect((error as Error).message).toContain(axiosError.code);
  });

  it('preserves HTTP status in a normalized HTTP failure', async () => {
    axiosInstance.get.mockRejectedValue(
      new AxiosError(
        'service unavailable',
        undefined,
        undefined,
        undefined,
        { status: 503 } as AxiosResponse,
      ),
    );
    const client = new RankingHttpClient();

    const error = await client.get(url).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(HttpRequestError);
    expect(error).toMatchObject({
      name: 'HttpRequestError',
      status: 503,
      message: expect.stringContaining(url),
    });
    expect((error as Error).message).toContain('503');
  });

  it('wraps non-Axios failures while preserving their cause', async () => {
    const cause = new Error('unexpected failure');
    axiosInstance.get.mockRejectedValue(cause);
    const client = new RankingHttpClient();

    const error = await client.get(url).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(HttpRequestError);
    expect(error).toMatchObject({ url, status: undefined, cause });
    expect((error as Error).message).toContain(url);
  });

  it('uses immutable ten-second browser-like Axios defaults', () => {
    expect(RANKING_HTTP_CLIENT_CONFIG.timeout).toBe(10_000);
    expect(RANKING_HTTP_CLIENT_CONFIG.headers['User-Agent']).toMatch(
      /^Mozilla\/5\.0/,
    );
    expect(Object.isFrozen(RANKING_HTTP_CLIENT_CONFIG)).toBe(true);
    expect(Object.isFrozen(RANKING_HTTP_CLIENT_CONFIG.headers)).toBe(true);

    new RankingHttpClient();

    expect(axios.create).toHaveBeenLastCalledWith({
      timeout: 10_000,
      headers: {
        'User-Agent': expect.stringMatching(/^Mozilla\/5\.0/),
      },
    });
  });
});
