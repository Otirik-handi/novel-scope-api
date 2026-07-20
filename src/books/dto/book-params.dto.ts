import { IsIn, IsString, Matches } from "class-validator";
import {
  SUPPORTED_PLATFORMS,
  type Platform,
} from "../../shared/types/platform.type";

export class BookParamsDto {
  @IsIn(SUPPORTED_PLATFORMS)
  platform!: Platform;

  @IsString()
  @Matches(/^\d+$/)
  bookId!: string;
}
