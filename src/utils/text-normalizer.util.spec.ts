import { normalizeHtmlText, normalizePlainText } from "./text-normalizer.util";

describe("normalizePlainText", () => {
  it("collapses horizontal whitespace and trims each line", () => {
    expect(normalizePlainText("  第一行\t 有内容  \r\n 第二行  ")).toBe(
      "第一行 有内容\n第二行",
    );
  });

  it("compresses excessive blank lines while preserving paragraphs", () => {
    expect(normalizePlainText("第一段\n\n\n \n第二段")).toBe(
      "第一段\n\n第二段",
    );
  });
});

describe("normalizeHtmlText", () => {
  it("converts breaks and block elements into newlines", () => {
    const html = "<p>第一行<br>第二行</p><div>第三行&nbsp;&nbsp;内容</div>";

    expect(normalizeHtmlText(html)).toBe("第一行\n第二行\n第三行 内容");
  });

  it("removes tags while retaining and normalizing inline text", () => {
    expect(
      normalizeHtmlText("<p>这是一段 <strong>精彩</strong> 的简介。</p>"),
    ).toBe("这是一段 精彩 的简介。");
  });

  it("decodes entities and removes non-content elements", () => {
    const html =
      "<style>.hidden { display: none; }</style><p>Tom &amp; Jerry</p><script>alert('x')</script>";

    expect(normalizeHtmlText(html)).toBe("Tom & Jerry");
  });

  it("preserves one blank line from two HTML breaks", () => {
    expect(normalizeHtmlText("A<br><br>B")).toBe("A\n\nB");
  });

  it("compresses excessive HTML breaks to one blank line", () => {
    expect(normalizeHtmlText("A<br><br><br><br>B")).toBe("A\n\nB");
  });

  it("does not add a blank line at an adjacent block boundary", () => {
    const html = "<p>A<br><br>B</p><div>C</div>";

    expect(normalizeHtmlText(html)).toBe("A\n\nB\nC");
  });

  it("collapses source newlines inside a block to spaces", () => {
    expect(normalizeHtmlText("<p>A\nB</p>")).toBe("A B");
  });

  it("does not turn indentation around inline elements into line breaks", () => {
    const html = "<p>Alpha\n  <strong>Beta</strong>\n  Gamma</p>";

    expect(normalizeHtmlText(html)).toBe("Alpha Beta Gamma");
  });

  it("preserves private-use characters in visible text", () => {
    expect(normalizeHtmlText("<p>&#xE000; &#xE001;</p>")).toBe("\uE000 \uE001");
  });

  it("separates definition terms, descriptions, and detail summaries", () => {
    const html =
      "<dl><dt>Term</dt><dd>Description</dd></dl><details><summary>More</summary>Detail</details>";

    expect(normalizeHtmlText(html)).toBe("Term\nDescription\nMore\nDetail");
  });

  it("separates table captions, headers, and cells", () => {
    const html =
      "<table><caption>Stats</caption><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table>";

    expect(normalizeHtmlText(html)).toBe("Stats\nName\nValue\nA\n1");
  });

  it("separates nested list items without extra blank lines", () => {
    const html =
      "<ul><li>Outer<ul><li>Inner one</li><li>Inner two</li></ul></li><li>Next</li></ul>";

    expect(normalizeHtmlText(html)).toBe("Outer\nInner one\nInner two\nNext");
  });

  it("normalizes deeply nested blocks without overflowing the call stack", () => {
    const depth = 6_000;
    const html = `${"<div>".repeat(depth)}Visible${"</div>".repeat(depth)}`;

    expect(normalizeHtmlText(html)).toBe("Visible");
  });
});
