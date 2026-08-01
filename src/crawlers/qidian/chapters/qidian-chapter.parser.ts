import { load } from "cheerio";
import { QIDIAN_BASE_URL } from "../qidian.constants";
import { QidianChapterCrawlerError } from "./qidian-chapter.error";

export interface QidianChapterParseInput {
  html: string;
  sourceUrl: string;
  bookId: string;
  chapterId: string;
}

export interface QidianChapterContent {
  title: string;
  content: string;
  isVip: boolean;
  encrypted: boolean;
}

export class QidianChapterParser {
  parse(input: QidianChapterParseInput): QidianChapterContent {
    if (
      !this.matchesRequestedChapter(
        input.sourceUrl,
        input.bookId,
        input.chapterId,
      )
    ) {
      throw this.identityMismatchError();
    }

    const $ = load(input.html);
    const script = $("#vite-plugin-ssr_pageContext").first().html();
    let data: unknown;

    try {
      data = JSON.parse(script ?? "");
    } catch {
      throw this.emptyError();
    }

    const chapterInfo = findChapterInfo(data);
    if (
      chapterInfo === null ||
      typeof chapterInfo.content !== "string" ||
      chapterInfo.content.trim() === ""
    ) {
      throw this.emptyError();
    }

    if (
      chapterInfo.chapterId !== undefined &&
      String(chapterInfo.chapterId) !== input.chapterId
    ) {
      throw this.identityMismatchError();
    }

    const content = contentToPlainText(chapterInfo.content);
    if (content === "") {
      throw this.emptyError();
    }

    const title =
      typeof chapterInfo.chapterName === "string" &&
      chapterInfo.chapterName.trim() !== ""
        ? chapterInfo.chapterName.trim()
        : `\u7b2c${input.chapterId}\u7ae0`;

    return {
      title,
      content,
      isVip: chapterInfo.vipStatus === 1,
      encrypted: chapterInfo.cES === 2,
    };
  }

  private emptyError(): QidianChapterCrawlerError {
    return new QidianChapterCrawlerError(
      "QIDIAN_CHAPTER_EMPTY",
      "\u8d77\u70b9\u7ae0\u8282\u6b63\u6587\u7f3a\u5931\u6216\u4e3a\u7a7a",
    );
  }

  private matchesRequestedChapter(
    sourceUrl: string,
    bookId: string,
    chapterId: string,
  ): boolean {
    try {
      const url = new URL(sourceUrl);
      const match = url.pathname.match(/^\/chapter\/(\d+)\/(\d+)\/?$/);
      return (
        url.origin === QIDIAN_BASE_URL &&
        url.username === "" &&
        url.password === "" &&
        match?.[1] === bookId &&
        match?.[2] === chapterId
      );
    } catch {
      return false;
    }
  }

  private identityMismatchError(): QidianChapterCrawlerError {
    return new QidianChapterCrawlerError(
      "QIDIAN_CHAPTER_FETCH_FAILED",
      "\u8d77\u70b9\u7ae0\u8282\u9875\u4e0e\u8bf7\u6c42\u7ae0\u8282\u4e0d\u4e00\u81f4",
    );
  }
}

function findChapterInfo(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  const root = value as Record<string, unknown>;
  const pageContext = root.pageContext as Record<string, unknown> | undefined;
  const pageProps = pageContext?.pageProps as Record<string, unknown> | undefined;
  const pageData = pageProps?.pageData as Record<string, unknown> | undefined;
  const chapterInfo = pageData?.chapterInfo;
  return typeof chapterInfo === "object" && chapterInfo !== null
    ? (chapterInfo as Record<string, unknown>)
    : null;
}

function contentToPlainText(content: string): string {
  const $ = load(content);
  const paragraphs = $("p")
    .toArray()
    .map((node) => $(node).text().replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 0);
  return paragraphs.join("\n");
}
