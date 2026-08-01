import { load } from "cheerio";
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
