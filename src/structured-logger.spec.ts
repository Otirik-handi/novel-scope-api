import { requestCompletionLogger, StructuredLogger } from './structured-logger';

describe('StructuredLogger', () => {
  it('writes a redacted JSON HTTP completion event', () => {
    const write = jest.fn();
    const logger = new StructuredLogger(write);

    logger.httpCompleted({
      requestId: 'request-1', method: 'POST', path: '/v1/admin/refresh',
      durationMs: 42, statusCode: 201,
    });

    expect(write).toHaveBeenCalledWith(
      `${JSON.stringify({ event: 'http.completed', requestId: 'request-1', method: 'POST', path: '/v1/admin/refresh', durationMs: 42, statusCode: 201 })}\n`,
    );
  });

  it('provides a redacted crawl recording interface for providers', () => {
    const write = jest.fn();
    const logger = new StructuredLogger(write);

    logger.crawlCompleted({
      targetType: 'ranking', targetKey: 'qidian:hotsales', platform: 'qidian',
      durationMs: 108, status: 'success', result: 'success',
    });

    expect(write).toHaveBeenCalledWith(
      `${JSON.stringify({ event: 'crawl.completed', targetType: 'ranking', targetKey: 'qidian:hotsales', platform: 'qidian', durationMs: 108, status: 'success', result: 'success' })}\n`,
    );
  });

  it('omits body, html, and upstream body even when passed at runtime', () => {
    const write = jest.fn();
    const logger = new StructuredLogger(write);

    logger.crawlCompleted({
      targetType: 'ranking', targetKey: 'qidian:hotsales', platform: 'qidian',
      durationMs: 108, status: 'failed',
      body: 'do-not-log', html: '<html>do-not-log</html>', upstreamBody: 'do-not-log',
    } as never);

    const output = write.mock.calls[0]?.[0] as string;
    expect(output).not.toContain('do-not-log');
    expect(output).not.toContain('body');
    expect(output).not.toContain('html');
    expect(output).not.toContain('upstreamBody');
  });

  it('ignores an HTML error and writes only the controlled error code summary', () => {
    const write = jest.fn();
    const logger = new StructuredLogger(write);

    logger.crawlCompleted({
      targetType: 'ranking', targetKey: 'qidian:hotsales', platform: 'qidian',
      durationMs: 108, status: 'failed', errorCode: 'UPSTREAM_ERROR',
      error: '<html><body>upstream page body</body></html>',
    } as never);

    expect(write).toHaveBeenCalledWith(
      `${JSON.stringify({
        event: 'crawl.completed', targetType: 'ranking', targetKey: 'qidian:hotsales',
        platform: 'qidian', durationMs: 108, status: 'failed',
        errorCode: 'UPSTREAM_ERROR', errorSummary: 'Upstream request failed; see monitoring error code.',
      })}\n`,
    );
  });

  it('ignores a plain text upstream body passed through error', () => {
    const write = jest.fn();
    const logger = new StructuredLogger(write);

    logger.crawlCompleted({
      targetType: 'ranking', targetKey: 'qidian:hotsales', platform: 'qidian',
      durationMs: 108, status: 'failed', errorCode: 'UPSTREAM_ERROR',
      error: 'a plain text upstream response that must not be logged',
    } as never);

    const output = write.mock.calls[0]?.[0] as string;
    expect(output).not.toContain('plain text upstream response');
    expect(output).toContain('"errorCode":"UPSTREAM_ERROR"');
  });

  it('ignores a JSON upstream body passed through error', () => {
    const write = jest.fn();
    const logger = new StructuredLogger(write);

    logger.crawlCompleted({
      targetType: 'ranking', targetKey: 'qidian:hotsales', platform: 'qidian',
      durationMs: 108, status: 'failed', errorCode: 'UPSTREAM_ERROR',
      error: '{"message":"upstream response must not be logged"}',
    } as never);

    const output = write.mock.calls[0]?.[0] as string;
    expect(output).not.toContain('upstream response must not be logged');
    expect(output).toContain('"errorSummary":"Upstream request failed; see monitoring error code."');
  });

  it.each([
    '<html><body>injected response</body></html>',
    'plain text injected response',
    '{"message":"json injected response"}',
  ])('normalizes an untrusted errorCode without outputting %p', (errorCode) => {
    const write = jest.fn();
    const logger = new StructuredLogger(write);

    logger.crawlCompleted({
      targetType: 'ranking', targetKey: 'qidian:hotsales', platform: 'qidian',
      durationMs: 108, status: 'failed', errorCode,
    } as never);

    expect(write).toHaveBeenCalledWith(
      `${JSON.stringify({
        event: 'crawl.completed', targetType: 'ranking', targetKey: 'qidian:hotsales',
        platform: 'qidian', durationMs: 108, status: 'failed',
        errorCode: 'UNKNOWN_ERROR', errorSummary: 'Crawl failed; see monitoring error code.',
      })}\n`,
    );
  });

  it.each([
    '<html><body>injected result</body></html>',
    'plain text injected result',
    '{"message":"json injected result"}',
  ])('normalizes an untrusted result without outputting %p', (result) => {
    const write = jest.fn();
    const logger = new StructuredLogger(write);

    logger.crawlCompleted({
      targetType: 'ranking', targetKey: 'qidian:hotsales', platform: 'qidian',
      durationMs: 108, status: 'failed', result,
    } as never);

    expect(write).toHaveBeenCalledWith(
      `${JSON.stringify({
        event: 'crawl.completed', targetType: 'ranking', targetKey: 'qidian:hotsales',
        platform: 'qidian', durationMs: 108, status: 'failed', result: 'failed',
      })}\n`,
    );
  });

  it('records the HTTP result when a response finishes', () => {
    const logger = { httpCompleted: jest.fn() } as unknown as StructuredLogger;
    const request = { method: 'GET', originalUrl: '/health/live', requestId: 'request-1' };
    const response = { statusCode: 200, once: jest.fn((event, callback) => callback()) };
    const next = jest.fn();

    requestCompletionLogger(logger)(request as never, response as never, next);

    expect(next).toHaveBeenCalled();
    expect(logger.httpCompleted).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-1', method: 'GET', path: '/health/live', statusCode: 200,
    }));
  });

  it('logs only the pathname when the request URL contains sensitive query values', () => {
    const logger = { httpCompleted: jest.fn() } as unknown as StructuredLogger;
    const request = {
      method: 'GET',
      originalUrl: '/v1/rankings?apiKey=secret&token=secret&password=secret',
      requestId: 'request-1',
    };
    const response = { statusCode: 200, once: jest.fn((event, callback) => callback()) };

    requestCompletionLogger(logger)(request as never, response as never, jest.fn());

    expect(logger.httpCompleted).toHaveBeenCalledWith(expect.objectContaining({
      path: '/v1/rankings',
    }));
  });
});
