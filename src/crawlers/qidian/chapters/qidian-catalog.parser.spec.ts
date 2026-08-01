import { QidianCatalogParser } from "./qidian-catalog.parser";

describe("QidianCatalogParser", () => {
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
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "QIDIAN_CATALOG_PARSE_FAILED",
      message: "\u8d77\u70b9\u76ee\u5f55\u4e2d\u5b58\u5728\u65e0\u6548\u7ae0\u8282\u9879",
    });
  });
});
