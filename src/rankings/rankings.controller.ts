import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { RankingQueryDto } from './dto/ranking-query.dto';
import { RefreshRankingDto } from './dto/refresh-ranking.dto';
import { RankingSnapshot } from './domain/ranking.types';
import { RankingsService } from './rankings.service';

@Controller()
export class RankingsController {
  constructor(private readonly rankings: RankingsService) {}

  @Get('v1/rankings')
  get(@Query() query: RankingQueryDto): Promise<RankingSnapshot> {
    return this.rankings.get({ ...query, channel: query.channel ?? null });
  }

  @UseGuards(ApiKeyGuard)
  @Post('v1/admin/refresh')
  refresh(@Body() body: RefreshRankingDto): Promise<RankingSnapshot> {
    return this.rankings.refresh({ ...body, channel: body.channel ?? null });
  }
}
