import { IsIn, Matches } from "class-validator";
import {
  SUPPORTED_PLATFORMS,
  type Platform,
} from "../../shared/types/platform.type";

export class PlatformBookDownloadParamsDto {
  @IsIn(SUPPORTED_PLATFORMS)
  platform!: Platform;

  @Matches(/^\d+$/)
  bookId!: string;
}
