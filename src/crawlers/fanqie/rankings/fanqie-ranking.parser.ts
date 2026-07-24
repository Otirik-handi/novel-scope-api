import type {
  CrawledRanking,
  CrawledRankingItem,
  CrawlerJsonObject,
  RankingDefinition,
} from "../../interfaces";
import { parseDisplayedNumber } from "../../../utils/number-parser.util";
import { normalizePlainText } from "../../../utils/text-normalizer.util";
import {
  FANQIE_BASE_URL,
  FANQIE_BOOK_PATH_PREFIX,
} from "../fanqie.constants";

export interface FanqieRankingParseInput {
  initialState: unknown;
  definition: RankingDefinition;
  sourceUrl: string;
  fetchedAt: Date;
}

export class FanqieRankingParseError extends Error {
  override readonly name = "FanqieRankingParseError";
}

export class FanqieRankingParser {
  parse(input: FanqieRankingParseInput): CrawledRanking {
    if (input.definition.platform !== "fanqie") {
      throw new FanqieRankingParseError("Invalid Fanqie ranking definition");
    }

    const candidates = this.findCandidateList(input.initialState);

    if (candidates.length < 10) {
      throw new FanqieRankingParseError(
        "Fanqie ranking must contain at least 10 items",
      );
    }

    const items = candidates
      .slice(0, 10)
      .map((candidate, index) => this.parseItem(candidate, index));

    if (new Set(items.map((item) => item.externalBookId)).size !== 10) {
      throw new FanqieRankingParseError(
        "Fanqie ranking contains duplicate book IDs",
      );
    }

    return {
      platform: "fanqie",
      rankTypeKey: input.definition.rankTypeKey,
      rankType: input.definition.rankType,
      sourceUrl: input.sourceUrl,
      fetchedAt: input.fetchedAt,
      items,
    };
  }

  private findCandidateList(initialState: unknown): Record<string, unknown>[] {
    const state = this.objectValue(initialState);

    if (state === null) {
      throw new FanqieRankingParseError("Invalid Fanqie ranking state");
    }

    const branches = [state.rankBookList, state.rankData, state.pageData];

    for (const branch of branches) {
      const candidates = this.listValue(branch);

      if (candidates !== null) {
        return candidates;
      }

      const record = this.objectValue(branch);

      if (record === null) {
        continue;
      }

      for (const key of ["bookList", "book_list", "list"] as const) {
        const nestedCandidates = this.listValue(record[key]);

        if (nestedCandidates !== null) {
          return nestedCandidates;
        }
      }
    }

    throw new FanqieRankingParseError("Invalid Fanqie ranking state");
  }

  private parseItem(
    item: Record<string, unknown>,
    index: number,
  ): CrawledRankingItem {
    const externalBookId = this.stringValue(item.bookId ?? item.book_id);
    const title = this.stringValue(
      item.bookName ?? item.book_name ?? item.title,
    );
    const author = this.stringValue(
      item.authorName ?? item.author_name ?? item.author,
    );

    if (
      externalBookId === null ||
      !/^\d+$/.test(externalBookId) ||
      title === null ||
      author === null
    ) {
      throw new FanqieRankingParseError(
        "Fanqie ranking contains an incomplete item",
      );
    }

    const metrics = this.compactMetrics({
      readCount: this.optionalSafeInteger(
        item.readCount ?? item.read_count,
        "read count",
      ),
      wordCount: this.optionalSafeInteger(
        item.wordCount ?? item.wordNumber ?? item.word_number,
        "word count",
      ),
      creationStatus: this.stringValue(
        item.creationStatus ?? item.creation_status,
      ),
      lastChapterTitle: this.stringValue(
        item.lastChapterTitle ?? item.last_chapter_title,
      ),
      category: this.stringValue(item.category ?? item.categoryName),
    });

    return {
      rank: index + 1,
      externalBookId,
      title,
      author,
      coverUrl: this.httpsUrlValue(
        item.coverUrl ?? item.thumbUrl ?? item.thumb_url,
      ),
      sourceUrl: new URL(
        `${FANQIE_BOOK_PATH_PREFIX}${externalBookId}`,
        FANQIE_BASE_URL,
      ).href,
      metrics,
    };
  }

  private listValue(value: unknown): Record<string, unknown>[] | null {
    if (!Array.isArray(value) || value.length === 0) {
      return null;
    }

    const records = value.map((candidate) => this.objectValue(candidate));

    return records.every(
      (candidate): candidate is Record<string, unknown> => candidate !== null,
    )
      ? records
      : null;
  }

  private optionalSafeInteger(
    value: unknown,
    label: string,
  ): number | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? parseDisplayedNumber(value)
          : null;

    if (
      parsed === null ||
      !Number.isSafeInteger(parsed) ||
      parsed < 0
    ) {
      throw new FanqieRankingParseError(`Invalid Fanqie ${label}`);
    }

    return parsed;
  }

  private compactMetrics(
    values: Record<string, string | number | null | undefined>,
  ): CrawlerJsonObject {
    return Object.fromEntries(
      Object.entries(values).filter(
        (entry): entry is [string, string | number] =>
          entry[1] !== null && entry[1] !== undefined,
      ),
    );
  }

  private stringValue(value: unknown): string | null {
    if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      return String(value);
    }

    if (typeof value !== "string") {
      return null;
    }

    const normalized = normalizePlainText(value);
    return normalized === "" ? null : normalized;
  }

  private httpsUrlValue(value: unknown): string | null {
    const input = this.stringValue(value);

    if (input === null) {
      return null;
    }

    try {
      const url = new URL(input, FANQIE_BASE_URL);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  private objectValue(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
