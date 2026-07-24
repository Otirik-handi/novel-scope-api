import { load } from "cheerio";
import type { CrawledBook, CrawlerJsonObject } from "../../interfaces";
import { parseDisplayedNumber } from "../../../utils/number-parser.util";
import { normalizePlainText } from "../../../utils/text-normalizer.util";
import { FANQIE_BASE_URL } from "../fanqie.constants";

const MAX_SCRIPT_LENGTH = 2 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 50_000;
const MAX_PRISMA_INT = 2_147_483_647;

export interface FanqieBookParseInput {
  html: string;
  externalBookId: string;
  sourceUrl: string;
  fetchedAt: Date;
}

export class FanqieBookParseError extends Error {
  override readonly name = "FanqieBookParseError";
}

export class FanqieBookParser {
  parse(input: FanqieBookParseInput): CrawledBook {
    const book = this.findBook(input.html, input.externalBookId);
    const title = this.requiredString(book.bookName, "title");
    const author = this.requiredString(
      book.authorName ?? book.author,
      "author",
    );

    if (input.sourceUrl.trim() === "") {
      throw new FanqieBookParseError("Fanqie book source URL is required");
    }

    return {
      platform: "fanqie",
      externalBookId: input.externalBookId,
      title,
      author,
      description: this.nullableString(book.abstract),
      coverUrl: this.nullableHttpsUrl(book.coverUrl ?? book.thumbUrl),
      genres: this.readGenres(book),
      bookStatus: this.nullableString(
        book.creationStatus ?? book.bookStatus,
      ),
      wordCount: this.nullableSafeInteger(
        book.wordCount ?? book.wordNumber,
      ),
      metadata: this.readMetadata(book),
      sourceUrl: input.sourceUrl,
      fetchedAt: input.fetchedAt,
    };
  }

  private findBook(html: string, externalBookId: string): Record<string, unknown> {
    const $ = load(html);
    const scripts = $(
      'script[type="application/json"], script#__NEXT_DATA__, script[data-testid="book-detail-data"], script#book-detail-data',
    ).toArray();

    for (const script of scripts) {
      const text = $(script).text().trim();

      if (text === "" || text.length > MAX_SCRIPT_LENGTH) {
        continue;
      }

      let value: unknown;

      try {
        value = JSON.parse(text) as unknown;
      } catch {
        continue;
      }

      const match = this.findMatchingObject(value, externalBookId);

      if (match !== null) {
        return match;
      }
    }

    throw new FanqieBookParseError("Fanqie book data was unavailable");
  }

  private findMatchingObject(
    root: unknown,
    externalBookId: string,
  ): Record<string, unknown> | null {
    const stack: { value: unknown; depth: number }[] = [
      { value: root, depth: 0 },
    ];
    let visited = 0;

    while (stack.length > 0) {
      const frame = stack.pop();

      if (frame === undefined || ++visited > MAX_JSON_NODES) {
        throw new FanqieBookParseError("Fanqie book JSON is too complex");
      }

      const record = this.objectValue(frame.value);

      if (record !== null) {
        const bookId = this.nullableString(record.bookId ?? record.book_id);

        if (bookId === externalBookId && this.nullableString(record.bookName)) {
          return record;
        }
      }

      const children = Array.isArray(frame.value)
        ? frame.value
        : record === null
          ? []
          : Object.values(record);

      if (children.length > 0 && frame.depth >= MAX_JSON_DEPTH) {
        throw new FanqieBookParseError("Fanqie book JSON is too complex");
      }

      for (const child of children) {
        if (typeof child === "object" && child !== null) {
          stack.push({ value: child, depth: frame.depth + 1 });
        }
      }
    }

    return null;
  }

  private readGenres(book: Record<string, unknown>): string[] {
    const values = [book.categoryV2];
    const tags = book.tags ?? book.tagList ?? book.labels;

    if (Array.isArray(tags)) {
      values.push(...tags);
    }

    return [...new Set(values.flatMap((value) => this.genreValues(value)))];
  }

  private genreValues(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.genreValues(item));
    }

    const record = this.objectValue(value);
    const normalized = this.nullableString(
      record?.name ?? record?.tagName ?? record?.categoryName ?? value,
    );
    return normalized === null ? [] : [normalized];
  }

  private readMetadata(book: Record<string, unknown>): CrawlerJsonObject {
    const values = {
      originalBookName: this.nullableString(book.originalBookName),
      firstChapterTitle: this.nullableString(book.firstChapterTitle),
      lastChapterTitle: this.nullableString(book.lastChapterTitle),
    };

    return Object.fromEntries(
      Object.entries(values).filter(
        (entry): entry is [string, string] => entry[1] !== null,
      ),
    );
  }

  private nullableSafeInteger(value: unknown): number | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? parseDisplayedNumber(value)
          : null;

    if (
      parsed === null ||
      !Number.isInteger(parsed) ||
      parsed < 0 ||
      parsed > MAX_PRISMA_INT
    ) {
      throw new FanqieBookParseError("Invalid Fanqie word count");
    }

    return parsed;
  }

  private nullableHttpsUrl(value: unknown): string | null {
    const input = this.nullableString(value);

    if (input === null) return null;

    try {
      const url = new URL(input, FANQIE_BASE_URL);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  private requiredString(value: unknown, label: string): string {
    const result = this.nullableString(value);

    if (result === null) {
      throw new FanqieBookParseError(`Fanqie book ${label} is required`);
    }

    return result;
  }

  private nullableString(value: unknown): string | null {
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      return String(value);
    }

    if (typeof value !== "string") return null;
    const normalized = normalizePlainText(value);
    return normalized === "" ? null : normalized;
  }

  private objectValue(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
