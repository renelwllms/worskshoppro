import { IsBoolean, IsEnum, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { PriceType } from '@prisma/client';

export class UpsellOptionDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsEnum(PriceType)
  priceType: PriceType;

  @IsOptional()
  @IsObject()
  applicabilityRules?: Record<string, any>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
