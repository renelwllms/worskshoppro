import { Global, Module } from '@nestjs/common';
import { GraphService } from './graph.service';
import { BookingsService } from './bookings.service';
import { SmsService } from './sms.service';

@Global()
@Module({
  providers: [GraphService, BookingsService, SmsService],
  exports: [GraphService, BookingsService, SmsService],
})
export class IntegrationsModule {}
