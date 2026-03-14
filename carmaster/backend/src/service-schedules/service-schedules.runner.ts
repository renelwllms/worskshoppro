import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ServiceSchedulesService } from './service-schedules.service';

type AutoRenewalRunResult = {
  checked: number;
  matched: number;
  attempted: number;
  sent: number;
  failed: number;
  skippedDuplicates: number;
  skippedNoEmail: number;
  reminderDays: number[];
};

@Injectable()
export class ServiceSchedulesRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServiceSchedulesRunner.name);
  private readonly intervalMs = 60 * 60 * 1000;
  private intervalRef: NodeJS.Timeout | null = null;
  private enabled = false;
  private isRunning = false;
  private lastStartedAt: Date | null = null;
  private lastCompletedAt: Date | null = null;
  private lastSuccessAt: Date | null = null;
  private nextRunAt: Date | null = null;
  private lastError: string | null = null;
  private lastResult: AutoRenewalRunResult | null = null;

  constructor(private readonly schedulesService: ServiceSchedulesService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    this.enabled = true;
    this.nextRunAt = new Date(Date.now() + this.intervalMs);
    void this.runAutomaticRenewalCycle();
    this.intervalRef = setInterval(() => {
      this.nextRunAt = new Date(Date.now() + this.intervalMs);
      void this.runAutomaticRenewalCycle();
    }, this.intervalMs);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private async runAutomaticRenewalCycle() {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.lastStartedAt = new Date();
    try {
      const result = await this.schedulesService.sendAutomaticRenewalReminders();
      this.lastResult = result;
      this.lastSuccessAt = new Date();
      this.lastError = null;
      if (result.sent > 0 || result.failed > 0) {
        this.logger.log(
          `Auto reminder cycle complete. sent=${result.sent}, failed=${result.failed}, matched=${result.matched}`,
        );
      }
    } catch (error) {
      this.lastError = (error as Error)?.message || 'Automatic renewal reminder cycle failed';
      this.logger.error('Automatic renewal reminder cycle failed', error as Error);
    } finally {
      this.lastCompletedAt = new Date();
      this.isRunning = false;
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      isRunning: this.isRunning,
      intervalMinutes: Math.trunc(this.intervalMs / 60000),
      lastStartedAt: this.lastStartedAt,
      lastCompletedAt: this.lastCompletedAt,
      lastSuccessAt: this.lastSuccessAt,
      nextRunAt: this.nextRunAt,
      lastError: this.lastError,
      lastResult: this.lastResult,
    };
  }
}
