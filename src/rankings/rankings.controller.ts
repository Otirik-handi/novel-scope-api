import {
  BadGatewayException,
  Controller,
  Get,
  Param,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PlatformParamsDto } from "./dto/platform-params.dto";
import { RankingParamsDto } from "./dto/ranking-params.dto";
import type {
  RankingRefreshResult,
  RankingSnapshot,
} from "./interfaces/ranking.interface";
import { RankingsService } from "./rankings.service";

@ApiTags("Rankings")
@Controller("v1/rankings")
export class RankingsController {
  constructor(private readonly rankingsService: RankingsService) {}

  @Get(":platform/:rankType")
  @ApiOperation({ summary: "获取榜单快照", description: "获取指定平台指定榜单的最新快照数据" })
  getLatest(@Param() params: RankingParamsDto): Promise<RankingSnapshot> {
    return this.rankingsService.getLatest(params.platform, params.rankType);
  }

  @Post(":platform/:rankType/refresh")
  @ApiOperation({ summary: "刷新单个榜单", description: "强制刷新指定平台的单个榜单数据" })
  async refresh(@Param() params: RankingParamsDto): Promise<RankingSnapshot> {
    try {
      return await this.rankingsService.refresh(
        params.platform,
        params.rankType,
      );
    } catch {
      throw new BadGatewayException("Failed to refresh ranking");
    }
  }

  @Post(":platform/refresh")
  @ApiOperation({ summary: "刷新全部榜单", description: "强制刷新指定平台的全部榜单数据" })
  refreshAll(
    @Param() params: PlatformParamsDto,
  ): Promise<RankingRefreshResult[]> {
    return this.rankingsService.refreshAll(params.platform);
  }
}
