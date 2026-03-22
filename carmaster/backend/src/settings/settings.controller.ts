import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { ServiceCategoryDto } from './dto/service-category.dto';
import { UpsellOptionDto } from './dto/upsell-option.dto';
import { ServicePackageDto } from './dto/service-package.dto';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Office365SettingsDto } from './dto/office365-settings.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Roles('admin', 'staff')
  @Patch()
  update(@Body() dto: UpdateSettingDto) {
    return this.settingsService.updateSettings(dto);
  }

  @Roles('admin')
  @Patch('office365')
  updateOffice365(@Body() dto: Office365SettingsDto) {
    return this.settingsService.updateOffice365Settings(dto);
  }

  @Get('services')
  listServices() {
    return this.settingsService.listServices();
  }

  @Post('services')
  createService(@Body() dto: ServiceCategoryDto) {
    return this.settingsService.createService(dto);
  }

  @Patch('services/:id')
  updateService(@Param('id') id: string, @Body() dto: ServiceCategoryDto) {
    return this.settingsService.updateService(id, dto);
  }

  @Delete('services/:id')
  deleteService(@Param('id') id: string) {
    return this.settingsService.removeService(id);
  }

  @Get('upsells')
  listUpsells() {
    return this.settingsService.listUpsells();
  }

  @Post('upsells')
  createUpsell(@Body() dto: UpsellOptionDto) {
    return this.settingsService.createUpsell(dto);
  }

  @Patch('upsells/:id')
  updateUpsell(@Param('id') id: string, @Body() dto: UpsellOptionDto) {
    return this.settingsService.updateUpsell(id, dto);
  }

  @Delete('upsells/:id')
  deleteUpsell(@Param('id') id: string) {
    return this.settingsService.removeUpsell(id);
  }

  @Get('service-packages')
  listServicePackages() {
    return this.settingsService.listServicePackages();
  }

  @Get('activity-logs')
  listActivityLogs(
    @Query('action') action?: string,
    @Query('entity') entity?: string,
    @Query('actor') actor?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    return this.settingsService.listActivityLogs({
      action,
      entity,
      actor,
      status,
      limit,
    });
  }

  @Post('service-packages')
  createServicePackage(@Body() dto: ServicePackageDto) {
    return this.settingsService.createServicePackage(dto);
  }

  @Patch('service-packages/:id')
  updateServicePackage(@Param('id') id: string, @Body() dto: ServicePackageDto) {
    return this.settingsService.updateServicePackage(id, dto);
  }

  @Delete('service-packages/:id')
  deleteServicePackage(@Param('id') id: string) {
    return this.settingsService.removeServicePackage(id);
  }

  @Roles('admin')
  @Post('bookings/test')
  testBookings() {
    return this.settingsService.testBookingsConnection();
  }
}
