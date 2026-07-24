import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";
import { PlatformParamsDto } from "./platform-params.dto";

export class RankingParamsDto extends PlatformParamsDto {
  @ApiProperty({
    description: "榜单机器键",
    example: "0_1_1139",
  })
  @IsString()
  @IsNotEmpty()
  rankTypeKey!: string;
}
