import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class BookingsAvailabilityDto {
  @IsString()
  serviceId: string;

  @IsString()
  date: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsString()
  timeZone?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  slotMinutes?: number;
}
