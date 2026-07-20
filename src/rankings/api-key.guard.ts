import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = process.env.REFRESH_API_KEY;
    const provided = request.header('x-api-key') ?? '';
    const expectedHash = createHash('sha256').update(apiKey ?? '').digest();
    const providedHash = createHash('sha256').update(provided).digest();
    if (!apiKey || !timingSafeEqual(expectedHash, providedHash)) {
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'Invalid API key' });
    }

    return true;
  }
}
