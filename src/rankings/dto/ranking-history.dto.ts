import { Transform } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RankingHistoryDto {
  @ApiPropertyOptional({ format: 'date-time', description: '闭区间起点，必须携带时区' })
  @IsOptional() @IsISO8601({ strict: true, strictSeparator: true }) @Matches(/(Z|[+-]\d{2}:\d{2})$/)
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', description: '闭区间终点，必须携带时区' })
  @IsOptional() @IsISO8601({ strict: true, strictSeparator: true }) @Matches(/(Z|[+-]\d{2}:\d{2})$/)
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: '上一页响应中的 nextCursor' })
  @IsOptional() @IsString()
  cursor?: string;
}
