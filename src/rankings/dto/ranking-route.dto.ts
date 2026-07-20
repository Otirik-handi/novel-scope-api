import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RankingRouteDto {
  @ApiProperty({ enum: ['qidian'] })
  @IsIn(['qidian'])
  platform!: 'qidian';

  @ApiProperty({ enum: ['hotsales', 'yuepiao', 'recom', 'collect'] })
  @IsIn(['hotsales', 'yuepiao', 'recom', 'collect'])
  rankType!: 'hotsales' | 'yuepiao' | 'recom' | 'collect';
}
