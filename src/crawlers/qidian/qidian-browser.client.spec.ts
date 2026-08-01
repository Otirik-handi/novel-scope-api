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
      code: "QIDIAN_ACCESS_BLOCKED",
      reason: "access-denied",
    });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it("rejects with a Qidian access error when navigation is aborted", async () => {
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
      code: "QIDIAN_ACCESS_BLOCKED",
      reason: "access-denied",
    });
  });
});
