import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { chromium, type Browser, type Page } from "playwright";
import { QIDIAN_BASE_URL } from "./qidian.constants";
import {
  QidianClientError,
  type QidianAccessBlockReason,
  type QidianPage,
} from "./qidian.client";

export interface QidianBrowserClientOptions {
  logger: Logger;
  requestTimeoutMs: number;
}

const ACCESS_CONTROL_HTTP_STATUSES = new Set([401, 403, 429]);

const abortError = () =>
  new QidianClientError(
    "Qidian access was blocked",
    "QIDIAN_ACCESS_BLOCKED",
    "access-denied",
  );

@Injectable()
export class QidianBrowserClient implements OnModuleDestroy {
  private browser: Browser | null = null;
  private browserPromise: Promise<Browser> | null = null;

  constructor(private readonly options: QidianBrowserClientOptions) {}

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async fetchPage(pathOrUrl: string, signal?: AbortSignal): Promise<QidianPage> {
    let url: URL;

    try {
      url = this.resolveTrustedUrl(pathOrUrl);
    } catch (error) {
      this.options.logger.error(
        `untrusted URL: ${pathOrUrl}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }

    if (signal?.aborted) {
      throw abortError();
    }

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1920, height: 1080 },
    });

    try {
      const page = await context.newPage();
      this.options.logger.log(`GET ${url.href}`);
      const startedAt = Date.now();

      const navigation = page.goto(url.href, {
        timeout: this.options.requestTimeoutMs,
        waitUntil: "load",
      }).catch((error: unknown) => {
        const elapsed = Date.now() - startedAt;
        this.options.logger.error(
          `GET ${url.href} failed (${elapsed}ms)`,
          error instanceof Error ? error.stack : String(error),
        );
        throw error;
      });
      let abortListener: (() => void) | undefined;
      const abortPromise = new Promise<never>((_resolve, reject) => {
        if (!signal) {
          return;
        }
        abortListener = () => reject(abortError());
        if (signal.aborted) {
          abortListener();
          return;
        }
        signal.addEventListener("abort", abortListener, { once: true });
      });
      let response: Awaited<ReturnType<Page["goto"]>> | null = null;

      try {
        response = await Promise.race([navigation, abortPromise]);
      } finally {
        if (signal && abortListener) {
          signal.removeEventListener("abort", abortListener);
        }
      }

      const elapsed = Date.now() - startedAt;

      if (response) {
        const status = response.status();
        const finalUrl = page.url();
        this.options.logger.log(
          `${status} ${finalUrl} (${elapsed}ms)`,
        );

        if (ACCESS_CONTROL_HTTP_STATUSES.has(status)) {
          const reason: QidianAccessBlockReason =
            status === 401 ? "login" : "access-denied";
          this.options.logger.warn(
            `access blocked: ${reason} (HTTP ${status})`,
          );
          throw new QidianClientError(
            "Qidian access was blocked",
            "QIDIAN_ACCESS_BLOCKED",
            reason,
          );
        }
      } else {
        this.options.logger.log(
          `(no response) ${page.url()} (${elapsed}ms)`,
        );
      }

      let sourceUrl: string;

      try {
        sourceUrl = this.resolveTrustedUrl(page.url()).href;
      } catch (error) {
        this.options.logger.error(
          `redirected to untrusted URL: ${page.url()}`,
          error instanceof Error ? error.stack : undefined,
        );
        throw error;
      }

      const html = await page.content();
      const title = await page.title();
      const hasSsrScript = html.includes("vite-plugin-ssr_pageContext");
      const hasBookDataScript = html.includes("book-detail-data");
      const hasBookInfo = html.includes("book-information");
      this.options.logger.log(
        `title: ${title}, ssrScript: ${hasSsrScript}, bookDataScript: ${hasBookDataScript}, bookInfo: ${hasBookInfo}`,
      );
      this.options.logger.log(`content: ${html.length} chars`);

      if (hasBookInfo) {
        const domInfo = await page.evaluate(() => {
          const root = document.querySelector(".book-information");
          if (!root) return "no .book-information";
          const h1 = root.querySelector("h1 em, h1 .book-title, h1");
          const writer = root.querySelector(".writer, .author .name, [data-author]");
          const bookId = root.getAttribute("data-book-id");
          return {
            bookId,
            h1Tag: h1?.tagName ?? "none",
            h1Text: h1?.textContent?.trim().substring(0, 80) ?? "",
            writerTag: writer?.tagName ?? "none",
            writerText: writer?.textContent?.trim().substring(0, 40) ?? "",
            htmlSnippet: root.outerHTML.substring(0, 500),
          };
        });
        this.options.logger.log(
          `DOM: ${JSON.stringify(domInfo)}`,
        );
      }

      return { html, sourceUrl };
    } finally {
      await context.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      this.options.logger.log("closing browser");
      await this.browser.close();
      this.browser = null;
      this.browserPromise = null;
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    if (!this.browserPromise) {
      this.options.logger.log("launching browser (channel: msedge)");
      const startedAt = Date.now();
      this.browserPromise = chromium.launch({
        channel: "msedge",
        headless: true,
        args: [
          "--disable-blink-features=AutomationControlled",
        ],
      });
      this.browser = await this.browserPromise;
      this.options.logger.log(
        `browser launched (${Date.now() - startedAt}ms)`,
      );
    }

    return this.browserPromise;
  }

  private resolveTrustedUrl(pathOrUrl: string): URL {
    try {
      if (
        !pathOrUrl ||
        pathOrUrl.trim() !== pathOrUrl ||
        /^[\\/]{2}/.test(pathOrUrl)
      ) {
        throw new Error("Invalid URL input");
      }

      const url = new URL(pathOrUrl, QIDIAN_BASE_URL);

      if (
        url.origin !== QIDIAN_BASE_URL ||
        url.username !== "" ||
        url.password !== ""
      ) {
        throw new Error("Invalid URL origin");
      }

      return url;
    } catch {
      throw new QidianClientError(
        "Qidian URL is not trusted",
        "QIDIAN_UNTRUSTED_URL",
      );
    }
  }
}
