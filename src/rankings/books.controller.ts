import { BadRequestException, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { BookDetailsService } from './book-details.service';
import { BookDetailSnapshot } from './domain/book-detail.types';

@Controller()
export class BooksController {
  constructor(private readonly details: BookDetailsService) {}

  @Get('v1/books/qidian/:bookId')
  get(@Param('bookId') bookId: string): Promise<BookDetailSnapshot> {
    return this.details.get(this.validateBookId(bookId));
  }

  @UseGuards(ApiKeyGuard)
  @Post('v1/admin/books/qidian/:bookId/refresh')
  refresh(@Param('bookId') bookId: string): Promise<BookDetailSnapshot> {
    return this.details.refresh(this.validateBookId(bookId));
  }

  private validateBookId(bookId: string): string {
    if (!/^\d+$/.test(bookId)) throw new BadRequestException('bookId must contain only digits');
    return bookId;
  }
}
