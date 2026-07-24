import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Matches } from "class-validator";
import {
  SUPPORTED_PLATFORMS,
  type Platform,
} from "../../shared/types/platform.type";

export class BookParamsDto {
  @ApiProperty({
    description: "小说平台",
    enum: SUPPORTED_PLATFORMS,
    example: "qidian",
  })
  @IsIn(SUPPORTED_PLATFORMS)
  platform!: Platform;

  @ApiProperty({
    description: "小说 ID（纯数字）",
    example: "123456",
  })
  @IsString()
  @Matches(/^\d+$/)
  bookId!: string;
}
