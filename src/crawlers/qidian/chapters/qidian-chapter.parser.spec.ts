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

  it("rejects empty paragraph content", () => {
    const html = `
      <script id="vite-plugin-ssr_pageContext" type="application/json">
        ${JSON.stringify({
          pageContext: {
            pageProps: {
              pageData: {
                chapterInfo: {
                  chapterName: "Empty",
                  content: "<p></p><p></p>",
                  vipStatus: 0,
                  cES: 0,
                },
              },
            },
          },
        })}
      </script>
    `;

    let error: unknown;
    try {
      new QidianChapterParser().parse({
        html,
        sourceUrl: "https://www.qidian.com/chapter/1/100/",
        bookId: "1",
        chapterId: "100",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: "QIDIAN_CHAPTER_EMPTY",
      message: "\u8d77\u70b9\u7ae0\u8282\u6b63\u6587\u7f3a\u5931\u6216\u4e3a\u7a7a",
    });
  });

  it("detects vip and encrypted flags", () => {
    const html = `
      <script id="vite-plugin-ssr_pageContext" type="application/json">
        ${JSON.stringify({
          pageContext: {
            pageProps: {
              pageData: {
                chapterInfo: {
                  chapterName: "Flags",
                  content: "<p>Text</p>",
                  vipStatus: 1,
                  cES: 2,
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

    expect(result.isVip).toBe(true);
    expect(result.encrypted).toBe(true);
  });
});
