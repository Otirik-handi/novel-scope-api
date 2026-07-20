import axios, { type AxiosAdapter, type AxiosInstance } from "axios";
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
      },
    );
    const sourceUrl = this.resolveTrustedUrl(
      this.extractFinalUrl(response.request) ?? requestUrl.href,
    ).href;
    const contentType = response.headers["content-type"];
    const bytes =
      response.data instanceof ArrayBuffer
        ? new Uint8Array(response.data)
        : response.data;

    const html = decodeBuffer(
      bytes,
      typeof contentType === "string" ? contentType : undefined,
    );
    const blockReason = this.detectAccessBlock(html, sourceUrl);

    if (blockReason) {
      throw new QidianClientError(
        "Qidian access was blocked",
        "QIDIAN_ACCESS_BLOCKED",
        blockReason,
      );
    }

    return { html, sourceUrl };
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
