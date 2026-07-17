import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class RankingQueryDto {
  @IsIn(['qidian', 'jjwxc'])
  platform!: 'qidian' | 'jjwxc';

  @IsString()
  @MinLength(1)
  rank!: string;

  @IsOptional()
  @IsString()
  channel?: string;
}
