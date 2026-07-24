import { BadGatewayException, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { BookParamsDto } from "./dto/book-params.dto";
import type { BookDetailResource } from "./interfaces/book.interface";
import {
  BOOK_REFRESH_FAILED,
  BookRefreshError,
  BooksService,
} from "./books.service";

@ApiTags("Books")
@Controller("v1/books")
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @Get(":platform/:bookId")
  @ApiOperation({ summary: "获取小说详情", description: "根据平台和小说 ID 获取小说详情" })
  async getDetail(
    @Param() params: BookParamsDto,
  ): Promise<BookDetailResource> {
    try {
      return await this.booksService.getDetail(params.platform, params.bookId);
    } catch (error) {
      if (error instanceof BookRefreshError) {
        throw new BadGatewayException(BOOK_REFRESH_FAILED);
      }

      throw error;
    }
  }

  @Post(":platform/:bookId/refresh")
  @ApiOperation({ summary: "刷新小说详情", description: "强制重新抓取小说详情数据" })
  async refreshDetail(
    @Param() params: BookParamsDto,
  ): Promise<BookDetailResource> {
    try {
      return await this.booksService.refreshDetail(
        params.platform,
        params.bookId,
      );
    } catch (error) {
      if (error instanceof BookRefreshError) {
        throw new BadGatewayException(BOOK_REFRESH_FAILED);
      }

      throw error;
    }
  }
}
