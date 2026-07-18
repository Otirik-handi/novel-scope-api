import { BadRequestException, Controller, Get, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiKeyGuard } from './api-key.guard';
import { RankingSnapshot } from './domain/ranking.types';
import { RankingsService } from './rankings.service';
import { RankingRouteDto } from './dto/ranking-route.dto';
import { RankingHistoryDto } from './dto/ranking-history.dto';
import { PlatformRouteDto } from './dto/platform-route.dto';

@Controller()
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  @Get('v1/rankings/:platform/:rankType')
  get(@Param() route: RankingRouteDto): Promise<RankingSnapshot> {
    return this.rankings.get({ platform: route.platform, rank: route.rankType, channel: null });
  }

  @Get('v1/rankings/:platform/:rankType/history')
  history(@Param() route: RankingRouteDto, @Query() query: RankingHistoryDto) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new BadRequestException({ code: 'INVALID_TIME_RANGE', message: 'from must not be after to' });
    }
    return this.rankings.history({ platform: route.platform, rank: route.rankType, channel: null }, query);
  }

  @SkipThrottle()
  @UseGuards(ApiKeyGuard)
  @Post('v1/rankings/:platform/:rankType/refresh')
  refresh(@Param() route: RankingRouteDto): Promise<RankingSnapshot> {
    return this.rankings.refreshStrict({ platform: route.platform, rank: route.rankType, channel: null });
  }

  @SkipThrottle()
  @UseGuards(ApiKeyGuard)
  @Post('v1/rankings/:platform/refresh')
  async refreshPlatform(@Param() route: PlatformRouteDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.rankings.refreshPlatform(route.platform);
    const succeeded = result.results.filter((item) => item.status === 'success').length;
    const failed = result.results.filter((item) => item.status === 'failed').length;
    response.status(failed === result.results.length ? HttpStatus.BAD_GATEWAY : succeeded === result.results.length ? HttpStatus.OK : HttpStatus.MULTI_STATUS);
    return result;
  }
}
