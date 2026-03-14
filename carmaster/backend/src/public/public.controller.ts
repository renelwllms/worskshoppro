import { Body, Controller, Get, Header, Post, Query } from '@nestjs/common';
import { PublicService } from './public.service';
import { PublicJobDto } from './dto/public-job.dto';
import { Throttle } from '@nestjs/throttler';
import { BookingsAvailabilityDto } from './dto/bookings-availability.dto';
import { BookingsAppointmentDto } from './dto/bookings-appointment.dto';

@Throttle({ default: { limit: 5, ttl: 60 } })
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Post('repair')
  newRepair(@Body() dto: PublicJobDto) {
    return this.publicService.createRepairJob(dto);
  }

  @Post('service')
  bookService(@Body() dto: PublicJobDto) {
    return this.publicService.createServiceBooking(dto);
  }

  @Get('job-number')
  previewJobNumber() {
    return this.publicService.previewJobNumber();
  }

  @Get('services')
  listServices() {
    return this.publicService.listServices();
  }

  @Get('service-packages')
  listServicePackages() {
    return this.publicService.listServicePackages();
  }

  @Get('upsells')
  listUpsells() {
    return this.publicService.listUpsells();
  }

  @Get('customers')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  findCustomer(@Query('rego') rego?: string) {
    return this.publicService.findCustomerByRego(rego);
  }

  @Get('config')
  getConfig() {
    return this.publicService.getPublicConfig();
  }

  @Header('Content-Type', 'application/manifest+json')
  @Header('Cache-Control', 'no-cache, no-store, must-revalidate')
  @Get('manifest.webmanifest')
  getManifest() {
    return this.publicService.getPublicManifest();
  }

  @Get('bookings/services')
  listBookingServices() {
    return this.publicService.listBookingServices();
  }

  @Post('bookings/availability')
  getBookingAvailability(@Body() dto: BookingsAvailabilityDto) {
    return this.publicService.getBookingAvailability(dto);
  }

  @Post('bookings/appointments')
  createBookingAppointment(@Body() dto: BookingsAppointmentDto) {
    return this.publicService.createBookingAppointment(dto);
  }
}
