import { IsIn } from 'class-validator';

export class PlatformRouteDto {
  @IsIn(['qidian'])
  platform!: 'qidian';
}
