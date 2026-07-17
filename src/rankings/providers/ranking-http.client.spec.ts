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
    [
      'an HTTP failure',
      new AxiosError(
        'service unavailable',
        undefined,
        undefined,
        undefined,
        { status: 503 } as AxiosResponse,
      ),
    ],
  ])('normalizes %s with the request URL', async (_scenario, axiosError) => {
    axiosInstance.get.mockRejectedValue(axiosError);
    const client = new RankingHttpClient();

    await expect(client.get(url)).rejects.toBeInstanceOf(HttpRequestError);
    await expect(client.get(url)).rejects.toThrow(url);
  });

  it('includes HTTP status in a normalized HTTP failure', async () => {
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

    await expect(client.get(url)).rejects.toThrow('503');
  });

  it('exports a ten-second browser-like Axios configuration', () => {
    expect(RANKING_HTTP_CLIENT_CONFIG.timeout).toBe(10_000);
    expect(RANKING_HTTP_CLIENT_CONFIG.headers['User-Agent']).toMatch(
      /^Mozilla\/5\.0/,
    );
  });
});
