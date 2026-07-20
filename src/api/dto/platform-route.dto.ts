import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlatformRouteDto {
  @ApiProperty({ enum: ['qidian'] })
  @IsIn(['qidian'])
  platform!: 'qidian';
}
