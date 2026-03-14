import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PriceType, ServicePackageInclusionType, VehicleType } from '@prisma/client';

export class ServicePackagePriceDto {
  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @IsNumber()
  @Min(0)
  basePrice: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(PriceType)
  priceType?: PriceType;
}

export class ServicePackageInclusionDto {
  @IsEnum(ServicePackageInclusionType)
  type: ServicePackageInclusionType;

  @IsString()
  title: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ServicePackageDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ServicePackagePriceDto)
  prices: ServicePackagePriceDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServicePackageInclusionDto)
  inclusions: ServicePackageInclusionDto[];
}
