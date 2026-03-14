import { IsNumber, IsString, Min, MinLength } from 'class-validator';

export class QuoteItemDto {
  @IsString()
  @MinLength(2)
  description: string;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;
}
