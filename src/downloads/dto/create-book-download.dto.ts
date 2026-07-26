import {
  IsDefined,
  IsInt,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from "class-validator";

@ValidatorConstraint({ name: "chapterRangeOrder", async: false })
class ChapterRangeOrderConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, arguments_: ValidationArguments): boolean {
    const value = arguments_.object as CreateBookDownloadDto;
    if (value.startChapter === undefined && value.endChapter === undefined) {
      return true;
    }
    return (
      Number.isInteger(value.startChapter) &&
      Number.isInteger(value.endChapter) &&
      value.startChapter! <= value.endChapter!
    );
  }

  defaultMessage(): string {
    return "startChapter must be less than or equal to endChapter";
  }
}

export class CreateBookDownloadDto {
  @ValidateIf((value: CreateBookDownloadDto) => value.endChapter !== undefined)
  @IsDefined()
  @IsInt()
  @Min(1)
  startChapter?: number;

  @ValidateIf((value: CreateBookDownloadDto) => value.startChapter !== undefined)
  @IsDefined()
  @IsInt()
  @Min(1)
  endChapter?: number;

  @Validate(ChapterRangeOrderConstraint)
  private readonly chapterRangeOrder?: never;
}
