import { BadGatewayException, Controller, Get, Param } from "@nestjs/common";
import { BookParamsDto } from "./dto/book-params.dto";
import type { BookDetailResource } from "./interfaces/book.interface";
import {
  BOOK_REFRESH_FAILED,
  BookRefreshError,
  BooksService,
} from "./books.service";

@Controller("v1/books")
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @Get(":platform/:bookId")
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
}
