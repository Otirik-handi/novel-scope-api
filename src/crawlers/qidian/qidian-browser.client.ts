import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { chromium, type Browser } from "playwright";
import { QIDIAN_BASE_URL } from "./qidian.constants";
import {
  createQidianAbortError,
  QidianClientError,
  type QidianAccessBlockReason,
  type QidianPage,
} from "./qidian.client";

export interface QidianBrowserClientOptions {
  logger: Logger;
  requestTimeoutMs: number;
}

const ACCESS_CONTROL_HTTP_STATUSES = new Set([401, 403, 429]);

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
      throw createQidianAbortError();
    }

    const browser = await this.withAbort(signal, this.getBrowser());
    const context = await this.withAbort(
      signal,
      browser.newContext({
        locale: "zh-CN",
        viewport: { width: 1920, height: 1080 },
      }),
    );

    try {
      const page = await this.withAbort(signal, context.newPage());
      this.options.logger.log(`GET ${url.href}`);
      const startedAt = Date.now();

      const response = await this.withAbort(
        signal,
        page.goto(url.href, {
          timeout: this.options.requestTimeoutMs,
          waitUntil: "load",
        }),
      ).catch((error: unknown) => {
        const elapsed = Date.now() - startedAt;
        this.options.logger.error(
          `GET ${url.href} failed (${elapsed}ms)`,
          error instanceof Error ? error.stack : String(error),
        );
        throw error;
      });

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

      const html = await this.withAbort(signal, page.content());
      const title = await this.withAbort(signal, page.title());
      const hasSsrScript = html.includes("vite-plugin-ssr_pageContext");
      const hasBookDataScript = html.includes("book-detail-data");
      const hasBookInfo = html.includes("book-information");
      this.options.logger.log(
        `title: ${title}, ssrScript: ${hasSsrScript}, bookDataScript: ${hasBookDataScript}, bookInfo: ${hasBookInfo}`,
      );
      this.options.logger.log(`content: ${html.length} chars`);

      if (hasBookInfo) {
        const domInfo = await this.withAbort(
          signal,
          page.evaluate(() => {
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
          }),
        );
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

  private async withAbort<T>(
    signal: AbortSignal | undefined,
    operation: Promise<T>,
  ): Promise<T> {
    if (!signal) {
      return operation;
    }

    if (signal.aborted) {
      throw createQidianAbortError();
    }

    let abortListener: () => void = () => {};
    const abortPromise = new Promise<never>((_resolve, reject) => {
      abortListener = () => reject(createQidianAbortError());
      signal.addEventListener("abort", abortListener, { once: true });
    });

    try {
      return await Promise.race([operation, abortPromise]);
    } finally {
      signal.removeEventListener("abort", abortListener);
    }
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
