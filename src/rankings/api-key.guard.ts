import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = process.env.API_KEY;
    if (!apiKey || request.header('x-api-key') !== apiKey) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
