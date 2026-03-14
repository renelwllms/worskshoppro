import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PriceType } from '@prisma/client';

export class ServiceCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  checklist: string[];

  @IsNumber()
  @Min(0)
  basePrice: number;

  @IsEnum(PriceType)
  priceType: PriceType;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationMinutes?: number;
}
