import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiGatewayTimeoutResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BookDetailsService } from './book-details.service';
import { BookDetailSnapshot } from './domain/book-detail.types';
import { ApiErrorResponseDto, BookDetailResponseDto } from './dto/api-response.dto';

@ApiTags('books')
@Controller()
export class BooksController {
  constructor(private readonly details: BookDetailsService) {}

  @ApiOperation({ summary: '查询书籍详情，并在缺失或过期时同步刷新' })
  @ApiParam({ name: 'platform', enum: ['qidian'] })
  @ApiParam({ name: 'bookId', schema: { type: 'string', pattern: '^\\d+$' } })
  @ApiOkResponse({ type: BookDetailResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiBadGatewayResponse({ type: ApiErrorResponseDto })
  @ApiGatewayTimeoutResponse({ type: ApiErrorResponseDto })
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
