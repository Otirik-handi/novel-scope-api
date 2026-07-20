import { load } from "cheerio";
import type {
  CrawlerJsonObject,
  CrawlerJsonValue,
  CrawledBook,
} from "../../interfaces";
import { parseDisplayedNumber } from "../../../utils/number-parser.util";
import {
  normalizeHtmlText,
  normalizePlainText,
} from "../../../utils/text-normalizer.util";
import { QIDIAN_BASE_URL } from "../qidian.constants";

const EMBEDDED_JSON_SELECTOR = [
  "script#book-detail-data[type='application/json']",
  "script#vite-plugin-ssr_pageContext[type='application/json']",
  "script#__NEXT_DATA__[type='application/json']",
  "script[type='application/ld+json']",
].join(", ");

const MAX_JSON_OBJECTS_TO_SCAN = 10_000;
const MAX_JSON_VALUE_DEPTH = 64;
const MAX_JSON_VALUES_TO_VALIDATE = 10_000;

interface QidianBookFields {
  externalBookId: string;
  title: string;
  author: string;
  description: string | null;
  coverUrl: string | null;
  genres: string[];
  bookStatus: string | null;
  wordCount: number | null;
  metadata: CrawlerJsonObject;
}

export interface QidianBookParseInput {
  html: string;
  sourceUrl: string;
  fetchedAt: Date;
}

export class QidianBookParseError extends Error {
  override readonly name = "QidianBookParseError";
}

export class QidianBookParser {
  parse(input: QidianBookParseInput): CrawledBook {
    const sourceBookId = this.parseSourceBookId(input.sourceUrl);

    if (!sourceBookId) {
      throw new QidianBookParseError("Qidian book is missing required fields");
    }

    const $ = load(input.html);
    const fields =
      this.parseEmbeddedJson($, sourceBookId) ??
      this.parseDom($, sourceBookId);

    if (!fields) {
      throw new QidianBookParseError("Qidian book is missing required fields");
    }

    return {
      platform: "qidian",
      ...fields,
      sourceUrl: input.sourceUrl,
      fetchedAt: input.fetchedAt,
    };
  }

  private parseEmbeddedJson(
    $: ReturnType<typeof load>,
    sourceBookId: string,
  ): QidianBookFields | null {
    for (const script of $(EMBEDDED_JSON_SELECTOR).toArray()) {
      const json = $(script).html()?.trim();

      if (!json) {
        continue;
      }

      let value: unknown;

      try {
        value = JSON.parse(json) as unknown;
      } catch {
        continue;
      }

      for (const object of this.findJsonObjects(value)) {
        const fields = this.fieldsFromJsonObject(object);

        if (fields && fields.externalBookId === sourceBookId) {
          return fields;
        }
      }
    }

    return null;
  }

  private *findJsonObjects(
    value: unknown,
  ): Generator<Record<string, unknown>> {
    const queue: unknown[] = [value];

    for (
      let index = 0;
      index < queue.length && index < MAX_JSON_OBJECTS_TO_SCAN;
      index += 1
    ) {
      const current = queue[index];

      if (Array.isArray(current)) {
        this.enqueueJsonValues(queue, current);
        continue;
      }

      if (!this.isObject(current)) {
        continue;
      }

      yield current;
      this.enqueueJsonValues(queue, Object.values(current));
    }
  }

  private enqueueJsonValues(queue: unknown[], values: unknown[]): void {
    for (const value of values) {
      if (queue.length >= MAX_JSON_OBJECTS_TO_SCAN) {
        return;
      }

      queue.push(value);
    }
  }

  private fieldsFromJsonObject(
    object: Record<string, unknown>,
  ): QidianBookFields | null {
    const externalBookId = this.stringValue(
      object.bookId ?? object.bookID ?? object.bid,
    );
    const title = this.stringValue(object.title ?? object.bookName ?? object.name);
    const author = this.authorValue(
      object.author ?? object.authorName ?? object.writer,
    );

    if (!externalBookId || !title || !author) {
      return null;
    }

    return {
      externalBookId,
      title,
      author,
      description: this.descriptionValue(
        object.description ?? object.intro ?? object.bookIntro ?? object.desc,
      ),
      coverUrl: this.urlValue(
        object.coverUrl ?? object.cover ?? object.image ?? object.bookImg,
      ),
      genres: this.genresValue(
        object.genres ??
          object.categories ??
          object.category ??
          [object.chanName, object.subCateName],
      ),
      bookStatus: this.nullableString(
        object.bookStatus ?? object.status ?? object.updateStatus,
      ),
      wordCount: this.numberValue(
        object.wordCount ??
          object.words ??
          object.totalWords ??
          object.wordsCnt,
      ),
      metadata: this.jsonObjectValue(object.metadata),
    };
  }

  private parseDom(
    $: ReturnType<typeof load>,
    sourceBookId: string,
  ): QidianBookFields | null {
    const root = $(".book-information, [data-book-id]").first();
    const domBookId = this.stringValue(root.attr("data-book-id")) ?? sourceBookId;
    const title = normalizePlainText(
      root.find("h1 em, h1 .book-title, h1").first().text(),
    );
    const authorElement = root
      .find(".writer, .author .name, [data-author]")
      .first();
    const author = normalizePlainText(
      authorElement.attr("data-author") ?? authorElement.text(),
    );

    if (!title || !author || domBookId !== sourceBookId) {
      return null;
    }

    const descriptionElement = $(".book-intro, .book-description").first();
    const descriptionHtml = descriptionElement.html();
    const coverElement = root.find(".book-img img, img.book-cover, img").first();
    const genres = root
      .find("[data-role='genre'], .genre, .category")
      .toArray()
      .map((node) => normalizePlainText($(node).text()))
      .filter(Boolean);
    const status = normalizePlainText(
      root.find(".book-status, [data-book-status]").first().text(),
    );
    const wordCountElement = root
      .find("[data-word-count], .word-count")
      .first();

    return {
      externalBookId: domBookId,
      title,
      author,
      description: descriptionHtml
        ? this.descriptionValue(descriptionHtml)
        : null,
      coverUrl: this.urlValue(
        coverElement.attr("data-src") ?? coverElement.attr("src"),
      ),
      genres: [...new Set(genres)],
      bookStatus: status || null,
      wordCount: this.numberValue(
        wordCountElement.attr("data-word-count")?.trim() ||
          wordCountElement.text(),
      ),
      metadata: {},
    };
  }

  private parseSourceBookId(sourceUrl: string): string | null {
    try {
      const url = new URL(sourceUrl);
      const match = url.pathname.match(/^\/book\/(\d+)(?:\/|$)/);

      return url.origin === QIDIAN_BASE_URL && match ? match[1] : null;
    } catch {
      return null;
    }
  }

  private descriptionValue(value: unknown): string | null {
    const input = this.nullableString(value);

    if (!input) {
      return null;
    }

    const normalized = /<\/?[a-z][\s\S]*>/i.test(input)
      ? normalizeHtmlText(input)
      : normalizePlainText(input);

    return normalized || null;
  }

  private authorValue(value: unknown): string | null {
    if (this.isObject(value)) {
      return this.stringValue(value.name ?? value.authorName);
    }

    return this.stringValue(value);
  }

  private genresValue(value: unknown): string[] {
    const values = Array.isArray(value) ? value : [value];

    return [
      ...new Set(
        values
          .map((item) => this.stringValue(item))
          .filter((item): item is string => item !== null),
      ),
    ];
  }

  private numberValue(value: unknown): number | null {
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= Number.MAX_SAFE_INTEGER
    ) {
      return value;
    }

    return typeof value === "string" ? parseDisplayedNumber(value) : null;
  }

  private urlValue(value: unknown): string | null {
    const input = this.nullableString(value);

    if (!input) {
      return null;
    }

    try {
      const url = new URL(input, QIDIAN_BASE_URL);

      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  private stringValue(value: unknown): string | null {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
      return String(value);
    }

    return this.nullableString(value);
  }

  private nullableString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = normalizePlainText(value);

    return normalized || null;
  }

  private jsonObjectValue(value: unknown): CrawlerJsonObject {
    if (!this.isObject(value)) {
      return {};
    }

    const entries = Object.entries(value).filter((entry): entry is [string, CrawlerJsonValue] =>
      this.isJsonValue(entry[1]),
    );

    return Object.fromEntries(entries);
  }

  private isJsonValue(value: unknown): value is CrawlerJsonValue {
    const stack: { value: unknown; depth: number }[] = [
      { value, depth: 0 },
    ];
    let visited = 0;

    while (stack.length > 0) {
      const frame = stack.pop();

      if (!frame || visited >= MAX_JSON_VALUES_TO_VALIDATE) {
        return false;
      }

      visited += 1;

      if (
        frame.value === null ||
        typeof frame.value === "string" ||
        typeof frame.value === "boolean"
      ) {
        continue;
      }

      if (typeof frame.value === "number") {
        if (!Number.isFinite(frame.value)) {
          return false;
        }

        continue;
      }

      const children = Array.isArray(frame.value)
        ? frame.value
        : this.isObject(frame.value)
          ? Object.values(frame.value)
          : null;

      if (
        !children ||
        (children.length > 0 && frame.depth >= MAX_JSON_VALUE_DEPTH) ||
        children.length > MAX_JSON_VALUES_TO_VALIDATE - visited - stack.length
      ) {
        return false;
      }

      for (const child of children) {
        stack.push({ value: child, depth: frame.depth + 1 });
      }
    }

    return true;
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
