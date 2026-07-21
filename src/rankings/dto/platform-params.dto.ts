import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import {
  SUPPORTED_PLATFORMS,
  type Platform,
} from "../../shared/types/platform.type";

export class PlatformParamsDto {
  @ApiProperty({
    description: "小说平台",
    enum: SUPPORTED_PLATFORMS,
    example: "qidian",
  })
  @IsIn(SUPPORTED_PLATFORMS)
  platform!: Platform;
}
