import { IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { JobType, VehicleType } from '@prisma/client';

export class PublicJobDto {
  @IsString()
  rego: string;

  @IsOptional()
  @IsString()
  vehicleBrand?: string;

  @IsOptional()
  @IsString()
  vehicleModel?: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  phone: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  jobNumber?: string;

  @IsEnum(JobType)
  jobType: JobType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedUpsellIds?: string[];

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

  @IsInt()
  @Min(0)
  odometerKm: number;

  @IsOptional()
  @IsDateString()
  wofExpiryDate?: string;

  @IsOptional()
  @IsDateString()
  regoExpiryDate?: string;

  @IsOptional()
  @IsBoolean()
  requireWofForServiceBooking?: boolean;
}
