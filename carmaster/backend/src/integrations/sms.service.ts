import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

interface SendSmsInput {
  to: string;
  body: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  private normalizePhone(value: string) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    return trimmed.replace(/[^\d+]/g, '');
  }

  async sendSms(input: SendSmsInput) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      this.logger.warn('Twilio SMS env vars are not fully configured; skipping SMS send');
      return { skipped: true };
    }

    const to = this.normalizePhone(input.to);
    const from = this.normalizePhone(fromNumber);
    if (!to) {
      return { sent: false, error: 'Invalid recipient phone number' };
    }
    if (!from) {
      return { sent: false, error: 'Invalid sender phone number' };
    }

    try {
      const body = new URLSearchParams({
        To: to,
        From: from,
        Body: input.body,
      });
      await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        body.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          auth: { username: accountSid, password: authToken },
          timeout: 10000,
        },
      );
      return { sent: true };
    } catch (error: any) {
      const providerError =
        error?.response?.data?.message ||
        error?.response?.data?.error_message ||
        error?.message ||
        'SMS send failed';
      this.logger.error('Twilio sendSms failed', error as any);
      return { sent: false, error: providerError };
    }
  }
}

