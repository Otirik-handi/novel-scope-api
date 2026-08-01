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
});
