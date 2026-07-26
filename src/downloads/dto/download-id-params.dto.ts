import { IsUUID } from "class-validator";

export class DownloadIdParamsDto {
  @IsUUID()
  downloadId!: string;
}
