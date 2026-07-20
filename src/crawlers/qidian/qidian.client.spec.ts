import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
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

    return {
      data: Buffer.from("<html>ok</html>"),
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/html; charset=utf-8" },
      config,
      ...response,
    };
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
      "<html><head><title>书籍详情</title></head><body><p>登录后可以发表评论</p></body></html>";
    const { adapter } = createAdapter({ data: Buffer.from(html) });

    await expect(
      createClient(adapter).fetchPage("/book/123/"),
    ).resolves.toMatchObject({ html });
  });

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
});
