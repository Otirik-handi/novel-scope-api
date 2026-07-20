import {
  BadGatewayException,
  Controller,
  Get,
  Param,
  Post,
} from "@nestjs/common";
import { PlatformParamsDto } from "./dto/platform-params.dto";
import { RankingParamsDto } from "./dto/ranking-params.dto";
import type {
  RankingRefreshResult,
  RankingSnapshot,
} from "./interfaces/ranking.interface";
import { RankingsService } from "./rankings.service";

@Controller("v1/rankings")
export class RankingsController {
  constructor(private readonly rankingsService: RankingsService) {}

  @Get(":platform/:rankType")
  getLatest(@Param() params: RankingParamsDto): Promise<RankingSnapshot> {
    return this.rankingsService.getLatest(params.platform, params.rankType);
  }

  @Post(":platform/:rankType/refresh")
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
  refreshAll(
    @Param() params: PlatformParamsDto,
  ): Promise<RankingRefreshResult[]> {
    return this.rankingsService.refreshAll(params.platform);
  }
}
