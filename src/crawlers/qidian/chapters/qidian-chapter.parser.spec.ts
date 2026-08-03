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

  it("rejects HTML without the SSR page context script", () => {
    let error: unknown;
    try {
      new QidianChapterParser().parse({
        html: "<html><body>No SSR script</body></html>",
        sourceUrl: "https://www.qidian.com/chapter/1/100/",
        bookId: "1",
        chapterId: "100",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "QIDIAN_CHAPTER_EMPTY" });
  });

  it("rejects encrypted chapters", () => {
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
      code: "QIDIAN_CHAPTER_ENCRYPTED",
      message: "\u8d77\u70b9\u7ae0\u8282\u4e3a\u5b57\u4f53\u52a0\u5bc6\u7ae0\u8282\uff0c\u6682\u4e0d\u652f\u6301\u4e0b\u8f7d",
    });
  });

  it("detects the vip flag without an encrypted flag", () => {
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
      title: "Flags",
      content: "Text",
      isVip: true,
    });
    expect(result).not.toHaveProperty("encrypted");
  });

  it("rejects a source URL that does not match the requested chapter", () => {
    let error: unknown;
    try {
      new QidianChapterParser().parse({
        html: "<script id=\"vite-plugin-ssr_pageContext\">{}</script>",
        sourceUrl: "https://www.qidian.com/chapter/1/999/",
        bookId: "1",
        chapterId: "100",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "QIDIAN_CHAPTER_FETCH_FAILED" });
  });

  it("rejects SSR chapter ids that do not match the requested chapter", () => {
    const html = `
      <script id="vite-plugin-ssr_pageContext" type="application/json">
        ${JSON.stringify({
          pageContext: {
            pageProps: {
              pageData: {
                chapterInfo: {
                  chapterId: "999",
                  chapterName: "Chapter 1",
                  content: "<p>Text</p>",
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

    expect(error).toMatchObject({ code: "QIDIAN_CHAPTER_FETCH_FAILED" });
  });

  it("rejects SSR book ids that do not match the requested book", () => {
    const html = `
      <script id="vite-plugin-ssr_pageContext" type="application/json">
        ${JSON.stringify({
          pageContext: {
            pageProps: {
              pageData: {
                chapterInfo: {
                  bookId: "2",
                  chapterName: "Chapter 1",
                  content: "<p>Text</p>",
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

    expect(error).toMatchObject({ code: "QIDIAN_CHAPTER_FETCH_FAILED" });
  });

  it("prefers a mismatched SSR book id over empty content", () => {
    const html = `
      <script id="vite-plugin-ssr_pageContext" type="application/json">
        ${JSON.stringify({
          pageContext: {
            pageProps: {
              pageData: {
                chapterInfo: {
                  bookId: "2",
                  chapterId: "100",
                  chapterName: "Chapter 1",
                  content: "",
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

    expect(error).toMatchObject({ code: "QIDIAN_CHAPTER_FETCH_FAILED" });
  });

  it("prefers a mismatched SSR chapter id over the encrypted flag", () => {
    const html = `
      <script id="vite-plugin-ssr_pageContext" type="application/json">
        ${JSON.stringify({
          pageContext: {
            pageProps: {
              pageData: {
                chapterInfo: {
                  bookId: "1",
                  chapterId: "999",
                  chapterName: "Chapter 1",
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

    expect(error).toMatchObject({ code: "QIDIAN_CHAPTER_FETCH_FAILED" });
  });
});
