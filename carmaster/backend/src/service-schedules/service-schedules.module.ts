import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServiceSchedulesController } from './service-schedules.controller';
import { ServiceSchedulesRunner } from './service-schedules.runner';
import { ServiceSchedulesService } from './service-schedules.service';

@Module({
  imports: [PrismaModule],
  controllers: [ServiceSchedulesController],
  providers: [ServiceSchedulesService, ServiceSchedulesRunner],
})
export class ServiceSchedulesModule {}
