import { type NextFunction, type Request, type Response } from 'express';
import { redactLogValue } from './request-context';

type LogWriter = (line: string) => void;
type HttpCompletion = { requestId: string; method: string; path: string; durationMs: number; statusCode: number };
export type CrawlErrorCode = 'UPSTREAM_ERROR' | 'TIMEOUT' | 'NETWORK_ERROR' | 'UNKNOWN_ERROR';
type CrawlResult = 'success' | 'failed' | 'skipped';
type CrawlCompletion = {
  targetType: string; targetKey: string; platform: string; durationMs: number; status: string;
  result?: CrawlResult; errorCode?: CrawlErrorCode;
};

const ERROR_SUMMARIES: Record<CrawlErrorCode, string> = {
  UPSTREAM_ERROR: 'Upstream request failed; see monitoring error code.',
  TIMEOUT: 'Upstream request timed out; see monitoring error code.',
  NETWORK_ERROR: 'Upstream network request failed; see monitoring error code.',
  UNKNOWN_ERROR: 'Crawl failed; see monitoring error code.',
};

export class StructuredLogger {
  constructor(private readonly write: LogWriter = (line) => process.stdout.write(line)) {}

  httpCompleted(event: HttpCompletion): void {
    this.emit({
      event: 'http.completed', requestId: event.requestId, method: event.method,
      path: event.path, durationMs: event.durationMs, statusCode: event.statusCode,
    });
  }

  crawlCompleted(event: CrawlCompletion): void {
    const normalizedError = event.errorCode === undefined
      ? {}
      : normalizeErrorCode(event.errorCode);
    this.emit({
      event: 'crawl.completed', targetType: event.targetType, targetKey: event.targetKey,
      platform: event.platform, durationMs: event.durationMs, status: event.status,
      ...(event.result === undefined ? {} : { result: normalizeResult(event.result) }),
      ...normalizedError,
    });
  }

  private emit(event: Record<string, unknown>): void {
    this.write(`${JSON.stringify(redactLogValue(event))}\n`);
  }
}

function normalizeErrorCode(errorCode: unknown): { errorCode: CrawlErrorCode; errorSummary: string } {
  const controlledCode =
    typeof errorCode === 'string' && errorCode in ERROR_SUMMARIES
      ? errorCode as CrawlErrorCode
      : 'UNKNOWN_ERROR';

  return { errorCode: controlledCode, errorSummary: ERROR_SUMMARIES[controlledCode] };
}

function normalizeResult(result: unknown): CrawlResult {
  return result === 'success' || result === 'failed' || result === 'skipped'
    ? result
    : 'failed';
}

export const appLogger = new StructuredLogger();

export function requestCompletionLogger(logger: StructuredLogger) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const startedAt = process.hrtime.bigint();
    response.once('finish', () => {
      logger.httpCompleted({
        requestId: (request as Request & { requestId?: string }).requestId ?? 'unknown',
        method: request.method,
        path: new URL(request.originalUrl, 'http://localhost').pathname,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        statusCode: response.statusCode,
      });
    });
    next();
  };
}
