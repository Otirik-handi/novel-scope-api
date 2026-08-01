import { QidianChapterParser } from "./qidian-chapter.parser";

describe("QidianChapterParser", () => {
  it("extracts plain text content from SSR chapterInfo", () => {
    const html = `
      <script id="vite-plugin-ssr_pageContext" type="application/json">
        ${JSON.stringify({
          pageContext: {
            pageProps: {
              pageData: {
                chapterInfo: {
                  chapterName: "Chapter 1",
                  content: "<p>First line</p><p>Second line</p>",
                  vipStatus: 0,
                  cES: 0,
                },
              },
            },
          },
        })}
      </script>
    `;

    const result = new QidianChapterParser().parse({
      html,
      sourceUrl: "https://www.qidian.com/chapter/1/100/",
      bookId: "1",
      chapterId: "100",
    });

    expect(result).toEqual({
      title: "Chapter 1",
      content: "First line\nSecond line",
      isVip: false,
      encrypted: false,
    });
  });
});
