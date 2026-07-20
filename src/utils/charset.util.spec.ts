import iconv from "iconv-lite";
import { decodeBuffer } from "./charset.util";

describe("decodeBuffer", () => {
  it("decodes UTF-8 when no charset is declared", () => {
    expect(decodeBuffer(Buffer.from("默认使用 UTF-8"))).toBe("默认使用 UTF-8");
  });

  it("decodes a charset declared by Content-Type", () => {
    const source = iconv.encode("中文内容", "gbk");

    expect(decodeBuffer(source, 'text/html; Charset="GBK"')).toBe("中文内容");
  });

  it("accepts a quoted bare charset and Uint8Array input", () => {
    const source = new Uint8Array(iconv.encode("小说简介", "gb18030"));

    expect(decodeBuffer(source, " 'gb18030' ")).toBe("小说简介");
  });

  it("rejects an explicitly unsupported charset", () => {
    expect(() =>
      decodeBuffer(Buffer.from("content"), "text/plain; charset=x-unknown"),
    ).toThrow(new Error("Unsupported charset"));
  });

  it.each(["X-Foo: bar; charset=gbk", "garbage; charset=gbk"])(
    "ignores charset parameters outside a MIME Content-Type: %s",
    (value) => {
      const source = Buffer.from("UTF-8 内容");

      expect(decodeBuffer(source, value)).toBe("UTF-8 内容");
    },
  );

  it.each(['charset="gbk"', " CHARSET = GBK "])(
    "decodes an independent charset declaration: %s",
    (declaration) => {
      const source = iconv.encode("独立声明", "gbk");

      expect(decodeBuffer(source, declaration)).toBe("独立声明");
    },
  );

  it("rejects an unsupported independent charset declaration", () => {
    expect(() =>
      decodeBuffer(Buffer.from("content"), "charset=x-unknown"),
    ).toThrow(new Error("Unsupported charset"));
  });

  it.each([
    'text/html; note="a;b"; charset=gbk',
    'text/html; note="a\\\"b"; charset=gbk',
    "text/html; charset=gbk;",
    "text/html; broken; charset=gbk",
    "application/x!#$%&'*+-.^_`|~; charset=gbk",
  ])("decodes charset from a valid MIME declaration: %s", (declaration) => {
    const source = iconv.encode("MIME 参数", "gbk");

    expect(decodeBuffer(source, declaration)).toBe("MIME 参数");
  });

  it("does not let a broken parameter hide an unsupported charset", () => {
    expect(() =>
      decodeBuffer(
        Buffer.from("content"),
        "text/html; charset=x-unknown; broken",
      ),
    ).toThrow(new Error("Unsupported charset"));
  });

  it.each([
    'charset="x-unknown\nInjected: yes"',
    `charset=x-${"a".repeat(500)}`,
  ])("does not expose an unsupported charset in errors", (declaration) => {
    expect(() => decodeBuffer(Buffer.from("content"), declaration)).toThrow(
      new Error("Unsupported charset"),
    );
  });
});
