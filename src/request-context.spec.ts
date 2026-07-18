import { createRequestId, redactLogValue } from './request-context';

describe('request context logging helpers', () => {
  it('creates a request id and redacts sensitive values recursively', () => {
    expect(createRequestId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      redactLogValue({
        requestId: 'request-1',
        apiKey: 'do-not-log',
        databaseUrl: 'postgresql://user:password@host/database',
        responseBody: { title: 'do-not-log' },
        nested: { authorization: 'Bearer do-not-log' },
      }),
    ).toEqual({
      requestId: 'request-1',
      apiKey: '[REDACTED]',
      databaseUrl: '[REDACTED]',
      responseBody: '[REDACTED]',
      nested: { authorization: '[REDACTED]' },
    });
  });
});
