import { BadRequestException, Controller, Get, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from './api-key.guard';
import { RankingSnapshot } from './domain/ranking.types';
import { RankingsService } from './rankings.service';
import { RankingRouteDto } from './dto/ranking-route.dto';
import { RankingHistoryDto } from './dto/ranking-history.dto';
import { PlatformRouteDto } from './dto/platform-route.dto';

@Controller()
@ApiTags('Rankings')
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  @Get('v1/rankings/:platform/:rankType')
  @ApiOperation({ summary: 'Read the latest persisted ranking snapshot' })
  @ApiParam({ name: 'platform', enum: ['qidian'] })
  @ApiParam({ name: 'rankType', enum: ['hotsales', 'yuepiao', 'recom', 'collect'] })
  @ApiResponse({ status: 200, description: 'Latest successful snapshot.' })
  @ApiResponse({ status: 404, description: 'No successful snapshot exists.' })
  get(@Param() route: RankingRouteDto): Promise<RankingSnapshot> {
    return this.rankings.get({ platform: route.platform, rank: route.rankType, channel: null });
  }

  @Get('v1/rankings/:platform/:rankType/history')
  @ApiOperation({ summary: 'Read ranking snapshot history with cursor pagination' })
  @ApiParam({ name: 'platform', enum: ['qidian'] })
  @ApiParam({ name: 'rankType', enum: ['hotsales', 'yuepiao', 'recom', 'collect'] })
  @ApiResponse({ status: 200, description: 'A page of immutable snapshots.' })
  @ApiResponse({ status: 400, description: 'Invalid history query.' })
  history(@Param() route: RankingRouteDto, @Query() query: RankingHistoryDto) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new BadRequestException({ code: 'INVALID_TIME_RANGE', message: 'from must not be after to' });
    }
    return this.rankings.history({ platform: route.platform, rank: route.rankType, channel: null }, query);
  }

  @SkipThrottle()
  @UseGuards(ApiKeyGuard)
  @Post('v1/rankings/:platform/:rankType/refresh')
  @ApiOperation({ summary: 'Refresh one Qidian ranking synchronously' })
  @ApiSecurity('refreshApiKey')
  @ApiParam({ name: 'platform', enum: ['qidian'] })
  @ApiParam({ name: 'rankType', enum: ['hotsales', 'yuepiao', 'recom', 'collect'] })
  @ApiResponse({ status: 201, description: 'A new snapshot was persisted.' })
  @ApiResponse({ status: 401, description: 'Invalid API key.' })
  @ApiResponse({ status: 409, description: 'Refresh is already in progress.' })
  @ApiResponse({ status: 502, description: 'Upstream crawl failed.' })
  refresh(@Param() route: RankingRouteDto): Promise<RankingSnapshot> {
    return this.rankings.refreshStrict({ platform: route.platform, rank: route.rankType, channel: null });
  }

  @SkipThrottle()
  @UseGuards(ApiKeyGuard)
  @Post('v1/rankings/:platform/refresh')
  @ApiOperation({ summary: 'Refresh every V0.1 Qidian ranking synchronously' })
  @ApiSecurity('refreshApiKey')
  @ApiParam({ name: 'platform', enum: ['qidian'] })
  @ApiResponse({ status: 200, description: 'Every ranking refreshed successfully.' })
  @ApiResponse({ status: 207, description: 'At least one ranking failed or was skipped.' })
  @ApiResponse({ status: 401, description: 'Invalid API key.' })
  @ApiResponse({ status: 502, description: 'Every ranking refresh failed.' })
  async refreshPlatform(@Param() route: PlatformRouteDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.rankings.refreshPlatform(route.platform);
    const succeeded = result.results.filter((item) => item.status === 'success').length;
    const failed = result.results.filter((item) => item.status === 'failed').length;
    response.status(failed === result.results.length ? HttpStatus.BAD_GATEWAY : succeeded === result.results.length ? HttpStatus.OK : HttpStatus.MULTI_STATUS);
    return result;
  }
}
