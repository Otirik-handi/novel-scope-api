import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { BookDetailsService } from './book-details.service';
import { BookDetailSnapshot } from './domain/book-detail.types';

@Controller()
export class BooksController {
  constructor(private readonly details: BookDetailsService) {}

  @Get('v1/books/:platform/:bookId')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  get(@Param('platform') platform: string, @Param('bookId') bookId: string): Promise<BookDetailSnapshot> {
    if (platform !== 'qidian') throw new BadRequestException('platform must be qidian');
    return this.details.get(this.validateBookId(bookId));
  }

  private validateBookId(bookId: string): string {
    if (!/^\d+$/.test(bookId)) throw new BadRequestException('bookId must contain only digits');
    return bookId;
  }
}
