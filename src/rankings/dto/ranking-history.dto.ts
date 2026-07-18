import { Transform } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class RankingHistoryDto {
  @IsOptional() @IsISO8601({ strict: true, strictSeparator: true }) @Matches(/(Z|[+-]\d{2}:\d{2})$/)
  from?: string;

  @IsOptional() @IsISO8601({ strict: true, strictSeparator: true }) @Matches(/(Z|[+-]\d{2}:\d{2})$/)
  to?: string;

  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsString()
  cursor?: string;
}
