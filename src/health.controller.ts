import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @ApiOperation({ summary: '进程存活检查' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  @Get('live')
  live(): { status: 'ok' } { return { status: 'ok' }; }

  @ApiOperation({ summary: '兼容的进程存活检查' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  @Get()
  health(): { status: 'ok' } { return this.live(); }

  @ApiOperation({ summary: 'PostgreSQL 就绪检查' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  @ApiResponse({ status: 503, schema: { example: { statusCode: 503, code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: '...' } } })
  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}
