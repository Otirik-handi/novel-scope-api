import axios, { AxiosError, type AxiosInstance } from 'axios';
import { HttpRequestError } from '../../axios/http-client';
import {
  BROWSER_USER_AGENT,
  QidianHttpClient,
} from './qidian-http-client';

describe('QidianHttpClient', () => {
  let axiosInstance: Pick<AxiosInstance, 'get'>;

  beforeEach(() => {
    axiosInstance = { get: jest.fn() };
    jest.spyOn(axios, 'create').mockReturnValue(axiosInstance as AxiosInstance);
  });

  afterEach(() => {
    QidianHttpClient.resetQidianGovernanceForTests();
    jest.restoreAllMocks();
  });

  it('shares one governor and limits two configured concurrent requests', async () => {
    const completions: Array<() => void> = [];
    axiosInstance.get.mockImplementation(() => new Promise((resolve) => {
      completions.push(() => resolve({ data: Buffer.from('ok') }));
    }));
    const config = {
      get: jest.fn((key: string) => ({
        qidianMaxConcurrency: 2,
        qidianMinRequestIntervalMs: 0,
      }[key])),
    } as never;
    const first = new QidianHttpClient(config);
    const second = new QidianHttpClient(config);

    const requests = [
      first.get('https://www.qidian.com/rank/1/'),
      second.get('https://www.qidian.com/rank/2/'),
      first.get('https://www.qidian.com/rank/3/'),
    ];
    await Promise.resolve();

    expect(axiosInstance.get).toHaveBeenCalledTimes(2);
    completions.splice(0).forEach((complete) => complete());
    await Promise.resolve();
    await Promise.resolve();
    expect(axiosInstance.get).toHaveBeenCalledTimes(3);

    completions.splice(0).forEach((complete) => complete());
    await expect(Promise.all(requests)).resolves.toHaveLength(3);
  });

  it('spaces shared request starts by the configured 1000ms interval', async () => {
    let now = 0;
    const clock = { now: () => now };
    const delay = jest.fn(async (milliseconds: number) => { now += milliseconds; });
    const config = { get: jest.fn((key: string) => key === 'qidianMinRequestIntervalMs' ? 1_000 : undefined) } as never;
    axiosInstance.get.mockResolvedValue({ data: Buffer.from('ok') });
    const first = new QidianHttpClient(config, clock, delay);
    const second = new QidianHttpClient(config, clock, delay);

    await Promise.all([
      first.get('https://www.qidian.com/rank/hotsales/'),
      second.get('https://m.qidian.com/book/1/'),
    ]);

    expect(delay).toHaveBeenCalledWith(1_000);
    expect(now).toBe(1_000);
  });

  it('governs every network retry attempt', async () => {
    let now = 0;
    const starts: number[] = [];
    const clock = { now: () => now };
    const delay = jest.fn(async (milliseconds: number) => { now += milliseconds; });
    const config = {
      get: jest.fn((key: string) => ({
        httpRetries: 1,
        qidianMinRequestIntervalMs: 1_000,
      }[key])),
    } as never;
    axiosInstance.get.mockImplementation(() => {
      starts.push(now);
      return starts.length === 1
        ? Promise.reject(new AxiosError('temporary', 'ERR_NETWORK'))
        : Promise.resolve({ data: Buffer.from('ok') });
    });
    const client = new QidianHttpClient(config, clock, delay);

    await expect(client.get('https://www.qidian.com/rank/hotsales/')).resolves.toEqual(Buffer.from('ok'));

    expect(starts).toEqual([0, 1_000]);
  });

  it('passes the configured Qidian user agent to the generic client', async () => {
    axiosInstance.get.mockResolvedValue({ data: Buffer.from('ok') });
    const client = new QidianHttpClient({
      get: jest.fn((key: string) => key === 'QIDIAN_USER_AGENT' ? 'Qidian test agent' : undefined),
    } as never);

    await expect(client.get('https://www.qidian.com/rank/hotsales/')).resolves.toEqual(Buffer.from('ok'));

    expect(axiosInstance.get).toHaveBeenCalledWith('https://www.qidian.com/rank/hotsales/', {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Qidian test agent' },
    });
  });

  it('uses the browser user agent by default', async () => {
    axiosInstance.get.mockResolvedValue({ data: Buffer.from('ok') });
    const client = new QidianHttpClient();

    await client.get('https://www.qidian.com/rank/second/');

    expect(axiosInstance.get).toHaveBeenLastCalledWith('https://www.qidian.com/rank/second/', {
      responseType: 'arraybuffer',
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    });
  });

  it('reset replaces the shared governor', async () => {
    const completions: Array<() => void> = [];
    axiosInstance.get.mockImplementation(() => new Promise((resolve) => {
      completions.push(() => resolve({ data: Buffer.from('ok') }));
    }));
    const first = new QidianHttpClient({
      get: jest.fn((key: string) => ({ qidianMaxConcurrency: 1, qidianMinRequestIntervalMs: 0 }[key])),
    } as never);
    const firstRequest = first.get('https://www.qidian.com/rank/first/');
    await Promise.resolve();

    QidianHttpClient.resetQidianGovernanceForTests();
    const second = new QidianHttpClient({
      get: jest.fn((key: string) => ({ qidianMaxConcurrency: 2, qidianMinRequestIntervalMs: 0 }[key])),
    } as never);
    const secondRequests = [
      second.get('https://www.qidian.com/rank/second/'),
      second.get('https://www.qidian.com/rank/third/'),
    ];
    await Promise.resolve();

    expect(axiosInstance.get).toHaveBeenCalledTimes(3);
    completions.splice(0).forEach((complete) => complete());
    await expect(Promise.all([firstRequest, ...secondRequests])).resolves.toHaveLength(3);
  });

  it('returns response bodies and preserves generic normalized errors', async () => {
    const failure = new AxiosError('offline', 'ERR_NETWORK');
    axiosInstance.get.mockRejectedValue(failure);
    const client = new QidianHttpClient({
      get: jest.fn((key: string) => ({ httpRetries: 0, qidianMinRequestIntervalMs: 0 }[key])),
    } as never);

    await expect(client.get('https://www.qidian.com/rank/hotsales/')).rejects.toBeInstanceOf(HttpRequestError);
  });
});
