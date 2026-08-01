export class QidianChapterCrawlerError extends Error {
  override readonly name = "QidianChapterCrawlerError";

  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
