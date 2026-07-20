import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request & { requestId?: string }>();
    const http = exception instanceof HttpException ? exception : undefined;
    const statusCode = http?.getStatus() ?? (typeof exception === 'object' && exception !== null && 'status' in exception && typeof exception.status === 'number' ? exception.status : HttpStatus.INTERNAL_SERVER_ERROR);
    const value = http?.getResponse();
    const source = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
    const code = statusCode === HttpStatus.TOO_MANY_REQUESTS ? 'RATE_LIMITED' : statusCode === HttpStatus.BAD_REQUEST ? 'VALIDATION_FAILED' : (typeof source.code === 'string' ? source.code : (typeof exception === 'object' && exception !== null && 'code' in exception && typeof exception.code === 'string' ? exception.code : 'INTERNAL_ERROR'));
    const message = typeof source.message === 'string' ? source.message : statusCode >= 500 ? 'Internal server error' : 'Request failed';
    const details = Array.isArray(source.message) ? source.message : undefined;
    response.status(statusCode).json({ statusCode, code, message, requestId: request.requestId ?? 'unknown', ...(details ? { details } : {}) });
  }
}
