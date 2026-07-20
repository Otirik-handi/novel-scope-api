import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import iconv from "iconv-lite";
import { QidianClient } from "./qidian.client";

const REQUEST_TIMEOUT_MS = 8_000;
const USER_AGENT = "NovelScope/0.1 test";

function createAdapter(
  response: Partial<AxiosResponse<ArrayBuffer>> = {},
): {
  adapter: AxiosAdapter;
  requests: InternalAxiosRequestConfig[];
} {
  const requests: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    requests.push(config);

    const result = {
      data: Buffer.from("<html>ok</html>"),
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/html; charset=utf-8" },
      config,
      ...response,
    };

    if (
      result.status &&
      config.validateStatus &&
      !config.validateStatus(result.status)
    ) {
      throw new AxiosError(
        `Request failed with status code ${result.status}`,
        result.status >= 500
          ? AxiosError.ERR_BAD_RESPONSE
          : AxiosError.ERR_BAD_REQUEST,
        config,
        undefined,
        result,
      );
    }

    return result;
  };

  return { adapter, requests };
}

function createClient(adapter: AxiosAdapter): QidianClient {
  return new QidianClient({
    adapter,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    userAgent: USER_AGENT,
  });
}

function createRedirectOptions(target: string): Record<string, unknown> {
  const url = new URL(target);

  return {
    href: url.href,
    host: url.host,
    hostname: url.hostname,
    path: `${url.pathname}${url.search}`,
    pathname: url.pathname,
    port: url.port,
    protocol: url.protocol,
    search: url.search,
  };
}

describe("QidianClient", () => {
  it("requests a trusted Qidian URL with bounded arraybuffer settings", async () => {
    const { adapter, requests } = createAdapter();
    const client = createClient(adapter);

    await client.fetchPage("/rank/yuepiao/");

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://www.qidian.com/rank/yuepiao/");
    expect(requests[0].method).toBe("get");
    expect(requests[0].responseType).toBe("arraybuffer");
    expect(requests[0].timeout).toBe(REQUEST_TIMEOUT_MS);
    expect(requests[0].maxContentLength).toBe(5 * 1024 * 1024);
    expect(Number.isFinite(requests[0].maxContentLength)).toBe(true);
    expect(requests[0].headers.get("User-Agent")).toBe(USER_AGENT);
    expect(requests[0].headers.get("Accept-Language")).toContain("zh-CN");
  });

  it("returns the final Node adapter redirect URL", async () => {
    const sourceUrl = "https://www.qidian.com/rank/yuepiao/?page=2";
    const { adapter } = createAdapter({
      request: { res: { responseUrl: sourceUrl } },
    });

    await expect(createClient(adapter).fetchPage("/rank/yuepiao/")).resolves.toEqual(
      {
        html: "<html>ok</html>",
        sourceUrl,
      },
    );
  });

  it("fails closed when a redirected response has no final URL", async () => {
    const { adapter, requests } = createAdapter({
      request: { _redirectable: { _redirectCount: 1 }, res: {} },
    });

    await expect(
      createClient(adapter).fetchPage("/rank/yuepiao/"),
    ).rejects.toMatchObject({
      code: "QIDIAN_UNTRUSTED_URL",
      name: "QidianClientError",
    });
    expect(requests).toHaveLength(1);
  });

  it("decodes the response using the Content-Type charset", async () => {
    const html = "<html><body>月票榜</body></html>";
    const { adapter } = createAdapter({
      data: iconv.encode(html, "gb18030"),
      headers: { "content-type": "text/html; charset=gb18030" },
    });

    await expect(createClient(adapter).fetchPage("/rank/yuepiao/")).resolves.toEqual(
      {
        html,
        sourceUrl: "https://www.qidian.com/rank/yuepiao/",
      },
    );
  });

  it("defaults to UTF-8 when Content-Type has no charset", async () => {
    const html = "<html><body>新书</body></html>";
    const { adapter } = createAdapter({
      data: Buffer.from(html),
      headers: { "content-type": "text/html" },
    });

    await expect(createClient(adapter).fetchPage("/book/123/")).resolves.toEqual({
      html,
      sourceUrl: "https://www.qidian.com/book/123/",
    });
  });

  it.each(["Content-Type", "CONTENT-TYPE"])(
    "decodes a string-array %s header using its first non-empty value",
    async (headerName) => {
      const html = "<html><body>收藏榜</body></html>";
      const { adapter } = createAdapter({
        data: iconv.encode(html, "gb18030"),
        headers: {
          [headerName]: ["", "text/html; charset=gb18030"],
        },
      });

      await expect(
        createClient(adapter).fetchPage("/rank/collect/"),
      ).resolves.toMatchObject({ html });
    },
  );

  it("reads Content-Type through AxiosHeaders.get", async () => {
    const html = "<html><body>畅销榜</body></html>";
    const headers = new AxiosHeaders();
    headers.set("Content-Type", "text/html; charset=gb18030");
    const { adapter } = createAdapter({
      data: iconv.encode(html, "gb18030"),
      headers,
    });

    await expect(
      createClient(adapter).fetchPage("/rank/hotsales/"),
    ).resolves.toMatchObject({ html });
  });

  it.each([
    "//example.com/rank/yuepiao/",
    "https://example.com/rank/yuepiao/",
    "http://www.qidian.com/rank/yuepiao/",
    "https://www.qidian.com.example/rank/yuepiao/",
    "https://user@www.qidian.com/rank/yuepiao/",
  ])("rejects an untrusted request URL before sending it: %s", async (url) => {
    const { adapter, requests } = createAdapter();

    await expect(createClient(adapter).fetchPage(url)).rejects.toMatchObject({
      code: "QIDIAN_UNTRUSTED_URL",
      name: "QidianClientError",
    });
    expect(requests).toHaveLength(0);
  });

  it("rejects an off-domain final redirect URL", async () => {
    const { adapter, requests } = createAdapter({
      request: {
        res: { responseUrl: "https://passport.qidian.com/login.html" },
      },
    });

    await expect(
      createClient(adapter).fetchPage("/rank/yuepiao/"),
    ).rejects.toMatchObject({
      code: "QIDIAN_UNTRUSTED_URL",
      name: "QidianClientError",
    });
    expect(requests).toHaveLength(1);
  });

  it.each([
    "https://example.com/untrusted",
    "http://www.qidian.com/insecure",
    "https://user@www.qidian.com/private",
  ])("blocks an untrusted redirect before its request: %s", async (target) => {
    let secondHopStarted = false;
    let redirectTrustError: unknown;
    const adapter: AxiosAdapter = async (config) => {
      try {
        config.beforeRedirect?.(
          createRedirectOptions(target),
          { headers: {}, statusCode: 302 },
          {
            headers: {},
            method: "GET",
            url: "https://www.qidian.com/rank/yuepiao/",
          },
        );
      } catch (error) {
        redirectTrustError = error;
        const redirectError = new Error("Redirect failed", { cause: error });

        throw AxiosError.from(
          redirectError,
          "ERR_FR_REDIRECTION_FAILURE",
          config,
        );
      }

      secondHopStarted = true;
      throw new AxiosError(
        "External redirect returned 404",
        AxiosError.ERR_BAD_REQUEST,
        config,
      );
    };

    const received = await createClient(adapter)
      .fetchPage("/rank/yuepiao/")
      .catch((error: unknown) => error);

    expect(received).toMatchObject({
      code: "QIDIAN_UNTRUSTED_URL",
      name: "QidianClientError",
    });
    expect(received).toBe(redirectTrustError);
    expect(secondHopStarted).toBe(false);
  });

  it("allows a bounded same-origin HTTPS redirect", async () => {
    const target = "https://www.qidian.com/rank/yuepiao/?page=2";
    let secondHopStarted = false;
    const adapter: AxiosAdapter = async (config) => {
      config.beforeRedirect?.(
        createRedirectOptions(target),
        { headers: {}, statusCode: 302 },
        {
          headers: {},
          method: "GET",
          url: "https://www.qidian.com/rank/yuepiao/",
        },
      );
      secondHopStarted = true;
      expect(config.maxRedirects).toBe(5);

      return {
        data: Buffer.from("<html>ok</html>"),
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/html; charset=utf-8" },
        config,
        request: { res: { responseUrl: target } },
      };
    };

    await expect(
      createClient(adapter).fetchPage("/rank/yuepiao/"),
    ).resolves.toMatchObject({ sourceUrl: target });
    expect(secondHopStarted).toBe(true);
  });

  it.each([
    [
      "captcha",
      "<html><head><title>安全验证</title></head><body><div id=\"captcha\">请完成验证码</div></body></html>",
    ],
    [
      "captcha",
      "<html><head><title>起点中文网</title></head><body><form class=\"captcha-panel\"></form></body></html>",
    ],
    [
      "login",
      "<html><head><title>用户登录 | 起点中文网</title></head><body><form action=\"/login\"></form></body></html>",
    ],
    [
      "access-denied",
      "<html><head><title>Access Denied</title></head><body>Request blocked</body></html>",
    ],
    [
      "access-denied",
      "<html><head><title>访问受限</title></head><body>当前请求无法访问</body></html>",
    ],
  ])("fails immediately on a %s page", async (reason, html) => {
    const { adapter, requests } = createAdapter({ data: Buffer.from(html) });

    await expect(
      createClient(adapter).fetchPage("/rank/yuepiao/"),
    ).rejects.toMatchObject({
      code: "QIDIAN_ACCESS_BLOCKED",
      name: "QidianClientError",
      reason,
    });
    expect(requests).toHaveLength(1);
  });

  it("does not treat an ordinary login mention as a login wall", async () => {
    const html =
      '<html><head><title>书籍详情</title></head><body><a class="login-link" href="/login">登录</a><p>登录后可以发表评论</p></body></html>';
    const { adapter } = createAdapter({ data: Buffer.from(html) });

    await expect(
      createClient(adapter).fetchPage("/book/123/"),
    ).resolves.toMatchObject({ html });
  });

  it.each([
    '<form class="panel login-form" method="post"></form>',
    '<form method="post" action="/login"></form>',
  ])("detects a structured login wall form: %s", async (form) => {
    const html = `<html><head><title>起点中文网</title></head><body>${form}</body></html>`;
    const { adapter, requests } = createAdapter({ data: Buffer.from(html) });

    await expect(
      createClient(adapter).fetchPage("/rank/yuepiao/"),
    ).rejects.toMatchObject({
      code: "QIDIAN_ACCESS_BLOCKED",
      name: "QidianClientError",
      reason: "login",
    });
    expect(requests).toHaveLength(1);
  });

  it.each([
    '<form class="login-form"><p>请登录后继续访问当前页面内容。</p></form>',
    '<section class="captcha-panel"><p>请完成安全验证后继续访问。</p></section>',
  ])(
    "detects an exclusive access wall inside a main container: %s",
    async (component) => {
      const html = `<html><head><title>起点中文网</title></head><body><main>${component}</main></body></html>`;
      const { adapter } = createAdapter({ data: Buffer.from(html) });

      await expect(
        createClient(adapter).fetchPage("/book/123/"),
      ).rejects.toMatchObject({
        code: "QIDIAN_ACCESS_BLOCKED",
        name: "QidianClientError",
      });
    },
  );

  it.each([
    [
      '<p>请登录后继续阅读本书的完整内容。</p><form class="login-form"></form>',
      "login",
    ],
    [
      '<p>请先完成安全验证才能继续访问当前页面。</p><section class="captcha-panel"></section>',
      "captcha",
    ],
  ])(
    "does not treat access-wall prompt text in main as normal content: %s",
    async (content, reason) => {
      const html = `<html><head><title>起点中文网</title></head><body><main>${content}</main></body></html>`;
      const { adapter } = createAdapter({ data: Buffer.from(html) });

      await expect(
        createClient(adapter).fetchPage("/book/123/"),
      ).rejects.toMatchObject({
        code: "QIDIAN_ACCESS_BLOCKED",
        reason,
      });
    },
  );

  it("ignores non-visible template text when checking for normal content", async () => {
    const html = `<html><head><title>起点中文网</title></head><body><article>
      <script>const longMessage = "normal content placeholder";</script>
      <style>.login-form { display: block; }</style>
      <noscript>这是一段很长但不可见的备用模板文本。</noscript>
      <template><p>这是一段尚未渲染的模板正文内容。</p></template>
      <p hidden>这是一段隐藏的正文占位文本。</p>
    </article><form class="login-form"></form></body></html>`;
    const { adapter } = createAdapter({ data: Buffer.from(html) });

    await expect(
      createClient(adapter).fetchPage("/book/123/"),
    ).rejects.toMatchObject({
      code: "QIDIAN_ACCESS_BLOCKED",
      reason: "login",
    });
  });

  it.each([
    [
      '<article><h1>书名</h1></article>',
      '<form class="login-form"></form>',
    ],
    [
      '<article><img src="/cover.jpg" alt="书籍封面"></article>',
      '<section class="captcha-panel"></section>',
    ],
  ])(
    "accepts short independent article content beside a blocker: %s",
    async (content, blocker) => {
      const html = `<html><head><title>书籍详情</title></head><body>${content}${blocker}</body></html>`;
      const { adapter } = createAdapter({ data: Buffer.from(html) });

      await expect(
        createClient(adapter).fetchPage("/book/123/"),
      ).resolves.toMatchObject({ html });
    },
  );

  it.each([
    '<article><img src=""></article>',
    '<article><img src="   "></article>',
    '<article><picture><source srcset=""></picture></article>',
    '<article><picture><source srcset="   "></picture></article>',
    '<article><a href="/book/"></a></article>',
    '<article><a href="/book/?x=1"></a></article>',
  ])(
    "does not treat an empty media or book reference as normal content: %s",
    async (content) => {
      const html = `<html><head><title>起点中文网</title></head><body>${content}<form class="login-form"></form></body></html>`;
      const { adapter } = createAdapter({ data: Buffer.from(html) });

      await expect(
        createClient(adapter).fetchPage("/book/123/"),
      ).rejects.toMatchObject({
        code: "QIDIAN_ACCESS_BLOCKED",
        reason: "login",
      });
    },
  );

  it.each([
    '<article><img src="/cover.jpg"></article>',
    '<article><img src="" srcset="/cover.webp 1x"></article>',
    '<article><picture><source srcset="/cover.webp 1x"></picture></article>',
    '<article><a href="/book/1031940621"></a></article>',
    '<article><a href="https://www.qidian.com/book/example-slug?ref=list"></a></article>',
  ])("accepts a non-empty media or book reference: %s", async (content) => {
    const html = `<html><head><title>起点中文网</title></head><body>${content}<form class="login-form"></form></body></html>`;
    const { adapter } = createAdapter({ data: Buffer.from(html) });

    await expect(
      createClient(adapter).fetchPage("/book/123/"),
    ).resolves.toMatchObject({ html });
  });

  it.each([
    '<article><h1>这不是独立的正常正文标题</h1><form class="login-form"></form></article>',
    '<article><h1>这不是独立的正常正文标题</h1><section class="captcha-panel"></section></article>',
  ])(
    "does not let a container enclosing the blocker prove normal content: %s",
    async (content) => {
      const html = `<html><head><title>起点中文网</title></head><body>${content}</body></html>`;
      const { adapter } = createAdapter({ data: Buffer.from(html) });

      await expect(
        createClient(adapter).fetchPage("/book/123/"),
      ).rejects.toMatchObject({ code: "QIDIAN_ACCESS_BLOCKED" });
    },
  );

  it.each([
    [
      '<div class="rank-box"><a href="/book/1"><img src="/cover.jpg"></a></div>',
      '<form class="login-form"></form>',
    ],
    [
      '<section class="book-information"><h1>书名</h1></section>',
      '<div class="captcha-panel"></div>',
    ],
    [
      '<div class="book-content-wrap"><a href="/book/1">书</a></div>',
      '<form action="/login"></form>',
    ],
  ])(
    "accepts independent Qidian content beside a preloaded blocker: %s",
    async (content, blocker) => {
      const html = `<html><head><title>起点中文网</title></head><body>${content}${blocker}</body></html>`;
      const { adapter } = createAdapter({ data: Buffer.from(html) });

      await expect(
        createClient(adapter).fetchPage("/book/123/"),
      ).resolves.toMatchObject({ html });
    },
  );

  it.each([
    '<form class="login-form" hidden></form>',
    '<div aria-hidden="true"><form action="/login"></form></div>',
    '<section class="captcha-panel" style="display: none"></section>',
    '<div style="visibility:hidden"><div class="verify-code"></div></div>',
  ])("ignores a hidden access-wall component: %s", async (component) => {
    const html = `<html><head><title>起点中文网</title></head><body>${component}<footer>页面底部</footer></body></html>`;
    const { adapter } = createAdapter({ data: Buffer.from(html) });

    await expect(
      createClient(adapter).fetchPage("/book/123/"),
    ).resolves.toMatchObject({ html });
  });

  it.each([
    '<form class="login-form"></form>',
    '<section class="captcha-panel"></section>',
  ])(
    "ignores a preloaded access-wall component beside normal content: %s",
    async (component) => {
      const html = `<html><head><title>书籍详情</title></head><body><main><article><h1>示例小说</h1><p>这里是可正常阅读的书籍正文内容。</p></article></main>${component}</body></html>`;
      const { adapter } = createAdapter({ data: Buffer.from(html) });

      await expect(
        createClient(adapter).fetchPage("/book/123/"),
      ).resolves.toMatchObject({ html });
    },
  );

  it("does not retry a failed request", async () => {
    let requests = 0;
    const failure = new Error("network unavailable");
    const adapter: AxiosAdapter = async () => {
      requests += 1;
      throw failure;
    };

    await expect(
      createClient(adapter).fetchPage("/rank/yuepiao/"),
    ).rejects.toBe(failure);
    expect(requests).toBe(1);
  });

  it.each(["plain", "decompressed"])(
    "propagates a %s response size limit failure without retrying",
    async (responseKind) => {
      let requests = 0;
      let sizeError: AxiosError | undefined;
      const adapter: AxiosAdapter = async (config) => {
        requests += 1;
        sizeError = new AxiosError(
          `${responseKind} response exceeded maxContentLength`,
          AxiosError.ERR_BAD_RESPONSE,
          config,
        );
        throw sizeError;
      };

      const received = await createClient(adapter)
        .fetchPage("/rank/yuepiao/")
        .catch((error: unknown) => error);

      expect(received).toBe(sizeError);
      expect(received).toMatchObject({ code: AxiosError.ERR_BAD_RESPONSE });
      expect(requests).toBe(1);
    },
  );

  it.each([
    {
      status: 403,
      html: "<html><title>安全验证</title><body>验证码</body></html>",
      reason: "captcha",
    },
    {
      status: 403,
      html: "<html><title>Access Denied</title></html>",
      reason: "access-denied",
    },
    {
      status: 401,
      html: "<html><title>用户登录 | 起点中文网</title></html>",
      reason: "login",
    },
    {
      status: 429,
      html: "<html><title>请求过于频繁</title></html>",
      reason: "access-denied",
    },
  ])(
    "maps HTTP $status access control responses to $reason",
    async ({ status, html, reason }) => {
      const { adapter, requests } = createAdapter({
        data: Buffer.from(html),
        status,
      });

      await expect(
        createClient(adapter).fetchPage("/rank/yuepiao/"),
      ).rejects.toMatchObject({
        code: "QIDIAN_ACCESS_BLOCKED",
        name: "QidianClientError",
        reason,
      });
      expect(requests).toHaveLength(1);
    },
  );

  it("preserves Axios rejection for other HTTP errors", async () => {
    const { adapter, requests } = createAdapter({ status: 500 });

    await expect(
      createClient(adapter).fetchPage("/rank/yuepiao/"),
    ).rejects.toMatchObject({
      code: AxiosError.ERR_BAD_RESPONSE,
      name: "AxiosError",
      status: 500,
    });
    expect(requests).toHaveLength(1);
  });

  it.each([
    {
      status: 401,
      contentType: "text/html; charset=x-unknown",
      reason: "login",
    },
    {
      status: 403,
      contentType: "text/html; charset=x-unknown; broken",
      reason: "access-denied",
    },
    {
      status: 429,
      contentType: "charset=x-unknown",
      reason: "access-denied",
    },
  ])(
    "maps HTTP $status to $reason when charset decoding fails",
    async ({ status, contentType, reason }) => {
      const { adapter, requests } = createAdapter({
        data: Buffer.from("blocked"),
        headers: { "content-type": contentType },
        status,
      });

      const received = await createClient(adapter)
        .fetchPage("/rank/yuepiao/")
        .catch((error: unknown) => error);

      expect(received).toMatchObject({
        cause: new Error("Unsupported charset"),
        code: "QIDIAN_ACCESS_BLOCKED",
        message: "Qidian access was blocked",
        name: "QidianClientError",
        reason,
      });
      expect(requests).toHaveLength(1);
    },
  );

  it("preserves a charset decoding failure for a successful response", async () => {
    const { adapter } = createAdapter({
      data: Buffer.from("content"),
      headers: { "content-type": "text/html; charset=x-unknown" },
      status: 200,
    });

    await expect(
      createClient(adapter).fetchPage("/rank/yuepiao/"),
    ).rejects.toThrow(new Error("Unsupported charset"));
  });
});
