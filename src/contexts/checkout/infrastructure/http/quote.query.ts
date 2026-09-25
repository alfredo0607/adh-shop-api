import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';

export class QuoteQuery {
  @ApiProperty({ example: 'prod-espresso-01' })
  @IsString()
  @Length(1, 64)
  readonly productId!: string;

  @ApiProperty({ example: 1, minimum: 1, maximum: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  readonly units!: number;
}
