import { Injectable, Logger } from '@nestjs/common';
import {
  JobType,
  Prisma,
  ReminderChannel,
  ReminderStatus,
  ScheduleType,
} from '@prisma/client';
import { addDays, addMonths, differenceInCalendarDays, endOfDay, startOfDay } from 'date-fns';
import { GraphService } from '../integrations/graph.service';
import { SmsService } from '../integrations/sms.service';
import { PrismaService } from '../prisma/prisma.service';
import { SendScheduleRemindersDto } from './dto/send-schedule-reminders.dto';

type ScheduleView = 'all' | 'overdue' | 'upcoming';

type SourceJob = {
  id: string;
  customerId: string;
  jobType: JobType | null;
  title: string;
  serviceType: string | null;
  dueDate: Date | null;
  createdAt: Date;
  wofExpiryDate: Date | null;
  regoExpiryDate: Date | null;
};

type ScheduleWithRelations = Prisma.ServiceScheduleGetPayload<{
  include: {
    customer: {
      select: {
        id: true;
        firstName: true;
        lastName: true;
        email: true;
        phone: true;
        rego: true;
        vehicleBrand: true;
        vehicleModel: true;
      };
    };
    sourceJob: {
      select: {
        id: true;
        title: true;
        serviceType: true;
        createdAt: true;
      };
    };
  };
}>;

type ReminderSettings = {
  businessName: string | null;
  bookingsPageUrl: string | null;
  serviceReminderEmailTemplate: string | null;
  wofReminderEmailTemplate: string | null;
  regoReminderEmailTemplate: string | null;
  serviceReminderSmsTemplate: string | null;
  wofReminderSmsTemplate: string | null;
  regoReminderSmsTemplate: string | null;
};

@Injectable()
export class ServiceSchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly sms: SmsService,
  ) {}

  private readonly logger = new Logger(ServiceSchedulesService.name);
  private readonly defaultServiceIntervalMonths = 6;
  private readonly defaultDaysAhead = 7;
  private readonly renewalReminderDays = new Set([14, 7]);
  private readonly regoRenewalUrl = 'https://transact.nzta.govt.nz/v2/vehicle-licence-renewal';

  private normalizeDaysAhead(value?: number) {
    if (!Number.isFinite(value)) return this.defaultDaysAhead;
    return Math.min(60, Math.max(1, Math.trunc(value as number)));
  }

  private buildServiceDueDate(job: SourceJob) {
    if (job.dueDate) return job.dueDate;
    return addMonths(job.createdAt, this.defaultServiceIntervalMonths);
  }

  private getScheduleBucket(dueDate: Date, daysAhead: number) {
    const todayStart = startOfDay(new Date());
    const dueStart = startOfDay(dueDate);
    if (dueStart < todayStart) return 'overdue' as const;
    const upcomingEnd = endOfDay(addDays(todayStart, daysAhead));
    if (dueStart <= upcomingEnd) return 'upcoming' as const;
    return 'future' as const;
  }

  private mapTypeLabel(type: ScheduleType) {
    if (type === ScheduleType.WOF) return 'WOF';
    if (type === ScheduleType.REGO) return 'Rego';
    return 'Service';
  }

  private getDaysUntilDue(dueDate: Date) {
    return differenceInCalendarDays(startOfDay(dueDate), startOfDay(new Date()));
  }

  private describeDueStatus(daysUntilDue: number) {
    if (daysUntilDue > 1) return `due in ${daysUntilDue} days`;
    if (daysUntilDue === 1) return 'due in 1 day';
    if (daysUntilDue === 0) return 'due today';
    const overdueBy = Math.abs(daysUntilDue);
    return overdueBy === 1 ? 'overdue by 1 day' : `overdue by ${overdueBy} days`;
  }

  private buildReminderSubject(type: ScheduleType, rego: string, daysUntilDue: number) {
    const dueStatus = this.describeDueStatus(daysUntilDue);
    if (type === ScheduleType.WOF) {
      return `Reminder: WOF ${dueStatus} for ${rego}`;
    }
    if (type === ScheduleType.REGO) {
      return `Reminder: Rego ${dueStatus} for ${rego}`;
    }
    return `Reminder: Service ${dueStatus} for ${rego}`;
  }

  private setQueryParam(searchParams: URLSearchParams, key: string, value?: string | null) {
    const normalized = value?.trim();
    if (normalized) {
      searchParams.set(key, normalized);
    }
  }

  private buildWofBookingUrl(schedule: ScheduleWithRelations, settings: ReminderSettings) {
    const configuredBookingsUrl = settings.bookingsPageUrl?.trim() || '';
    const bookingsPortalFallback = /\/q(?:[/?#]|$)/i.test(configuredBookingsUrl)
      ? configuredBookingsUrl
      : '';
    const publicPortalUrl = process.env.PUBLIC_PORTAL_URL?.trim() || bookingsPortalFallback;
    const searchParams = new URLSearchParams();
    searchParams.set('intent', 'wof-renewal');
    searchParams.set('service', 'wof');
    searchParams.set('source', 'email-reminder');
    this.setQueryParam(searchParams, 'rego', schedule.customer.rego);
    this.setQueryParam(searchParams, 'firstName', schedule.customer.firstName);
    this.setQueryParam(searchParams, 'lastName', schedule.customer.lastName);
    this.setQueryParam(searchParams, 'phone', schedule.customer.phone);
    this.setQueryParam(searchParams, 'email', schedule.customer.email);
    this.setQueryParam(searchParams, 'vehicleBrand', schedule.customer.vehicleBrand);
    this.setQueryParam(searchParams, 'vehicleModel', schedule.customer.vehicleModel);
    searchParams.set('wofExpiryDate', schedule.dueDate.toISOString().slice(0, 10));

    if (!publicPortalUrl) {
      return `/q?${searchParams.toString()}`;
    }

    try {
      const normalizedPortalUrl = /^https?:\/\//i.test(publicPortalUrl)
        ? publicPortalUrl
        : `https://${publicPortalUrl}`;
      const url = new URL(normalizedPortalUrl);
      if (!url.pathname || url.pathname === '/') {
        url.pathname = '/q';
      }
      for (const [key, value] of searchParams.entries()) {
        url.searchParams.set(key, value);
      }
      return url.toString();
    } catch {
      const base = publicPortalUrl.replace(/\/+$/, '');
      return `${base}/q?${searchParams.toString()}`;
    }
  }

  private buildActionButtonHtml(label: string, href: string) {
    return `
      <a
        href="${href}"
        style="display:inline-block;background:#f4c430;color:#111;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700;"
        target="_blank"
        rel="noopener noreferrer"
      >
        ${label}
      </a>
    `;
  }

  async syncSchedules() {
    const jobs = await this.prisma.job.findMany({
      where: {
        OR: [
          { jobType: JobType.MAINTENANCE },
          { wofExpiryDate: { not: null } },
          { regoExpiryDate: { not: null } },
        ],
      },
      select: {
        id: true,
        customerId: true,
        jobType: true,
        title: true,
        serviceType: true,
        dueDate: true,
        createdAt: true,
        wofExpiryDate: true,
        regoExpiryDate: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const latestMaintenance = new Map<string, SourceJob>();
    const latestWof = new Map<string, SourceJob>();
    const latestRego = new Map<string, SourceJob>();

    for (const job of jobs) {
      if (job.jobType === JobType.MAINTENANCE && !latestMaintenance.has(job.customerId)) {
        latestMaintenance.set(job.customerId, job);
      }
      if (job.wofExpiryDate && !latestWof.has(job.customerId)) {
        latestWof.set(job.customerId, job);
      }
      if (job.regoExpiryDate && !latestRego.has(job.customerId)) {
        latestRego.set(job.customerId, job);
      }
    }

    const upserts: Prisma.PrismaPromise<unknown>[] = [];

    for (const [customerId, job] of latestMaintenance.entries()) {
      const dueDate = this.buildServiceDueDate(job);
      const baseTitle = job.serviceType?.trim() || job.title.trim() || 'Service';
      upserts.push(
        this.prisma.serviceSchedule.upsert({
          where: {
            customerId_type: {
              customerId,
              type: ScheduleType.SERVICE,
            },
          },
          create: {
            customerId,
            type: ScheduleType.SERVICE,
            title: `${baseTitle} due`,
            dueDate,
            sourceJobId: job.id,
          },
          update: {
            title: `${baseTitle} due`,
            dueDate,
            sourceJobId: job.id,
          },
        }),
      );
    }

    for (const [customerId, job] of latestWof.entries()) {
      if (!job.wofExpiryDate) continue;
      upserts.push(
        this.prisma.serviceSchedule.upsert({
          where: {
            customerId_type: {
              customerId,
              type: ScheduleType.WOF,
            },
          },
          create: {
            customerId,
            type: ScheduleType.WOF,
            title: 'WOF due',
            dueDate: job.wofExpiryDate,
            sourceJobId: job.id,
          },
          update: {
            title: 'WOF due',
            dueDate: job.wofExpiryDate,
            sourceJobId: job.id,
          },
        }),
      );
    }

    for (const [customerId, job] of latestRego.entries()) {
      if (!job.regoExpiryDate) continue;
      upserts.push(
        this.prisma.serviceSchedule.upsert({
          where: {
            customerId_type: {
              customerId,
              type: ScheduleType.REGO,
            },
          },
          create: {
            customerId,
            type: ScheduleType.REGO,
            title: 'Rego due',
            dueDate: job.regoExpiryDate,
            sourceJobId: job.id,
          },
          update: {
            title: 'Rego due',
            dueDate: job.regoExpiryDate,
            sourceJobId: job.id,
          },
        }),
      );
    }

    if (upserts.length > 0) {
      await this.prisma.$transaction(upserts);
    }

    return { synced: upserts.length };
  }

  async listSchedules(view: ScheduleView = 'all', daysAheadInput?: number) {
    const daysAhead = this.normalizeDaysAhead(daysAheadInput);
    await this.syncSchedules();

    const schedules = await this.prisma.serviceSchedule.findMany({
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            rego: true,
          },
        },
        sourceJob: {
          select: {
            id: true,
            title: true,
            serviceType: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { type: 'asc' }],
    });

    const todayStart = startOfDay(new Date());
    const counts = { overdue: 0, upcoming: 0, future: 0, total: schedules.length };

    const items = schedules
      .map((schedule) => {
        const bucket = this.getScheduleBucket(schedule.dueDate, daysAhead);
        if (bucket === 'overdue') counts.overdue += 1;
        if (bucket === 'upcoming') counts.upcoming += 1;
        if (bucket === 'future') counts.future += 1;
        const dueStart = startOfDay(schedule.dueDate);
        return {
          id: schedule.id,
          type: schedule.type,
          typeLabel: this.mapTypeLabel(schedule.type),
          title: schedule.title || `${this.mapTypeLabel(schedule.type)} due`,
          dueDate: schedule.dueDate,
          daysUntil: differenceInCalendarDays(dueStart, todayStart),
          bucket,
          lastReminderAt: schedule.lastReminderAt,
          reminderCount: schedule.reminderCount,
          customer: schedule.customer,
          sourceJob: schedule.sourceJob,
        };
      })
      .filter((item) => {
        if (view === 'overdue') return item.bucket === 'overdue';
        if (view === 'upcoming') return item.bucket === 'upcoming';
        return true;
      });

    return {
      daysAhead,
      counts,
      items,
    };
  }

  private getDefaultEmailTemplate(type: ScheduleType) {
    if (type === ScheduleType.WOF) {
      return `
        <div style="font-family:Inter,system-ui,sans-serif;background:#0b0b0b;color:#f9f9f9;padding:20px">
          <table width="100%" style="max-width:640px;margin:0 auto;background:#111;border:1px solid #222;border-radius:12px;padding:20px">
            <tr><td>
              <h2 style="margin:0 0 8px 0;color:#f4c430;">WOF reminder</h2>
              <p style="margin:0 0 10px 0;">Hi {{customerName}},</p>
              <p style="margin:0 0 6px 0;">Your WOF for {{rego}} is {{dueStatus}} (expiry: {{dueDate}}).</p>
              <p style="margin:0 0 16px 0;">Use the button below to book your <strong>Warranty of Fitness (WOF)</strong> with {{businessName}}.</p>
              <div style="margin:0;">{{actionButton}}</div>
            </td></tr>
          </table>
        </div>
      `;
    }
    if (type === ScheduleType.REGO) {
      return `
        <div style="font-family:Inter,system-ui,sans-serif;background:#0b0b0b;color:#f9f9f9;padding:20px">
          <table width="100%" style="max-width:640px;margin:0 auto;background:#111;border:1px solid #222;border-radius:12px;padding:20px">
            <tr><td>
              <h2 style="margin:0 0 8px 0;color:#f4c430;">Registration reminder</h2>
              <p style="margin:0 0 10px 0;">Hi {{customerName}},</p>
              <p style="margin:0 0 6px 0;">Your rego for {{rego}} is {{dueStatus}} (expiry: {{dueDate}}).</p>
              <p style="margin:0 0 16px 0;">Renew your rego online using the button below.</p>
              <div style="margin:0;">{{actionButton}}</div>
            </td></tr>
          </table>
        </div>
      `;
    }
    return `
      <div style="font-family:Inter,system-ui,sans-serif;background:#0b0b0b;color:#f9f9f9;padding:20px">
        <table width="100%" style="max-width:640px;margin:0 auto;background:#111;border:1px solid #222;border-radius:12px;padding:20px">
          <tr><td>
            <h2 style="margin:0 0 8px 0;color:#f4c430;">Service reminder</h2>
            <p style="margin:0 0 10px 0;">Hi {{customerName}},</p>
            <p style="margin:0 0 6px 0;">Your next service for {{rego}} is due on {{dueDate}}.</p>
            <p style="margin:0;">Please contact {{businessName}} to book in.</p>
          </td></tr>
        </table>
      </div>
    `;
  }

  private getDefaultSmsTemplate(type: ScheduleType) {
    if (type === ScheduleType.WOF) {
      return 'Hi {{customerName}}, reminder from {{businessName}}: your WOF for {{rego}} is due on {{dueDate}}. Reply or call to book.';
    }
    if (type === ScheduleType.REGO) {
      return 'Hi {{customerName}}, reminder from {{businessName}}: your rego for {{rego}} is due on {{dueDate}}. Reply or call to book.';
    }
    return 'Hi {{customerName}}, reminder from {{businessName}}: your service for {{rego}} is due on {{dueDate}}. Reply or call to book.';
  }

  private applyTemplate(template: string, tokens: Record<string, string>) {
    return Object.entries(tokens).reduce((output, [key, value]) => {
      const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      return output.replace(pattern, value);
    }, template);
  }

  private buildReminderContent(
    schedule: ScheduleWithRelations,
    settings: ReminderSettings,
    channel: ReminderChannel,
  ) {
    const daysUntilDue = this.getDaysUntilDue(schedule.dueDate);
    const dueStatus = this.describeDueStatus(daysUntilDue);
    const dueDateText = new Date(schedule.dueDate).toLocaleDateString('en-NZ', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const customerName = `${schedule.customer.firstName} ${schedule.customer.lastName}`.trim() || 'Customer';
    const rego = schedule.customer.rego;
    const businessName = settings.businessName?.trim() || 'Carmaster';
    const typeLabel = this.mapTypeLabel(schedule.type);
    const wofBookingUrl = this.buildWofBookingUrl(schedule, settings);
    const regoRenewalUrl = this.regoRenewalUrl;
    const actionButton =
      schedule.type === ScheduleType.WOF
        ? this.buildActionButtonHtml('Book Warranty of Fitness (WOF)', wofBookingUrl)
        : schedule.type === ScheduleType.REGO
          ? this.buildActionButtonHtml('Renew rego', regoRenewalUrl)
          : '';

    const subject = this.buildReminderSubject(schedule.type, rego, daysUntilDue);

    const tokens = {
      customerName,
      rego,
      dueDate: dueDateText,
      daysUntilDue: String(daysUntilDue),
      dueStatus,
      businessName,
      typeLabel,
      title: schedule.title || `${typeLabel} due`,
      actionButton,
      wofBookingUrl,
      regoRenewalUrl,
    };

    if (channel === ReminderChannel.SMS) {
      const template =
        schedule.type === ScheduleType.WOF
          ? settings.wofReminderSmsTemplate || this.getDefaultSmsTemplate(ScheduleType.WOF)
          : schedule.type === ScheduleType.REGO
            ? settings.regoReminderSmsTemplate || this.getDefaultSmsTemplate(ScheduleType.REGO)
            : settings.serviceReminderSmsTemplate || this.getDefaultSmsTemplate(ScheduleType.SERVICE);
      const body = this.applyTemplate(template, tokens).replace(/\s+/g, ' ').trim();
      return { subject, body, html: '' };
    }

    const template =
      schedule.type === ScheduleType.WOF
        ? settings.wofReminderEmailTemplate || this.getDefaultEmailTemplate(ScheduleType.WOF)
        : schedule.type === ScheduleType.REGO
          ? settings.regoReminderEmailTemplate || this.getDefaultEmailTemplate(ScheduleType.REGO)
          : settings.serviceReminderEmailTemplate || this.getDefaultEmailTemplate(ScheduleType.SERVICE);
    let html = this.applyTemplate(template, tokens);
    const actionUrl = schedule.type === ScheduleType.WOF ? wofBookingUrl : schedule.type === ScheduleType.REGO ? regoRenewalUrl : '';
    if (actionButton && actionUrl && !html.includes(actionUrl)) {
      html = `${html}<div style="padding:0 20px 20px 20px;text-align:center;">${actionButton}</div>`;
    }
    return { subject, body: '', html };
  }

  async sendAutomaticRenewalReminders() {
    const today = startOfDay(new Date());
    const todayEnd = endOfDay(today);
    const maxDaysUntilDue = Math.max(...this.renewalReminderDays);
    const maxReminderDate = endOfDay(addDays(today, maxDaysUntilDue));
    await this.syncSchedules();

    const settings = await this.prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: {},
      select: {
        businessName: true,
        bookingsPageUrl: true,
        serviceReminderEmailTemplate: true,
        wofReminderEmailTemplate: true,
        regoReminderEmailTemplate: true,
        serviceReminderSmsTemplate: true,
        wofReminderSmsTemplate: true,
        regoReminderSmsTemplate: true,
      },
    });

    const schedules = await this.prisma.serviceSchedule.findMany({
      where: {
        type: { in: [ScheduleType.WOF, ScheduleType.REGO] },
        dueDate: { gte: today, lte: maxReminderDate },
      },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            rego: true,
            vehicleBrand: true,
            vehicleModel: true,
          },
        },
        sourceJob: {
          select: {
            id: true,
            title: true,
            serviceType: true,
            createdAt: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    const candidates = schedules.filter((schedule) => this.renewalReminderDays.has(this.getDaysUntilDue(schedule.dueDate)));
    const scheduleIds = candidates.map((schedule) => schedule.id);

    const existingSentLogs = scheduleIds.length
      ? await this.prisma.reminderLog.findMany({
          where: {
            scheduleId: { in: scheduleIds },
            channel: ReminderChannel.EMAIL,
            status: ReminderStatus.SENT,
            createdAt: { gte: today, lte: todayEnd },
          },
          select: {
            scheduleId: true,
            subject: true,
          },
        })
      : [];

    const sentTodayKeys = new Set(existingSentLogs.map((entry) => `${entry.scheduleId}::${entry.subject}`));

    let attempted = 0;
    let sent = 0;
    let failed = 0;
    let skippedDuplicates = 0;
    let skippedNoEmail = 0;

    for (const schedule of candidates) {
      const recipient = schedule.customer.email?.trim();
      const { subject, html } = this.buildReminderContent(schedule, settings, ReminderChannel.EMAIL);
      const dedupeKey = `${schedule.id}::${subject}`;
      if (sentTodayKeys.has(dedupeKey)) {
        skippedDuplicates += 1;
        continue;
      }

      attempted += 1;
      let reminderStatus: ReminderStatus = ReminderStatus.SENT;
      let errorMessage: string | null = null;

      if (!recipient) {
        reminderStatus = ReminderStatus.FAILED;
        errorMessage = 'Customer has no email address';
        skippedNoEmail += 1;
      } else {
        const response = (await this.graph.sendMail({
          to: recipient,
          subject,
          html,
        })) as { sent?: boolean; skipped?: boolean; error?: string };
        if (!response?.sent) {
          reminderStatus = ReminderStatus.FAILED;
          errorMessage = response?.skipped
            ? 'Graph sender not configured'
            : response?.error || 'Email send failed';
        }
      }

      if (reminderStatus === ReminderStatus.SENT) {
        sent += 1;
        sentTodayKeys.add(dedupeKey);
        await this.prisma.serviceSchedule.update({
          where: { id: schedule.id },
          data: {
            lastReminderAt: new Date(),
            reminderCount: { increment: 1 },
          },
        });
      } else {
        failed += 1;
      }

      await this.prisma.reminderLog.create({
        data: {
          scheduleId: schedule.id,
          channel: ReminderChannel.EMAIL,
          status: reminderStatus,
          recipient: recipient || 'missing-email',
          subject,
          errorMessage,
        },
      });
    }

    if (sent > 0 || failed > 0) {
      this.logger.log(
        `Automatic renewal reminders processed. sent=${sent} failed=${failed} duplicates=${skippedDuplicates} matched=${candidates.length}`,
      );
    }

    return {
      scheduleTypes: [ScheduleType.WOF, ScheduleType.REGO],
      reminderDays: [...this.renewalReminderDays].sort((a, b) => b - a),
      checked: schedules.length,
      matched: candidates.length,
      attempted,
      sent,
      failed,
      skippedDuplicates,
      skippedNoEmail,
    };
  }

  async sendReminders(dto: SendScheduleRemindersDto) {
    const daysAhead = this.normalizeDaysAhead(dto.daysAhead);
    const today = startOfDay(new Date());
    const upcomingEnd = endOfDay(addDays(today, daysAhead));
    await this.syncSchedules();
    const channels = dto.channels?.length ? dto.channels : [ReminderChannel.EMAIL];

    const settings = await this.prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: {},
      select: {
        businessName: true,
        bookingsPageUrl: true,
        serviceReminderEmailTemplate: true,
        wofReminderEmailTemplate: true,
        regoReminderEmailTemplate: true,
        serviceReminderSmsTemplate: true,
        wofReminderSmsTemplate: true,
        regoReminderSmsTemplate: true,
      },
    });

    const shouldIncludeOverdue = dto.includeOverdue !== false;
    const where: Prisma.ServiceScheduleWhereInput = dto.scheduleIds?.length
      ? { id: { in: dto.scheduleIds } }
      : shouldIncludeOverdue
        ? { dueDate: { lte: upcomingEnd } }
        : { dueDate: { gte: today, lte: upcomingEnd } };

    const schedules = await this.prisma.serviceSchedule.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            rego: true,
            vehicleBrand: true,
            vehicleModel: true,
          },
        },
        sourceJob: {
          select: {
            id: true,
            title: true,
            serviceType: true,
            createdAt: true,
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });

    let attempted = 0;
    let sent = 0;
    let failed = 0;
    const sentByChannel: Record<string, number> = {};
    const failedByChannel: Record<string, number> = {};
    const failedByReason: Record<string, number> = {};
    const failureSamples: Array<{
      scheduleId: string;
      channel: ReminderChannel;
      customerName: string;
      rego: string;
      reason: string;
    }> = [];

    for (const schedule of schedules) {
      for (const channel of channels) {
        attempted += 1;
        const recipient =
          channel === ReminderChannel.EMAIL
            ? schedule.customer.email?.trim()
            : schedule.customer.phone?.trim();
        const { subject, html, body } = this.buildReminderContent(schedule, settings, channel);
        let reminderStatus: ReminderStatus = ReminderStatus.SENT;
        let errorMessage: string | null = null;

        if (!recipient) {
          reminderStatus = ReminderStatus.FAILED;
          errorMessage =
            channel === ReminderChannel.EMAIL
              ? 'Customer has no email address'
              : 'Customer has no phone number';
        } else if (channel === ReminderChannel.EMAIL) {
          const response = (await this.graph.sendMail({
            to: recipient,
            subject,
            html,
          })) as { sent?: boolean; skipped?: boolean; error?: string };
          if (!response?.sent) {
            reminderStatus = ReminderStatus.FAILED;
            errorMessage = response?.skipped
              ? 'Graph sender not configured'
              : response?.error || 'Email send failed';
          }
        } else {
          const response = (await this.sms.sendSms({
            to: recipient,
            body,
          })) as { sent?: boolean; skipped?: boolean; error?: string };
          if (!response?.sent) {
            reminderStatus = ReminderStatus.FAILED;
            errorMessage = response?.skipped
              ? 'Twilio SMS is not configured'
              : response?.error || 'SMS send failed';
          }
        }

        if (reminderStatus === ReminderStatus.SENT) {
          sent += 1;
          sentByChannel[channel] = (sentByChannel[channel] || 0) + 1;
          await this.prisma.serviceSchedule.update({
            where: { id: schedule.id },
            data: {
              lastReminderAt: new Date(),
              reminderCount: { increment: 1 },
            },
          });
        } else {
          failed += 1;
          failedByChannel[channel] = (failedByChannel[channel] || 0) + 1;
          const reason = errorMessage || 'Unknown failure';
          failedByReason[reason] = (failedByReason[reason] || 0) + 1;
          if (failureSamples.length < 5) {
            const customerName =
              `${schedule.customer.firstName} ${schedule.customer.lastName}`.trim() || 'Customer';
            failureSamples.push({
              scheduleId: schedule.id,
              channel,
              customerName,
              rego: schedule.customer.rego,
              reason,
            });
          }
        }

        await this.prisma.reminderLog.create({
          data: {
            scheduleId: schedule.id,
            channel,
            status: reminderStatus,
            recipient: recipient || `missing-${channel.toLowerCase()}`,
            subject,
            errorMessage,
          },
        });
      }
    }

    return {
      attempted,
      sent,
      failed,
      channels,
      sentByChannel,
      failedByChannel,
      failedByReason,
      failureSamples,
      daysAhead,
    };
  }
}
