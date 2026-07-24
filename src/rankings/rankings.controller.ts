import {
  BadRequestException,
  BadGatewayException,
  Controller,
  Get,
  Logger,
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
  private readonly logger = new Logger(RankingsController.name);

  constructor(private readonly rankingsService: RankingsService) {}

  @Get(":platform/:rankTypeKey")
  getLatest(@Param() params: RankingParamsDto): Promise<RankingSnapshot> {
    return this.rankingsService.getLatest(
      params.platform,
      params.rankTypeKey,
    );
  }

  @Post(":platform/:rankTypeKey/refresh")
  async refresh(@Param() params: RankingParamsDto): Promise<RankingSnapshot> {
    try {
      return await this.rankingsService.refresh(
        params.platform,
        params.rankTypeKey,
      );
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(
        `Failed to refresh ranking ${params.platform}/${params.rankTypeKey}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
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
