import { IsNotEmpty, IsString } from "class-validator";
import { PlatformParamsDto } from "./platform-params.dto";

export class RankingParamsDto extends PlatformParamsDto {
  @IsString()
  @IsNotEmpty()
  rankTypeKey!: string;
}
