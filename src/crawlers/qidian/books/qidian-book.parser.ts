import { load } from 'cheerio';
import type {
  CrawlerJsonObject,
  CrawlerJsonValue,
  CrawledBook,
} from '../../interfaces';
import { parseDisplayedNumber } from '../../../utils/number-parser.util';
import {
  normalizeHtmlNodesText,
  normalizeHtmlText,
  normalizePlainText,
} from '../../../utils/text-normalizer.util';
import { QIDIAN_BASE_URL } from '../qidian.constants';
import { Logger } from '@nestjs/common';

const EMBEDDED_JSON_SELECTORS = [
  "script#vite-plugin-ssr_pageContext[type='application/json']",
  "script#book-detail-data[type='application/json']",
  "script#__NEXT_DATA__[type='application/json']",
  "script[type='application/ld+json']",
] as const;

const MAX_JSON_VALUE_DEPTH = 64;
const MAX_JSON_VALUES_TO_VALIDATE = 10_000;
const MAX_PRISMA_INT = 2_147_483_647;

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
  override readonly name = 'QidianBookParseError';
}

export class QidianBookParser {
  logger = new Logger(QidianBookParser.name);
  parse(input: QidianBookParseInput): CrawledBook {
    const sourceBookId = this.parseSourceBookId(input.sourceUrl);

    if (!sourceBookId) {
      throw new QidianBookParseError('Qidian book is missing required fields');
    }

    const $ = load(input.html);
    const embeddedFields = this.parseEmbeddedJson($, sourceBookId);

    if (embeddedFields) {
      const fields = this.enhanceFieldsFromDom($, embeddedFields);
      this.logger.debug(
        `parsed via embedded JSON + DOM enhancement: ${fields.title}`,
      );

      return {
        platform: 'qidian',
        ...fields,
        sourceUrl: input.sourceUrl,
        fetchedAt: input.fetchedAt,
      };
    }

    const domFields = this.parseDom($, sourceBookId);

    if (domFields) {
      this.logger.debug(`parsed via DOM fallback: ${domFields.title}`);

      return {
        platform: 'qidian',
        ...domFields,
        sourceUrl: input.sourceUrl,
        fetchedAt: input.fetchedAt,
      };
    }

    throw new QidianBookParseError('Qidian book is missing required fields');
  }

  private parseEmbeddedJson(
    $: ReturnType<typeof load>,
    sourceBookId: string,
  ): QidianBookFields | null {
    for (const selector of EMBEDDED_JSON_SELECTORS) {
      for (const script of $(selector).toArray()) {
        const element = $(script);
        const json = element.html()?.trim();

        if (!json) {
          continue;
        }

        let value: unknown;

        try {
          value = JSON.parse(json) as unknown;
        } catch {
          continue;
        }

        const candidates = this.getAuthoritativeBookObjects(
          value,
          element.attr('id'),
          element.attr('type'),
        );

        for (const object of candidates) {
          const fields = this.fieldsFromJsonObject(object);

          if (fields && fields.externalBookId === sourceBookId) {
            return fields;
          }
        }
      }
    }

    return null;
  }

  private getAuthoritativeBookObjects(
    value: unknown,
    scriptId: string | undefined,
    scriptType: string | undefined,
  ): Record<string, unknown>[] {
    if (scriptId === 'vite-plugin-ssr_pageContext') {
      return this.objectsAtPaths(value, [
        ['pageContext', 'pageProps', 'pageData', 'bookInfo'],
        ['pageContext', 'pageProps', 'pageData', 'book'],
        ['pageContext', 'pageProps', 'bookInfo'],
      ]);
    }

    if (scriptId === 'book-detail-data') {
      const candidates = this.objectsAtPaths(value, [
        ['book'],
        ['page', 'book'],
        ['pageData', 'bookInfo'],
        ['bookInfo'],
      ]);

      return this.isObject(value) ? [...candidates, value] : candidates;
    }

    if (scriptId === '__NEXT_DATA__') {
      return this.objectsAtPaths(value, [
        ['props', 'pageProps', 'book'],
        ['props', 'pageProps', 'bookInfo'],
        ['props', 'pageProps', 'pageData', 'bookInfo'],
      ]);
    }

    if (scriptType?.toLowerCase() === 'application/ld+json') {
      const items = this.flattenGraph(value);

      return items.filter(
        (item): item is Record<string, unknown> =>
          this.isObject(item) && this.isBookJsonLd(item['@type']),
      );
    }

    return [];
  }

  private flattenGraph(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.flattenGraph(item));
    }

    if (this.isObject(value)) {
      const graph = value['@graph'];

      if (Array.isArray(graph)) {
        return graph.flatMap((item) => this.flattenGraph(item));
      }

      return [value];
    }

    return [];
  }

  private objectsAtPaths(
    value: unknown,
    paths: string[][],
  ): Record<string, unknown>[] {
    return paths
      .map((path) => this.objectAtPath(value, path))
      .filter((object): object is Record<string, unknown> => object !== null);
  }

  private objectAtPath(
    value: unknown,
    path: string[],
  ): Record<string, unknown> | null {
    let current = value;

    for (const key of path) {
      if (!this.isObject(current)) {
        return null;
      }

      current = current[key];
    }

    return this.isObject(current) ? current : null;
  }

  private isBookJsonLd(value: unknown): boolean {
    const types = Array.isArray(value) ? value : [value];

    return types.some(
      (type) => typeof type === 'string' && type.toLowerCase() === 'book',
    );
  }

  private fieldsFromJsonObject(
    object: Record<string, unknown>,
  ): QidianBookFields | null {
    const externalBookId = this.stringValue(
      object.bookId ??
        object.bookID ??
        object.bid ??
        this.bookIdFromIdentifier(object.identifier),
    );
    const title = this.stringValue(
      object.title ?? object.bookName ?? object.name,
    );
    const author = this.authorValue(
      object.author ?? object.authorName ?? object.writer,
    );

    if (!externalBookId || !title || !author) {
      return null;
    }

    const metadata: Record<string, unknown> = this.isObject(object.metadata) ? { ...(object.metadata as Record<string, unknown>) } : {};

    if (typeof object.datePublished === 'string') {
      metadata.datePublished = object.datePublished;
    }

    if (typeof object.dateModified === 'string') {
      metadata.dateModified = object.dateModified;
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
          object.genre ??
          [object.chanName, object.subCateName],
      ),
      bookStatus: this.nullableString(object.bookStatus ?? object.status ?? object.updateStatus) ?? this.statusFromAdditionalProperty(object.additionalProperty),
      wordCount: this.numberValue(
        object.wordCount ??
          object.words ??
          object.totalWords ??
          object.wordsCnt,
      ),
      metadata: this.jsonObjectValue(metadata),
    };
  }

  private statusFromAdditionalProperty(value: unknown): string | null {
    if (!Array.isArray(value)) {
      return null;
    }

    for (const prop of value) {
      if (
        this.isObject(prop) &&
        typeof prop.name === 'string' &&
        /连载状态/.test(prop.name)
      ) {
        return this.stringValue(prop.value);
      }
    }

    return null;
  }

  private bookIdFromIdentifier(value: unknown): string | null {
    if (!this.isObject(value)) {
      return null;
    }

    return this.stringValue(value.value);
  }

  private enhanceFieldsFromDom(
    $: ReturnType<typeof load>,
    fields: QidianBookFields,
  ): QidianBookFields {
    if (!fields.bookStatus) {
      const statusSpan = $('p.book-attribute > span')
        .toArray()
        .find((node) => {
          const classes = $(node).attr('class') ?? '';

          return !classes.includes('dot');
        });

      if (statusSpan) {
        const status = normalizeHtmlNodesText(
          $(statusSpan).contents().toArray(),
        );

        if (status) {
          fields.bookStatus = status;
        }
      }
    }

    if (fields.bookStatus === null) {
      const ogStatus = $(
        'meta[property="og:novel:status"]',
      ).attr('content');

      if (ogStatus) {
        fields.bookStatus = normalizePlainText(ogStatus);
      }
    }

    const countParent = $('p.count').first();

    if (fields.wordCount === null) {
      const wordCountEm = countParent.find('em').first();
      const wordCountText = normalizeHtmlNodesText(
        wordCountEm.contents().toArray(),
      );

      if (wordCountText) {
        fields.wordCount = this.numberValue(wordCountText);
      }
    }

    const metadata: Record<string, unknown> = {
      ...(fields.metadata as Record<string, unknown>),
    };

    const updateTime = $('span.update-time').first();
    const updateTimeText = normalizeHtmlNodesText(
      updateTime.contents().toArray(),
    );

    if (updateTimeText) {
      metadata.updateTime = updateTimeText;
    }

    const statEmElements = countParent.find('em').toArray();

    if (statEmElements.length >= 2) {
      const totalRecText = normalizeHtmlNodesText(
        $(statEmElements[1]).contents().toArray(),
      );

      if (totalRecText) {
        const parsed = this.numberValue(totalRecText);

        if (parsed !== null) {
          metadata.totalRecommendations = parsed;
        }
      }
    }

    if (statEmElements.length >= 3) {
      const weeklyRecText = normalizeHtmlNodesText(
        $(statEmElements[2]).contents().toArray(),
      );

      if (weeklyRecText) {
        const parsed = this.numberValue(weeklyRecText);

        if (parsed !== null) {
          metadata.weeklyRecommendations = parsed;
        }
      }
    }

    fields.metadata = this.jsonObjectValue(metadata);

    return fields;
  }

  private parseDom(
    $: ReturnType<typeof load>,
    sourceBookId: string,
  ): QidianBookFields | null {
    const title = normalizeHtmlNodesText(
      $('#bookName').contents().toArray(),
    );

    if (!title) {
      return this.parseDomLegacy($, sourceBookId);
    }

    const author = normalizeHtmlNodesText(
      $('span.author').first().contents().toArray(),
    );

    if (!title || !author) {
      return null;
    }

    const description = normalizeHtmlNodesText(
      $('#book-intro-detail').contents().toArray(),
    );
    const coverImg = $('.book-img img').first();
    const coverUrl = this.urlValue(
      coverImg.attr('data-src') ?? coverImg.attr('src'),
    );
    const genres = $('p.book-attribute > a')
      .toArray()
      .map((node) =>
        normalizeHtmlNodesText($(node).contents().toArray()),
      )
      .filter((genre): genre is string => Boolean(genre));
    const statusSpan = $('p.book-attribute > span')
      .toArray()
      .find((node) => {
        const classes = $(node).attr('class') ?? '';

        return !classes.includes('dot');
      });
    const bookStatus = statusSpan
      ? normalizeHtmlNodesText($(statusSpan).contents().toArray()) ?? null
      : null;
    const countParent = $('p.count').first();
    const wordCountEm = countParent.find('em').first();
    const wordCountText = normalizeHtmlNodesText(
      wordCountEm.contents().toArray(),
    );
    const wordCount = wordCountText
      ? this.numberValue(wordCountText)
      : null;
    const metadata: Record<string, unknown> = {};
    const updateTime = $('span.update-time').first();
    const updateTimeText = normalizeHtmlNodesText(
      updateTime.contents().toArray(),
    );

    if (updateTimeText) {
      metadata.updateTime = updateTimeText;
    }

    const statEmElements = countParent.find('em').toArray();

    if (statEmElements.length >= 2) {
      const totalRecText = normalizeHtmlNodesText(
        $(statEmElements[1]).contents().toArray(),
      );

      if (totalRecText) {
        const parsed = this.numberValue(totalRecText);

        if (parsed !== null) {
          metadata.totalRecommendations = parsed;
        }
      }
    }

    if (statEmElements.length >= 3) {
      const weeklyRecText = normalizeHtmlNodesText(
        $(statEmElements[2]).contents().toArray(),
      );

      if (weeklyRecText) {
        const parsed = this.numberValue(weeklyRecText);

        if (parsed !== null) {
          metadata.weeklyRecommendations = parsed;
        }
      }
    }

    return {
      externalBookId: sourceBookId,
      title,
      author,
      description: description || null,
      coverUrl,
      genres: [...new Set(genres)],
      bookStatus,
      wordCount,
      metadata: this.jsonObjectValue(metadata),
    };
  }

  private parseDomLegacy(
    $: ReturnType<typeof load>,
    sourceBookId: string,
  ): QidianBookFields | null {
    const root = $('.book-information, [data-book-id]').first();
    const domBookId =
      this.stringValue(root.attr('data-book-id')) ?? sourceBookId;
    const titleElement = root.find('h1 em, h1 .book-title, h1').first();
    const title =
      normalizeHtmlNodesText(titleElement.contents().toArray()) ?? '';
    const authorElement = root
      .find('.writer, .author .name, [data-author]')
      .first();
    const authorAttribute = authorElement.attr('data-author');
    const author = authorAttribute
      ? normalizePlainText(authorAttribute)
      : (normalizeHtmlNodesText(authorElement.contents().toArray()) ?? '');

    if (!title || !author || domBookId !== sourceBookId) {
      return null;
    }

    const descriptionElement = $('.book-intro, .book-description').first();
    const description = normalizeHtmlNodesText(
      descriptionElement.contents().toArray(),
    );
    const coverElement = root
      .find('.book-img img, img.book-cover, img')
      .first();
    const genres = root
      .find("[data-role='genre'], .genre, .category")
      .toArray()
      .map((node) => normalizeHtmlNodesText($(node).contents().toArray()))
      .filter((genre): genre is string => Boolean(genre));
    const statusElement = root.find('.book-status, [data-book-status]').first();
    const status =
      normalizeHtmlNodesText(statusElement.contents().toArray()) ?? '';
    const wordCountElement = root
      .find('[data-word-count], .word-count')
      .first();
    const wordCountAttribute = wordCountElement.attr('data-word-count')?.trim();

    return {
      externalBookId: domBookId,
      title,
      author,
      description: description || null,
      coverUrl: this.urlValue(
        coverElement.attr('data-src') ?? coverElement.attr('src'),
      ),
      genres: [...new Set(genres)],
      bookStatus: status || null,
      wordCount: this.numberValue(
        wordCountAttribute ||
          normalizeHtmlNodesText(wordCountElement.contents().toArray()),
      ),
      metadata: {},
    };
  }

  private parseSourceBookId(sourceUrl: string): string | null {
    try {
      const url = new URL(sourceUrl);
      const match = url.pathname.match(/^\/book\/(\d+)\/?$/);

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
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? parseDisplayedNumber(value)
          : null;

    return parsed !== null &&
      Number.isInteger(parsed) &&
      parsed >= 0 &&
      parsed <= MAX_PRISMA_INT
      ? parsed
      : null;
  }

  private urlValue(value: unknown): string | null {
    const input = this.nullableString(value);

    if (!input) {
      return null;
    }

    try {
      const url = new URL(input, QIDIAN_BASE_URL);

      return url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  private stringValue(value: unknown): string | null {
    if (
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      return String(value);
    }

    return this.nullableString(value);
  }

  private nullableString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = normalizePlainText(value);

    return normalized || null;
  }

  private jsonObjectValue(value: unknown): CrawlerJsonObject {
    if (!this.isObject(value)) {
      return {};
    }

    const entries = Object.entries(value).filter(
      (entry): entry is [string, CrawlerJsonValue] =>
        this.isJsonValue(entry[1]),
    );

    return Object.fromEntries(entries);
  }

  private isJsonValue(value: unknown): value is CrawlerJsonValue {
    const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
    let visited = 0;

    while (stack.length > 0) {
      const frame = stack.pop();

      if (!frame || visited >= MAX_JSON_VALUES_TO_VALIDATE) {
        return false;
      }

      visited += 1;

      if (
        frame.value === null ||
        typeof frame.value === 'string' ||
        typeof frame.value === 'boolean'
      ) {
        continue;
      }

      if (typeof frame.value === 'number') {
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
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
