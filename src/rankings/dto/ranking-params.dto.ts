import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import { RANK_TYPES, type RankType } from "../../crawlers/interfaces";
import { PlatformParamsDto } from "./platform-params.dto";

export class RankingParamsDto extends PlatformParamsDto {
  @ApiProperty({
    description: "榜单类型",
    enum: RANK_TYPES,
    example: "yuepiao",
  })
  @IsIn(RANK_TYPES)
  rankType!: RankType;
}
