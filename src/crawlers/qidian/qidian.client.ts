import axios, { type AxiosAdapter, type AxiosInstance } from "axios";
import { load } from "cheerio";
import { decodeBuffer } from "../../utils/charset.util";
import {
  QIDIAN_ACCEPT,
  QIDIAN_ACCEPT_LANGUAGE,
  QIDIAN_BASE_URL,
  QIDIAN_MAX_CONTENT_LENGTH_BYTES,
  QIDIAN_MAX_REDIRECTS,
} from "./qidian.constants";

export interface QidianClientOptions {
  adapter?: AxiosAdapter;
  requestTimeoutMs: number;
  userAgent: string;
}

export interface QidianPage {
  html: string;
  sourceUrl: string;
}

export type QidianClientErrorCode =
  | "QIDIAN_ACCESS_BLOCKED"
  | "QIDIAN_UNTRUSTED_URL";

export type QidianAccessBlockReason =
  | "captcha"
  | "login"
  | "access-denied";

const ACCESS_CONTROL_HTTP_STATUSES = new Set([401, 403, 429]);

export class QidianClientError extends Error {
  override readonly name = "QidianClientError";

  constructor(
    message: string,
    readonly code: QidianClientErrorCode,
    readonly reason?: QidianAccessBlockReason,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class QidianClient {
  private readonly http: AxiosInstance;

  constructor(private readonly options: QidianClientOptions) {
    this.http = axios.create({ adapter: options.adapter });
  }

  async fetchPage(pathOrUrl: string): Promise<QidianPage> {
    const requestUrl = this.resolveTrustedUrl(pathOrUrl);
    const response = await this.http
      .get<ArrayBuffer | Uint8Array>(requestUrl.href, {
        beforeRedirect: (redirectOptions) => {
          const href = redirectOptions.href;

          if (typeof href !== "string") {
            throw new QidianClientError(
              "Qidian URL is not trusted",
              "QIDIAN_UNTRUSTED_URL",
            );
          }

          this.resolveTrustedUrl(href);
        },
        headers: {
          Accept: QIDIAN_ACCEPT,
          "Accept-Language": QIDIAN_ACCEPT_LANGUAGE,
          "User-Agent": this.options.userAgent,
        },
        maxContentLength: QIDIAN_MAX_CONTENT_LENGTH_BYTES,
        maxRedirects: QIDIAN_MAX_REDIRECTS,
        responseType: "arraybuffer",
        timeout: this.options.requestTimeoutMs,
        validateStatus: (status) =>
          (status >= 200 && status < 300) ||
          ACCESS_CONTROL_HTTP_STATUSES.has(status),
      })
      .catch((error: unknown) => {
        throw this.findQidianClientError(error) ?? error;
      });
    const finalUrl = this.extractFinalUrl(response.request);

    if (!finalUrl && this.hasRedirected(response.request)) {
      throw new QidianClientError(
        "Qidian URL is not trusted",
        "QIDIAN_UNTRUSTED_URL",
      );
    }

    const sourceUrl = this.resolveTrustedUrl(finalUrl ?? requestUrl.href).href;
    const contentType = this.getHeaderString(
      response.headers,
      "content-type",
    );
    const bytes =
      response.data instanceof ArrayBuffer
        ? new Uint8Array(response.data)
        : response.data;

    const statusBlockReason = this.getStatusBlockReason(response.status);
    let html: string;

    try {
      html = decodeBuffer(bytes, contentType);
    } catch (error) {
      if (statusBlockReason) {
        throw this.createAccessBlockedError(statusBlockReason, error);
      }

      throw error;
    }

    const blockReason =
      this.detectAccessBlock(html, sourceUrl) ?? statusBlockReason;

    if (blockReason) {
      throw this.createAccessBlockedError(blockReason);
    }

    return { html, sourceUrl };
  }

  private getStatusBlockReason(
    status: number,
  ): QidianAccessBlockReason | undefined {
    if (status === 401) {
      return "login";
    }

    if (status === 403 || status === 429) {
      return "access-denied";
    }

    return undefined;
  }

  private createAccessBlockedError(
    reason: QidianAccessBlockReason,
    cause?: unknown,
  ): QidianClientError {
    return new QidianClientError(
      "Qidian access was blocked",
      "QIDIAN_ACCESS_BLOCKED",
      reason,
      cause === undefined ? undefined : { cause },
    );
  }

  private findQidianClientError(
    error: unknown,
  ): QidianClientError | undefined {
    const seen = new Set<unknown>();
    let current = error;

    while (typeof current === "object" && current !== null) {
      if (current instanceof QidianClientError) {
        return current;
      }

      if (seen.has(current)) {
        return undefined;
      }

      seen.add(current);
      current = (current as { cause?: unknown }).cause;
    }

    return undefined;
  }

  private getHeaderString(headers: unknown, name: string): string | undefined {
    if (typeof headers !== "object" || headers === null) {
      return undefined;
    }

    const getter = (headers as { get?: unknown }).get;

    if (typeof getter === "function") {
      const value = (getter as (headerName: string) => unknown).call(
        headers,
        name,
      );
      const header = this.firstNonEmptyString(value);

      if (header) {
        return header;
      }
    }

    const entry = Object.entries(headers).find(
      ([headerName]) => headerName.toLowerCase() === name.toLowerCase(),
    );

    return this.firstNonEmptyString(entry?.[1]);
  }

  private firstNonEmptyString(value: unknown): string | undefined {
    const values = Array.isArray(value) ? value : [value];

    for (const candidate of values) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }

    return undefined;
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

  private detectAccessBlock(
    html: string,
    sourceUrl: string,
  ): QidianAccessBlockReason | undefined {
    const title = html.match(/<title\b[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1];

    if (
      title &&
      /(?:安全验证|验证码|captcha|security verification)/i.test(title)
    ) {
      return "captcha";
    }

    if (
      title &&
      /(?:用户登录|登录\s*[-_|]\s*起点中文网|sign\s*in)/i.test(title)
    ) {
      return "login";
    }

    if (/^\/login(?:\/|$)/i.test(new URL(sourceUrl).pathname)) {
      return "login";
    }

    if (
      /<(?:title|h1)\b[^>]*>\s*(?:access denied|403 forbidden|访问受限|无权访问)/i.test(
        html,
      )
    ) {
      return "access-denied";
    }

    return this.detectDomAccessBlock(html);
  }

  private detectDomAccessBlock(
    html: string,
  ): QidianAccessBlockReason | undefined {
    if (!/(?:captcha|geetest|verify(?:-?code)?|<form\b)/i.test(html)) {
      return undefined;
    }

    const $ = load(html);
    const accessNodes = $("form, div, section").toArray();
    type HtmlElement = (typeof accessNodes)[number];
    const isExplicitlyHidden = (node: HtmlElement): boolean => {
      const element = $(node);
      const ariaHidden = element.attr("aria-hidden")?.trim().toLowerCase();
      const style = element.attr("style")?.replace(/\s+/g, "").toLowerCase();

      return (
        element.attr("hidden") !== undefined ||
        ariaHidden === "true" ||
        Boolean(
          style
            ?.split(";")
            .some(
              (declaration) =>
                declaration.startsWith("display:none") ||
                declaration.startsWith("visibility:hidden"),
            ),
        )
      );
    };
    const isVisible = (node: HtmlElement): boolean =>
      [node, ...$(node).parents().toArray()].every(
        (candidate) => !isExplicitlyHidden(candidate),
      );
    const isCaptchaNode = (node: HtmlElement): boolean => {
      const element = $(node);
      const identity = `${element.attr("id") ?? ""} ${element.attr("class") ?? ""}`;

      return /(?:captcha|geetest|verify(?:-?code)?)/i.test(identity);
    };
    const visibleCaptchaNodes = accessNodes.filter(
      (node) => isCaptchaNode(node) && isVisible(node),
    );

    const visibleLoginForms = $("form")
      .toArray()
      .filter((form) => {
        const element = $(form);

        if (!isVisible(form)) {
          return false;
        }

        if (element.hasClass("login-form")) {
          return true;
        }

        const action = element.attr("action")?.trim();

        if (!action) {
          return false;
        }

        try {
          const actionUrl = new URL(action, QIDIAN_BASE_URL);

          return /^\/login(?:\/|\.html|$)/i.test(actionUrl.pathname);
        } catch {
          return false;
        }
      });
    const visibleBlockers = [
      ...new Set([...visibleCaptchaNodes, ...visibleLoginForms]),
    ];

    if (visibleBlockers.length === 0) {
      return undefined;
    }

    const hasIndependentNormalContent = $(
      "article, .rank-box, .book-information, .book-content-wrap",
    )
      .toArray()
      .some((node) => {
        if (!isVisible(node)) {
          return false;
        }

        const intersectsBlocker = visibleBlockers.some(
          (blocker) =>
            blocker === node ||
            $.contains(node, blocker) ||
            $.contains(blocker, node),
        );

        if (intersectsBlocker) {
          return false;
        }

        const content = $(node).clone();
        content
          .find("script, style, noscript, template")
          .remove();
        content
          .find("*")
          .filter((_index, candidate) => isExplicitlyHidden(candidate))
          .remove();
        const hasImageReference = content
          .find("img[src], img[srcset], picture source[srcset]")
          .toArray()
          .some((image) => {
            const element = $(image);
            const sources = [element.attr("src"), element.attr("srcset")];

            return sources.some((source) => Boolean(source?.trim()));
          });
        const hasBookLink = content
          .find("a[href]")
          .toArray()
          .some((link) => {
            const href = $(link).attr("href")?.trim();

            if (!href) {
              return false;
            }

            try {
              const url = new URL(href, QIDIAN_BASE_URL);
              const bookPath = url.pathname.match(/^\/book\/([^/]+)(?:\/|$)/);

              return (
                url.origin === QIDIAN_BASE_URL &&
                Boolean(bookPath && decodeURIComponent(bookPath[1]).trim())
              );
            } catch {
              return false;
            }
          });

        return (
          content.text().trim().length > 0 ||
          hasImageReference ||
          hasBookLink
        );
      });

    if (hasIndependentNormalContent) {
      return undefined;
    }

    if (visibleCaptchaNodes.length > 0) {
      return "captcha";
    }

    return visibleLoginForms.length > 0 ? "login" : undefined;
  }

  private extractFinalUrl(request: unknown): string | undefined {
    if (typeof request !== "object" || request === null) {
      return undefined;
    }

    const responseUrl = (request as { responseURL?: unknown }).responseURL;

    if (typeof responseUrl === "string") {
      return responseUrl;
    }

    const response = (request as { res?: unknown }).res;

    if (typeof response !== "object" || response === null) {
      return undefined;
    }

    const nodeResponseUrl = (response as { responseUrl?: unknown }).responseUrl;

    return typeof nodeResponseUrl === "string" ? nodeResponseUrl : undefined;
  }

  private hasRedirected(request: unknown): boolean {
    if (typeof request !== "object" || request === null) {
      return false;
    }

    const redirectable = (request as { _redirectable?: unknown })._redirectable;

    if (typeof redirectable !== "object" || redirectable === null) {
      return false;
    }

    const redirectCount = (redirectable as { _redirectCount?: unknown })
      ._redirectCount;

    return typeof redirectCount === "number" && redirectCount > 0;
  }
}
