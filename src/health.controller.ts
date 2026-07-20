import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @ApiOperation({ summary: 'Check process liveness' })
  @ApiResponse({ status: 200, description: 'Process is responding.' })
  live(): { status: 'ok' } { return { status: 'ok' }; }

  @Get()
  @ApiOperation({ summary: 'Check process liveness (compatibility alias)' })
  @ApiResponse({ status: 200, description: 'Process is responding.' })
  health(): { status: 'ok' } { return this.live(); }

  @Get('ready')
  @ApiOperation({ summary: 'Check PostgreSQL readiness without crawling' })
  @ApiResponse({ status: 200, description: 'PostgreSQL is reachable.' })
  @ApiResponse({ status: 503, description: 'PostgreSQL is unavailable.' })
  async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}
