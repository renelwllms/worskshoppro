import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SendScheduleRemindersDto } from './dto/send-schedule-reminders.dto';
import { ServiceSchedulesRunner } from './service-schedules.runner';
import { ServiceSchedulesService } from './service-schedules.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('service-schedules')
export class ServiceSchedulesController {
  constructor(
    private readonly schedulesService: ServiceSchedulesService,
    private readonly schedulesRunner: ServiceSchedulesRunner,
  ) {}

  @Get()
  list(@Query('view') view?: string, @Query('daysAhead') daysAhead?: string) {
    const normalizedView = view === 'overdue' || view === 'upcoming' ? view : 'all';
    const parsedDaysAhead = Number(daysAhead);
    const finalDaysAhead = Number.isFinite(parsedDaysAhead) ? parsedDaysAhead : undefined;
    return this.schedulesService.listSchedules(normalizedView, finalDaysAhead);
  }

  @Post('sync')
  sync() {
    return this.schedulesService.syncSchedules();
  }

  @Post('reminders/send')
  sendReminders(@Body() dto: SendScheduleRemindersDto) {
    return this.schedulesService.sendReminders(dto);
  }

  @Get('reminders/renewals/status')
  getRenewalReminderStatus() {
    return this.schedulesRunner.getStatus();
  }

  @Roles('admin')
  @Post('reminders/renewals/run')
  runRenewalRemindersNow() {
    return this.schedulesService.sendAutomaticRenewalReminders();
  }
}
