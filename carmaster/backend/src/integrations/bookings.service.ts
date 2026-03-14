import { Injectable } from '@nestjs/common';
import { GraphService } from './graph.service';

interface AvailabilityInput {
  businessId: string;
  serviceId: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
  slotMinutes: number;
}

interface AppointmentInput {
  businessId: string;
  serviceId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerNotes?: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
  staffMemberIds?: string[];
}

@Injectable()
export class BookingsService {
  constructor(private readonly graph: GraphService) {}

  async listServices(businessId: string) {
    const client = await this.graph.getClient();
    return client.api(`/solutions/bookingBusinesses/${businessId}/services`).get();
  }

  async getService(businessId: string, serviceId: string) {
    const client = await this.graph.getClient();
    return client.api(`/solutions/bookingBusinesses/${businessId}/services/${serviceId}`).get();
  }

  async listStaff(businessId: string) {
    const client = await this.graph.getClient();
    return client.api(`/solutions/bookingBusinesses/${businessId}/staffMembers`).get();
  }

  async getAvailability(input: AvailabilityInput) {
    const client = await this.graph.getClient();
    const service = await this.getService(input.businessId, input.serviceId);
    const serviceStaffIds: string[] = Array.isArray(service?.staffMemberIds) ? service.staffMemberIds : [];
    let staffIds = serviceStaffIds;
    if (staffIds.length === 0) {
      const staff = await this.listStaff(input.businessId);
      staffIds = (staff?.value || []).map((member: any) => member.id).filter((id: string) => id);
    }

    const payload = {
      staffIds,
      startDateTime: { dateTime: input.startDateTime, timeZone: input.timeZone },
      endDateTime: { dateTime: input.endDateTime, timeZone: input.timeZone },
      timeSlotInterval: `PT${input.slotMinutes}M`,
    };

    return client.api(`/solutions/bookingBusinesses/${input.businessId}/getStaffAvailability`).version('beta').post(payload);
  }

  async createAppointment(input: AppointmentInput) {
    const client = await this.graph.getClient();
    const payload: Record<string, unknown> = {
      customerTimeZone: input.timeZone,
      customerName: input.customerName,
      customerEmailAddress: input.customerEmail,
      customerPhone: input.customerPhone,
      customerNotes: input.customerNotes ?? '',
      serviceId: input.serviceId,
      startDateTime: { dateTime: input.startDateTime, timeZone: input.timeZone },
      endDateTime: { dateTime: input.endDateTime, timeZone: input.timeZone },
    };
    if (input.staffMemberIds?.length) {
      payload.staffMemberIds = input.staffMemberIds;
    }
    return client.api(`/solutions/bookingBusinesses/${input.businessId}/appointments`).post(payload);
  }
}
