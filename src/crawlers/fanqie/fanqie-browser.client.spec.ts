import type { Browser, BrowserContext, Page, Response } from "playwright";
import {
  FanqieBrowserClient,
  FanqieBrowserClientError,
  type FanqieBrowserLauncher,
} from "./fanqie-browser.client";
import { FANQIE_MAX_CONTENT_LENGTH_BYTES } from "./fanqie.constants";

interface HarnessOptions {
  status?: number;
  pageUrl?: string;
  title?: string;
  html?: string;
  waitError?: Error;
  evaluateResult?: unknown;
}

function createHarness(options: HarnessOptions = {}) {
  const response = {
    status: jest.fn().mockReturnValue(options.status ?? 200),
  } as unknown as Response;
  const page = {
    goto: jest.fn().mockResolvedValue(response),
    url: jest
      .fn()
      .mockReturnValue(
        options.pageUrl ?? "https://fanqienovel.com/rank/0_1_1139",
      ),
    title: jest.fn().mockResolvedValue(options.title ?? "正常页面"),
    content: jest.fn().mockResolvedValue(options.html ?? "<html></html>"),
    waitForFunction: options.waitError
      ? jest.fn().mockRejectedValue(options.waitError)
      : jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(
      options.evaluateResult ?? {
        rankData: { book_list: [{ bookId: "1" }] },
      },
    ),
  } as unknown as Page;
  const context = {
    newPage: jest.fn().mockResolvedValue(page),
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as BrowserContext;
  const browser = {
    isConnected: jest.fn().mockReturnValue(true),
    newContext: jest.fn().mockResolvedValue(context),
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as Browser;
  const launcher = {
    launch: jest.fn().mockResolvedValue(browser),
  } as unknown as FanqieBrowserLauncher;
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const client = new FanqieBrowserClient({
    logger,
    requestTimeoutMs: 1_000,
    launcher,
  });

  return { client, launcher, browser, context, page };
}

describe("FanqieBrowserClient", () => {
  it("returns a trusted ranking state and closes its context", async () => {
    const { client, launcher, context, page } = createHarness();

    await expect(client.fetchRanking("0_1_1139")).resolves.toMatchObject({
      initialState: { rankData: { book_list: [{ bookId: "1" }] } },
      sourceUrl: "https://fanqienovel.com/rank/0_1_1139",
      fetchedAt: expect.any(Date),
    });
    expect(launcher.launch).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenCalledWith(
      "https://fanqienovel.com/rank/0_1_1139",
      expect.objectContaining({ timeout: 1_000, waitUntil: "load" }),
    );
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it.each(["", "0_3_1139", "https://evil.example/rank/0_1_1139"])(
    "rejects invalid ranking input %p before launching",
    async (key) => {
      const { client, launcher } = createHarness();

      await expect(client.fetchRanking(key)).rejects.toBeInstanceOf(
        FanqieBrowserClientError,
      );
      expect(launcher.launch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://evil.example/rank/0_1_1139",
    "https://user:password@fanqienovel.com/rank/0_1_1139",
    "https://fanqienovel.com/rank/0_1_1140",
  ])("rejects an untrusted final ranking URL %s", async (pageUrl) => {
    const { client, context } = createHarness({ pageUrl });

    await expect(client.fetchRanking("0_1_1139")).rejects.toBeInstanceOf(
      FanqieBrowserClientError,
    );
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 429])(
    "rejects access-control status %s and closes the context",
    async (status) => {
      const { client, context } = createHarness({ status });

      await expect(client.fetchRanking("0_1_1139")).rejects.toThrow(
        "Fanqie access was blocked",
      );
      expect(context.close).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { title: "安全验证码", html: "<html></html>" },
    { title: "正常页面", html: "<h1>用户登录</h1>" },
  ])("rejects a blocked page", async (blockedPage) => {
    const { client, context } = createHarness(blockedPage);

    await expect(client.fetchRanking("0_1_1139")).rejects.toThrow(
      "Fanqie access was blocked",
    );
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("wraps a ranking wait timeout and closes the context", async () => {
    const { client, context } = createHarness({
      waitError: new Error("timeout"),
    });

    await expect(client.fetchRanking("0_1_1139")).rejects.toThrow(
      "Fanqie ranking request failed",
    );
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("rejects a missing ranking candidate", async () => {
    const { client, context } = createHarness({ evaluateResult: {} });

    await expect(client.fetchRanking("0_1_1139")).rejects.toThrow(
      "Fanqie ranking state was unavailable",
    );
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("fetches a book through the trusted same-origin page", async () => {
    const evaluateResult = {
      status: 200,
      responseUrl: "https://fanqienovel.com/page/7001",
      contentLength: "13",
      html: "<html></html>",
      tooLarge: false,
    };
    const { client, context, page } = createHarness({
      pageUrl: "https://fanqienovel.com/",
      evaluateResult,
    });

    await expect(client.fetchBook("7001")).resolves.toMatchObject({
      html: "<html></html>",
      sourceUrl: "https://fanqienovel.com/page/7001",
      fetchedAt: expect.any(Date),
    });
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      path: "/page/7001",
      timeoutMs: 1_000,
      maximumBytes: FANQIE_MAX_CONTENT_LENGTH_BYTES,
    });
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it.each([500, 401])("rejects book response status %s", async (status) => {
    const { client, context } = createHarness({
      pageUrl: "https://fanqienovel.com/",
      evaluateResult: {
        status,
        responseUrl: "https://fanqienovel.com/page/7001",
        contentLength: "0",
        html: "",
        tooLarge: false,
      },
    });

    await expect(client.fetchBook("7001")).rejects.toBeInstanceOf(
      FanqieBrowserClientError,
    );
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      contentLength: String(FANQIE_MAX_CONTENT_LENGTH_BYTES + 1),
      html: null,
      tooLarge: true,
    },
    {
      contentLength: null,
      html: "x".repeat(FANQIE_MAX_CONTENT_LENGTH_BYTES + 1),
      tooLarge: false,
    },
  ])("rejects an oversized book response", async (sizeResult) => {
    const { client, context } = createHarness({
      pageUrl: "https://fanqienovel.com/",
      evaluateResult: {
        status: 200,
        responseUrl: "https://fanqienovel.com/page/7001",
        ...sizeResult,
      },
    });

    await expect(client.fetchBook("7001")).rejects.toThrow(
      "Fanqie response was too large",
    );
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("rejects an unexpected final book path", async () => {
    const { client, context } = createHarness({
      pageUrl: "https://fanqienovel.com/",
      evaluateResult: {
        status: 200,
        responseUrl: "https://fanqienovel.com/page/7002",
        contentLength: "13",
        html: "<html></html>",
        tooLarge: false,
      },
    });

    await expect(client.fetchBook("7001")).rejects.toBeInstanceOf(
      FanqieBrowserClientError,
    );
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it("closes the reused browser only once", async () => {
    const { client, browser } = createHarness();
    await client.fetchRanking("0_1_1139");

    await client.onModuleDestroy();
    await client.onModuleDestroy();

    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
