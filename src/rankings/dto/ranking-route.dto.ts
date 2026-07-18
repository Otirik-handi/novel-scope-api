import { IsIn } from 'class-validator';

export class RankingRouteDto {
  @IsIn(['qidian'])
  platform!: 'qidian';

  @IsIn(['hotsales', 'yuepiao', 'recom', 'collect'])
  rankType!: 'hotsales' | 'yuepiao' | 'recom' | 'collect';
}
