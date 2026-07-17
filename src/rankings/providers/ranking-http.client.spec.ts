import axios, { AxiosError, type AxiosInstance, type AxiosResponse } from 'axios';
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
    jest.restoreAllMocks();
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
