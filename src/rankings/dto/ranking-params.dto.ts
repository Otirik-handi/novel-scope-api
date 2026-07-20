import { IsIn } from "class-validator";
import { RANK_TYPES, type RankType } from "../../crawlers/interfaces";
import { PlatformParamsDto } from "./platform-params.dto";

export class RankingParamsDto extends PlatformParamsDto {
  @IsIn(RANK_TYPES)
  rankType!: RankType;
}
