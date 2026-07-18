import { randomUUID } from 'node:crypto';
import { type NextFunction, type Request, type Response } from 'express';

const SENSITIVE_KEY = /api[-_]?key|authorization|cookie|database[-_]?url|connection|string|password|secret|response[-_]?body/i;
export const createRequestId = (): string => randomUUID();
export function redactLogValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [
    key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactLogValue(nestedValue),
  ]));
}

export function requestContextMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = request.header('x-request-id') || createRequestId();
  (request as Request & { requestId?: string }).requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
}
