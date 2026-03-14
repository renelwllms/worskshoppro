import { IsEmail, IsOptional, IsString } from 'class-validator';

export class BookingsAppointmentDto {
  @IsString()
  serviceId: string;

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

  @IsString()
  startDateTime: string;

  @IsString()
  endDateTime: string;

  @IsOptional()
  @IsString()
  timeZone?: string;
}
