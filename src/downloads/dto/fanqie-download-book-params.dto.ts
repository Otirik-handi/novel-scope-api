import { Matches } from "class-validator";

export class FanqieDownloadBookParamsDto {
  @Matches(/^\d+$/)
  bookId!: string;
}
