import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { InvoiceInclusionMode } from '@prisma/client';

export class UpdateSettingDto {
  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  faviconUrl?: string;

  @IsOptional()
  @IsString()
  pwaIconUrl?: string;

  @IsOptional()
  @IsString()
  pwaIconMaskableUrl?: string;

  @IsOptional()
  @IsString()
  themePrimary?: string;

  @IsOptional()
  @IsString()
  themeSecondary?: string;

  @IsOptional()
  @IsString()
  pwaName?: string;

  @IsOptional()
  @IsString()
  pwaShortName?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;

  @IsOptional()
  @IsString()
  gstNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  invoiceNumberStart?: number;

  @IsOptional()
  @IsString()
  quoteEmailTemplate?: string;

  @IsOptional()
  @IsString()
  invoiceEmailTemplate?: string;

  @IsOptional()
  @IsString()
  serviceReminderEmailTemplate?: string;

  @IsOptional()
  @IsString()
  wofReminderEmailTemplate?: string;

  @IsOptional()
  @IsString()
  regoReminderEmailTemplate?: string;

  @IsOptional()
  @IsString()
  serviceReminderSmsTemplate?: string;

  @IsOptional()
  @IsString()
  wofReminderSmsTemplate?: string;

  @IsOptional()
  @IsString()
  regoReminderSmsTemplate?: string;

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

  @IsOptional()
  @IsInt()
  @Min(0)
  upsellMileageThreshold?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  upsellLastServiceMonths?: number;

  @IsOptional()
  @IsEnum(InvoiceInclusionMode)
  packageInclusionInvoiceMode?: InvoiceInclusionMode;
}
