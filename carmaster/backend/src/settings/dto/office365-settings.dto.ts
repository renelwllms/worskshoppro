import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class Office365SettingsDto {
  @IsOptional()
  @IsString()
  azureClientId?: string;

  @IsOptional()
  @IsString()
  azureTenantId?: string;

  @IsOptional()
  @IsString()
  azureClientSecret?: string;

  @IsOptional()
  @IsString()
  azureRedirectUri?: string;

  @IsOptional()
  @IsBoolean()
  bookingsEnabled?: boolean;

  @IsOptional()
  @IsString()
  bookingsPageUrl?: string;

  @IsOptional()
  @IsString()
  bookingsBusinessId?: string;
}
