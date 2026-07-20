import axios, { type AxiosAdapter, type AxiosInstance } from "axios";
import { load } from "cheerio";
import { decodeBuffer } from "../../utils/charset.util";
import {
  QIDIAN_ACCEPT,
  QIDIAN_ACCEPT_LANGUAGE,
  QIDIAN_BASE_URL,
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
  ) {
    super(message);
  }
}

export class QidianClient {
  private readonly http: AxiosInstance;

  constructor(private readonly options: QidianClientOptions) {
    this.http = axios.create({ adapter: options.adapter });
  }

  async fetchPage(pathOrUrl: string): Promise<QidianPage> {
    const requestUrl = this.resolveTrustedUrl(pathOrUrl);
    const response = await this.http.get<ArrayBuffer | Uint8Array>(
      requestUrl.href,
      {
        headers: {
          Accept: QIDIAN_ACCEPT,
          "Accept-Language": QIDIAN_ACCEPT_LANGUAGE,
          "User-Agent": this.options.userAgent,
        },
        responseType: "arraybuffer",
        timeout: this.options.requestTimeoutMs,
        validateStatus: (status) =>
          (status >= 200 && status < 300) ||
          ACCESS_CONTROL_HTTP_STATUSES.has(status),
      },
    );
    const sourceUrl = this.resolveTrustedUrl(
      this.extractFinalUrl(response.request) ?? requestUrl.href,
    ).href;
    const contentType = this.getHeaderString(
      response.headers,
      "content-type",
    );
    const bytes =
      response.data instanceof ArrayBuffer
        ? new Uint8Array(response.data)
        : response.data;

    const html = decodeBuffer(bytes, contentType);
    const blockReason =
      this.detectAccessBlock(html, sourceUrl) ??
      this.getStatusBlockReason(response.status);

    if (blockReason) {
      throw new QidianClientError(
        "Qidian access was blocked",
        "QIDIAN_ACCESS_BLOCKED",
        blockReason,
      );
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
      (title &&
        /(?:安全验证|验证码|captcha|security verification)/i.test(title)) ||
      /<(?:form|div|section)\b[^>]*(?:id|class)\s*=\s*["'][^"']*(?:captcha|geetest|verify(?:-?code)?)[^"']*["'][^>]*>/i.test(
        html,
      )
    ) {
      return "captcha";
    }

    if (
      title &&
      /(?:用户登录|登录\s*[-_|]\s*起点中文网|sign\s*in)/i.test(title)
    ) {
      return "login";
    }

    if (this.hasStructuredLoginForm(html)) {
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

    return undefined;
  }

  private hasStructuredLoginForm(html: string): boolean {
    if (!/<form\b/i.test(html)) {
      return false;
    }

    const $ = load(html);

    return $("form")
      .toArray()
      .some((form) => {
        const element = $(form);

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
}
