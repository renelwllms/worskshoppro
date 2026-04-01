import { IsArray, IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { VehicleType } from '@prisma/client';

export class CreateJobDto {
  @IsString()
  customerId: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  serviceType?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsDateString()
  wofExpiryDate?: string;

  @IsOptional()
  @IsDateString()
  regoExpiryDate?: string;

  @IsOptional()
  @IsString()
  selectedServiceId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  additionalServiceIds?: string[];

  @IsOptional()
  @IsString()
  selectedServicePackageId?: string;

  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedUpsellIds?: string[];
}
