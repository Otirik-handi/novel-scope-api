import { IsIn } from "class-validator";
import {
  SUPPORTED_PLATFORMS,
  type Platform,
} from "../../shared/types/platform.type";

export class PlatformParamsDto {
  @IsIn(SUPPORTED_PLATFORMS)
  platform!: Platform;
}
