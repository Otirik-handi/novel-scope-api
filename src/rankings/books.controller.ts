import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { BookDetailsService } from './book-details.service';
import { BookDetailSnapshot } from './domain/book-detail.types';

@Controller()
@ApiTags('Books')
export class BooksController {
  constructor(private readonly details: BookDetailsService) {}

  @Get('v1/books/:platform/:bookId')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Read a Qidian book detail, refreshing it when expired' })
  @ApiParam({ name: 'platform', enum: ['qidian'] })
  @ApiParam({ name: 'bookId', description: 'Numeric Qidian book identifier', example: '1035420986' })
  @ApiResponse({ status: 200, description: 'Fresh or stale detail snapshot.' })
  @ApiResponse({ status: 400, description: 'Invalid platform or book identifier.' })
  @ApiResponse({ status: 502, description: 'Initial crawl failed.' })
  @ApiResponse({ status: 504, description: 'Refresh budget elapsed.' })
  get(@Param('platform') platform: string, @Param('bookId') bookId: string): Promise<BookDetailSnapshot> {
    if (platform !== 'qidian') throw new BadRequestException('platform must be qidian');
    return this.details.get(this.validateBookId(bookId));
  }

  private validateBookId(bookId: string): string {
    if (!/^\d+$/.test(bookId)) throw new BadRequestException('bookId must contain only digits');
    return bookId;
  }
}
