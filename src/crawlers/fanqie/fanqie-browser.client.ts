import { Injectable, type Logger, type OnModuleDestroy } from "@nestjs/common";
import { chromium, type Browser, type LaunchOptions, type Page } from "playwright";
import {
  FANQIE_BASE_URL,
  FANQIE_BOOK_PATH_PREFIX,
  FANQIE_HOME_PATH,
  FANQIE_MAX_CONTENT_LENGTH_BYTES,
  FANQIE_RANKING_PATH_PREFIX,
} from "./fanqie.constants";

export interface FanqieRankingPage {
  initialState: unknown;
  sourceUrl: string;
  fetchedAt: Date;
}

export interface FanqieBookPage {
  html: string;
  sourceUrl: string;
  fetchedAt: Date;
}

export interface FanqieBrowserLauncher {
  launch(options: LaunchOptions): Promise<Browser>;
}

export interface FanqieBrowserClientOptions {
  logger: Pick<Logger, "error" | "log" | "warn">;
  requestTimeoutMs: number;
  launcher?: FanqieBrowserLauncher;
}

export class FanqieBrowserClientError extends Error {
  override readonly name = "FanqieBrowserClientError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

const ACCESS_CONTROL_HTTP_STATUSES = new Set([401, 403, 429]);

@Injectable()
export class FanqieBrowserClient implements OnModuleDestroy {
  private browser: Browser | null = null;
  private browserPromise: Promise<Browser> | null = null;
  private readonly launcher: FanqieBrowserLauncher;

  constructor(private readonly options: FanqieBrowserClientOptions) {
    this.launcher = options.launcher ?? chromium;
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async fetchRanking(rankTypeKey: string): Promise<FanqieRankingPage> {
    if (!/^[01]_[12]_\d+$/.test(rankTypeKey)) {
      throw new FanqieBrowserClientError("Invalid Fanqie ranking key");
    }

    const expectedPathname = `${FANQIE_RANKING_PATH_PREFIX}${rankTypeKey}`;
    const requestUrl = this.resolveTrustedUrl(expectedPathname);

    try {
      return await this.withPage(async (page) => {
        await this.navigate(page, requestUrl);
        const sourceUrl = this.assertExpectedUrl(
          page.url(),
          expectedPathname,
        ).href;
        await page.waitForFunction(
          () =>
            typeof (
              window as Window & { __INITIAL_STATE__?: unknown }
            ).__INITIAL_STATE__ !== "undefined",
          undefined,
          { timeout: this.options.requestTimeoutMs },
        );
        const initialState = await page.evaluate(() => {
          const state = (
            window as Window & { __INITIAL_STATE__?: unknown }
          ).__INITIAL_STATE__;

          if (
            typeof state !== "object" ||
            state === null ||
            Array.isArray(state)
          ) {
            return {};
          }

          const record = state as Record<string, unknown>;
          const selectBranch = (value: unknown): unknown => {
            if (Array.isArray(value)) {
              return value;
            }

            if (
              typeof value !== "object" ||
              value === null ||
              Array.isArray(value)
            ) {
              return undefined;
            }

            const branch = value as Record<string, unknown>;
            return {
              bookList: branch.bookList,
              book_list: branch.book_list,
              list: branch.list,
            };
          };

          return {
            rankBookList: selectBranch(record.rankBookList),
            rankData: selectBranch(record.rankData ?? record.rank),
            pageData: selectBranch(record.pageData),
          };
        });

        if (!this.hasRankingCandidate(initialState)) {
          throw new FanqieBrowserClientError(
            "Fanqie ranking state was unavailable",
          );
        }

        return { initialState, sourceUrl, fetchedAt: new Date() };
      });
    } catch (error) {
      throw this.toClientError(error, "Fanqie ranking request failed");
    }
  }

  async fetchBook(externalBookId: string): Promise<FanqieBookPage> {
    if (!/^\d+$/.test(externalBookId)) {
      throw new FanqieBrowserClientError("Invalid Fanqie book ID");
    }

    const expectedPathname = `${FANQIE_BOOK_PATH_PREFIX}${externalBookId}`;

    try {
      return await this.withPage(async (page) => {
        const homeUrl = this.resolveTrustedUrl(FANQIE_HOME_PATH);
        await this.navigate(page, homeUrl);
        this.assertExpectedUrl(page.url(), FANQIE_HOME_PATH);

        const result = await page.evaluate(
          async ({ path, timeoutMs, maximumBytes }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);

            try {
              const response = await fetch(path, {
                credentials: "include",
                signal: controller.signal,
              });
              const contentLength = response.headers.get("content-length");

              if (
                contentLength !== null &&
                /^\d+$/.test(contentLength) &&
                Number(contentLength) > maximumBytes
              ) {
                return {
                  status: response.status,
                  responseUrl: response.url,
                  contentLength,
                  html: null,
                  tooLarge: true,
                };
              }

              return {
                status: response.status,
                responseUrl: response.url,
                contentLength,
                html: await response.text(),
                tooLarge: false,
              };
            } finally {
              clearTimeout(timer);
            }
          },
          {
            path: expectedPathname,
            timeoutMs: this.options.requestTimeoutMs,
            maximumBytes: FANQIE_MAX_CONTENT_LENGTH_BYTES,
          },
        );

        this.assertSuccessfulStatus(result.status);
        const sourceUrl = this.assertExpectedUrl(
          result.responseUrl,
          expectedPathname,
        ).href;

        if (result.tooLarge || result.html === null) {
          throw new FanqieBrowserClientError("Fanqie response was too large");
        }

        this.assertContentLength(result.contentLength, result.html);

        if (this.detectAccessBlock("", result.html)) {
          throw new FanqieBrowserClientError("Fanqie access was blocked");
        }

        return {
          html: result.html,
          sourceUrl,
          fetchedAt: new Date(),
        };
      });
    } catch (error) {
      throw this.toClientError(error, "Fanqie book request failed");
    }
  }

  async close(): Promise<void> {
    const pendingBrowser = this.browserPromise;
    let browser = this.browser;
    this.browser = null;
    this.browserPromise = null;

    if (browser === null && pendingBrowser !== null) {
      browser = await pendingBrowser.catch(() => null);
      this.browser = null;
      this.browserPromise = null;
    }

    if (browser !== null) {
      this.options.logger.log("closing browser");
      await browser.close();
    }
  }

  private async withPage<T>(action: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1920, height: 1080 },
    });

    try {
      const page = await context.newPage();
      return await action(page);
    } finally {
      await context.close();
    }
  }

  private async navigate(page: Page, url: URL): Promise<void> {
    this.options.logger.log(`GET ${url.href}`);
    const response = await page.goto(url.href, {
      timeout: this.options.requestTimeoutMs,
      waitUntil: "load",
    });

    if (response === null) {
      throw new FanqieBrowserClientError("Fanqie request returned no response");
    }

    this.assertSuccessfulStatus(response.status());
    await this.assertPageIsAllowed(page);
  }

  private hasRankingCandidate(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    return Object.values(value).some((branch) => {
      if (Array.isArray(branch)) {
        return branch.length > 0;
      }

      if (
        typeof branch !== "object" ||
        branch === null ||
        Array.isArray(branch)
      ) {
        return false;
      }

      const record = branch as Record<string, unknown>;
      return [record.bookList, record.book_list, record.list].some(
        (candidate) => Array.isArray(candidate) && candidate.length > 0,
      );
    });
  }

  private toClientError(error: unknown, message: string): Error {
    if (error instanceof FanqieBrowserClientError) {
      return error;
    }

    return new FanqieBrowserClientError(message, { cause: error });
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    if (this.browserPromise === null) {
      this.options.logger.log("launching browser (channel: msedge)");
      this.browserPromise = this.launcher
        .launch({
          channel: "msedge",
          headless: true,
          args: ["--disable-blink-features=AutomationControlled"],
        })
        .then((browser) => {
          this.browser = browser;
          return browser;
        })
        .catch((error: unknown) => {
          this.browserPromise = null;
          throw error;
        });
    }

    return this.browserPromise;
  }

  private async assertPageIsAllowed(page: Page): Promise<void> {
    const title = await page.title();
    const html = await page.content();

    if (this.detectAccessBlock(title, html)) {
      throw new FanqieBrowserClientError("Fanqie access was blocked");
    }
  }

  private detectAccessBlock(title: string, html: string): boolean {
    return (
      /(?:验证码|安全验证|登录|captcha|access denied|forbidden)/i.test(title) ||
      /<(?:title|h1)\b[^>]*>\s*(?:验证码|安全验证|用户登录|access denied|403 forbidden|访问受限)/i.test(
        html,
      )
    );
  }

  private assertSuccessfulStatus(status: number): void {
    if (ACCESS_CONTROL_HTTP_STATUSES.has(status)) {
      throw new FanqieBrowserClientError("Fanqie access was blocked");
    }

    if (status < 200 || status >= 300) {
      throw new FanqieBrowserClientError("Fanqie request failed");
    }
  }

  private assertContentLength(
    declaredLength: string | null,
    html: string,
  ): void {
    if (declaredLength !== null && /^\d+$/.test(declaredLength)) {
      const declaredBytes = Number(declaredLength);

      if (
        !Number.isSafeInteger(declaredBytes) ||
        declaredBytes > FANQIE_MAX_CONTENT_LENGTH_BYTES
      ) {
        throw new FanqieBrowserClientError("Fanqie response was too large");
      }
    }

    if (Buffer.byteLength(html, "utf8") > FANQIE_MAX_CONTENT_LENGTH_BYTES) {
      throw new FanqieBrowserClientError("Fanqie response was too large");
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

      const url = new URL(pathOrUrl, FANQIE_BASE_URL);

      if (
        url.origin !== FANQIE_BASE_URL ||
        url.username !== "" ||
        url.password !== ""
      ) {
        throw new Error("Invalid URL origin");
      }

      return url;
    } catch {
      throw new FanqieBrowserClientError("Fanqie URL is not trusted");
    }
  }

  private assertExpectedUrl(sourceUrl: string, expectedPathname: string): URL {
    const url = this.resolveTrustedUrl(sourceUrl);

    if (url.pathname !== expectedPathname) {
      throw new FanqieBrowserClientError(
        "Fanqie final URL does not match the request",
      );
    }

    return url;
  }
}
