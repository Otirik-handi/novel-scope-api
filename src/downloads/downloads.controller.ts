import {
  ConflictException,
  Controller,
  Delete,
  Get,
  GoneException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Body,
  StreamableFile,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { CreateBookDownloadDto } from "./dto/create-book-download.dto";
import { DownloadIdParamsDto } from "./dto/download-id-params.dto";
import { FanqieDownloadBookParamsDto } from "./dto/fanqie-download-book-params.dto";
import type { DownloadResource } from "./interfaces/download.interface";
import {
  DownloadArtifactGoneError,
  DownloadConflictError,
  DownloadNotFoundError,
  DownloadsService,
} from "./downloads.service";

@ApiTags("Downloads")
@Controller("v1")
export class DownloadsController {
  constructor(private readonly service: DownloadsService) {}

  @Post("books/fanqie/:bookId/downloads")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "创建番茄正文下载任务" })
  async create(
    @Param() params: FanqieDownloadBookParamsDto,
    @Body() body: CreateBookDownloadDto,
  ): Promise<DownloadResource> {
    return this.execute(() => this.service.create(params.bookId, body));
  }

  @Get("downloads/:downloadId")
  @ApiOperation({ summary: "查询正文下载任务" })
  async get(@Param() params: DownloadIdParamsDto): Promise<DownloadResource> {
    return this.execute(() => this.service.get(params.downloadId));
  }

  @Get("downloads/:downloadId/file")
  @ApiOperation({ summary: "下载已完成的 TXT 正文" })
  async file(@Param() params: DownloadIdParamsDto): Promise<StreamableFile> {
    const file = await this.execute(() => this.service.openFile(params.downloadId));
    return new StreamableFile(file.stream, {
      type: "text/plain; charset=utf-8",
      length: file.sizeBytes,
      disposition: contentDisposition(file.filename),
    });
  }

  @Post("downloads/:downloadId/cancel")
  @ApiOperation({ summary: "取消正文下载任务" })
  async cancel(@Param() params: DownloadIdParamsDto): Promise<DownloadResource> {
    return this.execute(() => this.service.cancel(params.downloadId));
  }

  @Delete("downloads/:downloadId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "删除终态下载任务和 TXT" })
  async delete(@Param() params: DownloadIdParamsDto): Promise<void> {
    return this.execute(() => this.service.delete(params.downloadId));
  }

  private async execute<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof DownloadNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof DownloadConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof DownloadArtifactGoneError) {
        throw new GoneException(error.message);
      }
      throw error;
    }
  }
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
