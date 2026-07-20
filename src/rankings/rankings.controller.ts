import { BadRequestException, Controller, Get, HttpStatus, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiKeyGuard } from './api-key.guard';
import { RankingSnapshot } from './domain/ranking.types';
import { RankingsService } from './rankings.service';
import { RankingRouteDto } from './dto/ranking-route.dto';
import { RankingHistoryDto } from './dto/ranking-history.dto';
import { PlatformRouteDto } from './dto/platform-route.dto';
import {
  ApiErrorResponseDto,
  PlatformRefreshResponseDto,
  RankingHistoryResponseDto,
  RankingSnapshotResponseDto,
} from './dto/api-response.dto';

@ApiTags('rankings')
@Controller()
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  @ApiOperation({ summary: '查询指定榜单的最新成功快照' })
  @ApiOkResponse({ type: RankingSnapshotResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto, description: '没有可用成功快照' })
  @Get('v1/rankings/:platform/:rankType')
  get(@Param() route: RankingRouteDto): Promise<RankingSnapshot> {
    return this.rankings.get({ platform: route.platform, rank: route.rankType, channel: null });
  }

  @ApiOperation({ summary: '按时间范围游标分页查询榜单历史快照' })
  @ApiOkResponse({ type: RankingHistoryResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @Get('v1/rankings/:platform/:rankType/history')
  history(@Param() route: RankingRouteDto, @Query() query: RankingHistoryDto) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new BadRequestException({ code: 'INVALID_TIME_RANGE', message: 'from must not be after to' });
    }
    return this.rankings.history({ platform: route.platform, rank: route.rankType, channel: null }, query);
  }

  @ApiOperation({ summary: '同步刷新指定榜单' })
  @ApiSecurity('refresh-api-key')
  @ApiOkResponse({ type: RankingSnapshotResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiBadGatewayResponse({ type: ApiErrorResponseDto })
  @SkipThrottle()
  @UseGuards(ApiKeyGuard)
  @Post('v1/rankings/:platform/:rankType/refresh')
  refresh(@Param() route: RankingRouteDto): Promise<RankingSnapshot> {
    return this.rankings.refreshStrict({ platform: route.platform, rank: route.rankType, channel: null });
  }

  @ApiOperation({ summary: '同步刷新起点全部 V1 榜单' })
  @ApiSecurity('refresh-api-key')
  @ApiOkResponse({ type: PlatformRefreshResponseDto, description: '全部榜单刷新成功' })
  @ApiResponse({ status: HttpStatus.MULTI_STATUS, type: PlatformRefreshResponseDto, description: '部分成功或全部跳过' })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiBadGatewayResponse({ type: PlatformRefreshResponseDto, description: '全部榜单刷新失败' })
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
