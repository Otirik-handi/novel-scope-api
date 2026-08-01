import { Logger } from "@nestjs/common";
import { chromium } from "playwright";
import { QidianBrowserClient } from "./qidian-browser.client";

jest.mock("playwright", () => ({
  chromium: { launch: jest.fn() },
}));

const mockLaunch = chromium.launch as unknown as jest.Mock;

function createClient(): QidianBrowserClient {
  const logger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as Logger;

  return new QidianBrowserClient({
    logger,
    requestTimeoutMs: 1_000,
  });
}

function installPage(page: Record<string, unknown>): void {
  const context = {
    newPage: jest.fn().mockResolvedValue(page),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const browser = {
    isConnected: jest.fn().mockReturnValue(true),
    newContext: jest.fn().mockResolvedValue(context),
    close: jest.fn().mockResolvedValue(undefined),
  };

  mockLaunch.mockResolvedValue(browser as never);
}

async function waitForGoto(page: { goto: jest.Mock }): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (page.goto.mock.calls.length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for page.goto");
}

async function waitForCall(mock: jest.Mock): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (mock.mock.calls.length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for mock call");
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("QidianBrowserClient", () => {
  it("rejects an already aborted fetch before page navigation", async () => {
    const page = {
      goto: jest.fn().mockResolvedValue({ status: 200 } as never),
      url: jest.fn().mockReturnValue("https://www.qidian.com/book/1/"),
      content: jest.fn().mockResolvedValue("<html></html>"),
      title: jest.fn().mockResolvedValue(""),
      evaluate: jest.fn(),
    };
    installPage(page);
    const client = createClient();
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.fetchPage("/book/1/", controller.signal),
    ).rejects.toMatchObject({
      name: "QidianClientError",
      code: "QIDIAN_REQUEST_ABORTED",
      reason: "request-aborted",
    });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("rejects with a Qidian request-aborted error when navigation is aborted", async () => {
    const page = {
      goto: jest.fn(),
      url: jest.fn().mockReturnValue("https://www.qidian.com/book/1/"),
      content: jest.fn().mockResolvedValue("<html></html>"),
      title: jest.fn().mockResolvedValue(""),
      evaluate: jest.fn(),
    };
    let rejectNavigation!: (error: unknown) => void;
    page.goto.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectNavigation = reject;
      }),
    );
    installPage(page);
    const client = createClient();
    const controller = new AbortController();
    const fetching = client.fetchPage("/book/1/", controller.signal);

    await waitForGoto(page as unknown as { goto: jest.Mock });
    controller.abort();
    rejectNavigation(new Error("navigation timeout"));

    await expect(fetching).rejects.toMatchObject({
      name: "QidianClientError",
      code: "QIDIAN_REQUEST_ABORTED",
      reason: "request-aborted",
    });
  });

  it("rejects with request-aborted while the browser is launching", async () => {
    const launch = deferred<unknown>();
    mockLaunch.mockReturnValue(launch.promise);
    const client = createClient();
    const controller = new AbortController();
    const fetching = client.fetchPage("/book/1/", controller.signal);

    await waitForCall(mockLaunch);
    controller.abort();

    await expect(fetching).rejects.toMatchObject({
      name: "QidianClientError",
      code: "QIDIAN_REQUEST_ABORTED",
      reason: "request-aborted",
    });
  });

  it("rejects with request-aborted while creating a browser context", async () => {
    const context = deferred<unknown>();
    const browser = {
      isConnected: jest.fn().mockReturnValue(true),
      newContext: jest.fn().mockReturnValue(context.promise),
      close: jest.fn().mockResolvedValue(undefined),
    };
    mockLaunch.mockResolvedValue(browser as never);
    const client = createClient();
    const controller = new AbortController();
    const fetching = client.fetchPage("/book/1/", controller.signal);

    await waitForCall(browser.newContext as unknown as jest.Mock);
    controller.abort();

    await expect(fetching).rejects.toMatchObject({
      name: "QidianClientError",
      code: "QIDIAN_REQUEST_ABORTED",
      reason: "request-aborted",
    });
  });

  it("rejects with request-aborted while creating a page", async () => {
    const page = deferred<unknown>();
    const context = {
      newPage: jest.fn().mockReturnValue(page.promise),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const browser = {
      isConnected: jest.fn().mockReturnValue(true),
      newContext: jest.fn().mockResolvedValue(context),
      close: jest.fn().mockResolvedValue(undefined),
    };
    mockLaunch.mockResolvedValue(browser as never);
    const client = createClient();
    const controller = new AbortController();
    const fetching = client.fetchPage("/book/1/", controller.signal);

    await waitForCall(context.newPage as unknown as jest.Mock);
    controller.abort();

    await expect(fetching).rejects.toMatchObject({
      name: "QidianClientError",
      code: "QIDIAN_REQUEST_ABORTED",
      reason: "request-aborted",
    });
    expect(context.close).toHaveBeenCalled();
  });

  it("rejects with request-aborted while reading page content", async () => {
    const content = deferred<string>();
    const page = {
      goto: jest
        .fn()
        .mockResolvedValue({
          status: jest.fn().mockReturnValue(200),
        } as never),
      url: jest.fn().mockReturnValue("https://www.qidian.com/book/1/"),
      content: jest.fn().mockReturnValue(content.promise),
      title: jest.fn(),
      evaluate: jest.fn(),
    };
    installPage(page);
    const client = createClient();
    const controller = new AbortController();
    const fetching = client.fetchPage("/book/1/", controller.signal);

    await waitForCall(page.content as unknown as jest.Mock);
    controller.abort();

    await expect(fetching).rejects.toMatchObject({
      name: "QidianClientError",
      code: "QIDIAN_REQUEST_ABORTED",
      reason: "request-aborted",
    });
  });

  it("rejects with request-aborted while reading page title", async () => {
    const title = deferred<string>();
    const page = {
      goto: jest
        .fn()
        .mockResolvedValue({
          status: jest.fn().mockReturnValue(200),
        } as never),
      url: jest.fn().mockReturnValue("https://www.qidian.com/book/1/"),
      content: jest.fn().mockResolvedValue("<html></html>"),
      title: jest.fn().mockReturnValue(title.promise),
      evaluate: jest.fn(),
    };
    installPage(page);
    const client = createClient();
    const controller = new AbortController();
    const fetching = client.fetchPage("/book/1/", controller.signal);

    await waitForCall(page.title as unknown as jest.Mock);
    controller.abort();

    await expect(fetching).rejects.toMatchObject({
      name: "QidianClientError",
      code: "QIDIAN_REQUEST_ABORTED",
      reason: "request-aborted",
    });
  });

  it("rejects with request-aborted while evaluating DOM data", async () => {
    const evaluate = deferred<unknown>();
    const page = {
      goto: jest
        .fn()
        .mockResolvedValue({
          status: jest.fn().mockReturnValue(200),
        } as never),
      url: jest.fn().mockReturnValue("https://www.qidian.com/book/1/"),
      content: jest
        .fn()
        .mockResolvedValue(
          '<html><body><div class="book-information"></div></body></html>',
        ),
      title: jest.fn().mockResolvedValue(""),
      evaluate: jest.fn().mockReturnValue(evaluate.promise),
    };
    installPage(page);
    const client = createClient();
    const controller = new AbortController();
    const fetching = client.fetchPage("/book/1/", controller.signal);

    await waitForCall(page.evaluate as unknown as jest.Mock);
    controller.abort();

    await expect(fetching).rejects.toMatchObject({
      name: "QidianClientError",
      code: "QIDIAN_REQUEST_ABORTED",
      reason: "request-aborted",
    });
  });

  it("logs and propagates a navigation failure", async () => {
    const logger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    } as unknown as Logger;
    const page = {
      goto: jest.fn().mockRejectedValue(new Error("navigation timeout")),
      url: jest.fn().mockReturnValue("https://www.qidian.com/book/1/"),
      content: jest.fn().mockResolvedValue("<html></html>"),
      title: jest.fn().mockResolvedValue(""),
      evaluate: jest.fn(),
    };
    installPage(page);
    const client = new QidianBrowserClient({
      logger,
      requestTimeoutMs: 1_000,
    });

    await expect(client.fetchPage("/book/1/")).rejects.toThrow(
      "navigation timeout",
    );
    expect(logger.error).toHaveBeenCalled();
  });
});
