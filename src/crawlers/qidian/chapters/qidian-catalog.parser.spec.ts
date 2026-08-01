import { QidianCatalogParser } from "./qidian-catalog.parser";

describe("QidianCatalogParser", () => {
  it("fails when the catalog HTML is empty", () => {
    let error: unknown;
    try {
      new QidianCatalogParser().parse({
        html: "<html><body>No catalog</body></html>",
        sourceUrl: "https://www.qidian.com/book/1/",
        bookId: "1",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "QIDIAN_CATALOG_PARSE_FAILED" });
  });

  it("assigns global indexes and detects VIP chapters", () => {
    const html = `
      <div class="catalog-volume">
        <ul class="volume-chapters">
          <li class="chapter-item"><a class="chapter-name" href="//www.qidian.com/chapter/1/100/">Chapter 1</a></li>
          <li class="chapter-item"><a class="chapter-name" href="//www.qidian.com/chapter/1/200/">Chapter 2</a><em class="chapter-locked"></em></li>
        </ul>
      </div>
    `;

    const chapters = new QidianCatalogParser().parse({
      html,
      sourceUrl: "https://www.qidian.com/book/1/",
      bookId: "1",
    });

    expect(chapters).toEqual([
      expect.objectContaining({ index: 1, chapterId: "100", isVip: false }),
      expect.objectContaining({ index: 2, chapterId: "200", isVip: true }),
    ]);
  });

  it("fails when a chapter item has no valid chapter id", () => {
    const html = `
      <div class="catalog-volume">
        <ul class="volume-chapters">
          <li class="chapter-item"><a class="chapter-name" href="javascript:void(0)">Broken</a></li>
        </ul>
      </div>
    `;

    let error: unknown;
    try {
      new QidianCatalogParser().parse({
        html,
        sourceUrl: "https://www.qidian.com/book/1/",
        bookId: "1",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "QIDIAN_CATALOG_PARSE_FAILED",
      message: "\u8d77\u70b9\u76ee\u5f55\u4e2d\u5b58\u5728\u65e0\u6548\u7ae0\u8282\u9879",
    });
  });

  it("does not skip a broken chapter item after valid items", () => {
    const html = `
      <div class="catalog-volume">
        <ul class="volume-chapters">
          <li class="chapter-item"><a class="chapter-name" href="//www.qidian.com/chapter/1/100/">Chapter 1</a></li>
          <li class="chapter-item"><a class="chapter-name" href="javascript:void(0)">Broken</a></li>
        </ul>
      </div>
    `;

    let error: unknown;
    try {
      new QidianCatalogParser().parse({
        html,
        sourceUrl: "https://www.qidian.com/book/1/",
        bookId: "1",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "QIDIAN_CATALOG_PARSE_FAILED",
      message: "\u8d77\u70b9\u76ee\u5f55\u4e2d\u5b58\u5728\u65e0\u6548\u7ae0\u8282\u9879",
    });
  });

  it("rejects external chapter URLs", () => {
    const html = `
      <div class="catalog-volume">
        <ul class="volume-chapters">
          <li class="chapter-item"><a class="chapter-name" href="https://evil.example/chapter/1/100/">Bad</a></li>
        </ul>
      </div>
    `;

    let error: unknown;
    try {
      new QidianCatalogParser().parse({
        html,
        sourceUrl: "https://www.qidian.com/book/1/",
        bookId: "1",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "QIDIAN_CATALOG_PARSE_FAILED" });
  });

  it("rejects chapter URLs from another book", () => {
    const html = `
      <div class="catalog-volume">
        <ul class="volume-chapters">
          <li class="chapter-item"><a class="chapter-name" href="//www.qidian.com/chapter/2/100/">Wrong book</a></li>
        </ul>
      </div>
    `;

    let error: unknown;
    try {
      new QidianCatalogParser().parse({
        html,
        sourceUrl: "https://www.qidian.com/book/1/",
        bookId: "1",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "QIDIAN_CATALOG_PARSE_FAILED" });
  });

  it("rejects chapter items with an empty title", () => {
    const html = `
      <div class="catalog-volume">
        <ul class="volume-chapters">
          <li class="chapter-item"><a class="chapter-name" href="//www.qidian.com/chapter/1/100/"></a></li>
        </ul>
      </div>
    `;

    let error: unknown;
    try {
      new QidianCatalogParser().parse({
        html,
        sourceUrl: "https://www.qidian.com/book/1/",
        bookId: "1",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "QIDIAN_CATALOG_PARSE_FAILED" });
  });

  it("rejects a source URL for a different book", () => {
    const html = `
      <div class="catalog-volume">
        <ul class="volume-chapters">
          <li class="chapter-item"><a class="chapter-name" href="//www.qidian.com/chapter/1/100/">Chapter 1</a></li>
        </ul>
      </div>
    `;

    let error: unknown;
    try {
      new QidianCatalogParser().parse({
        html,
        sourceUrl: "https://www.qidian.com/book/2/",
        bookId: "1",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "QIDIAN_CATALOG_PARSE_FAILED" });
  });
});
