import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PublicJobDto } from './dto/public-job.dto';
import { BookingsService } from '../integrations/bookings.service';
import { BookingsAvailabilityDto } from './dto/bookings-availability.dto';
import { BookingsAppointmentDto } from './dto/bookings-appointment.dto';
import { DEFAULT_UPSELL_OPTIONS } from '../settings/upsell-defaults';
import { InvoiceInclusionMode, JobType, PriceType, Prisma, VehicleType } from '@prisma/client';
import { getNextInvoiceNumber } from '../invoices/invoice-number.util';

const LEGACY_PWA_BRAND_VALUES = new Set([
  'workshoppro',
  'workshop pro',
  'workshoppro portal',
  'workshop pro portal',
  'carmaster portal',
]);

const normalizePwaLabel = (value: string | null | undefined, fallback: string) => {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  if (LEGACY_PWA_BRAND_VALUES.has(normalized.toLowerCase())) {
    return fallback;
  }
  return normalized;
};

const isWofText = (value?: string | null) => /(?:\bwof\b|warranty of fitness)/i.test(String(value || ''));

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
  ) {}

  private normalizeRego(rego?: string | null) {
    return String(rego || '').trim().toUpperCase();
  }

  private async upsertVehicle(customerId: string, dto: Pick<PublicJobDto, 'rego' | 'vehicleBrand' | 'vehicleModel'>) {
    const rego = this.normalizeRego(dto.rego);
    if (!rego) {
      return null;
    }

    const existing = await this.prisma.vehicle.findFirst({
      where: { rego: { equals: rego, mode: 'insensitive' } },
    });

    if (existing) {
      return this.prisma.vehicle.update({
        where: { id: existing.id },
        data: {
          customerId,
          rego,
          vehicleBrand: dto.vehicleBrand || null,
          vehicleModel: dto.vehicleModel || null,
        },
      });
    }

    return this.prisma.vehicle.create({
      data: {
        customerId,
        rego,
        vehicleBrand: dto.vehicleBrand || null,
        vehicleModel: dto.vehicleModel || null,
      },
    });
  }

  async createOrUpdateCustomer(dto: Pick<PublicJobDto, 'rego' | 'firstName' | 'lastName' | 'phone' | 'email' | 'vehicleBrand' | 'vehicleModel'>) {
    const normalizedRego = this.normalizeRego(dto.rego);
    const existingVehicle = normalizedRego
      ? await this.prisma.vehicle.findFirst({
          where: { rego: { equals: normalizedRego, mode: 'insensitive' } },
          include: { customer: true },
        })
      : null;

    const existingCustomer = existingVehicle?.customer
      ?? await this.prisma.customer.findFirst({
        where: {
          OR: [
            dto.email ? { email: { equals: dto.email, mode: 'insensitive' } } : undefined,
            dto.phone ? { phone: dto.phone } : undefined,
          ].filter(Boolean) as Prisma.CustomerWhereInput[],
        },
      });

    const customer = existingCustomer
      ? await this.prisma.customer.update({
          where: { id: existingCustomer.id },
          data: {
            rego: normalizedRego || existingCustomer.rego,
            vehicleBrand: dto.vehicleBrand || existingCustomer.vehicleBrand,
            vehicleModel: dto.vehicleModel || existingCustomer.vehicleModel,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
            email: dto.email,
          },
        })
      : await this.prisma.customer.create({
          data: {
            rego: normalizedRego || null,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
            email: dto.email,
            vehicleBrand: dto.vehicleBrand || null,
            vehicleModel: dto.vehicleModel || null,
          },
        });

    const vehicle = await this.upsertVehicle(customer.id, dto);
    return { customer, vehicle };
  }

  private async ensureWofService() {
    const existing = await this.prisma.serviceCategory.findFirst({
      where: {
        OR: [
          { name: { equals: 'Warranty of Fitness (WOF)', mode: 'insensitive' } },
          { name: { equals: 'Warranty of Fitness', mode: 'insensitive' } },
          { name: { equals: 'WOF', mode: 'insensitive' } },
          { name: { contains: 'Warranty of Fitness', mode: 'insensitive' } },
          { name: { contains: 'WOF', mode: 'insensitive' } },
        ],
      },
    });
    if (existing) return existing;
    return this.prisma.serviceCategory.create({
      data: {
        name: 'Warranty of Fitness (WOF)',
        description: 'Roadworthy inspection and compliance check',
        checklist: ['Brake inspection', 'Lights and indicators check', 'Tyre and suspension safety check'],
        basePrice: 80,
        priceType: PriceType.FIXED,
        durationMinutes: 45,
        active: true,
      },
    });
  }

  private async getNextJobNumber() {
    const now = new Date();
    const baseDateUtcMs = Date.UTC(2024, 0, 1);
    const currentDateUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const dayIndex = Math.floor((currentDateUtcMs - baseDateUtcMs) / 86_400_000) + 1;
    if (dayIndex < 1 || dayIndex > 9999) {
      throw new BadRequestException('Unable to generate a 6-digit job number for this date');
    }
    const prefix = String(dayIndex).padStart(4, '0');
    const latest = await this.prisma.job.findFirst({
      where: { jobNumber: { startsWith: prefix } },
      orderBy: { jobNumber: 'desc' },
      select: { jobNumber: true },
    });
    const lastSequence =
      latest?.jobNumber && /^\d{6}$/.test(latest.jobNumber) ? Number(latest.jobNumber.slice(4)) : 0;
    if (lastSequence >= 99) {
      throw new BadRequestException('Daily job number limit reached (99). Please contact support.');
    }
    return `${prefix}${String(lastSequence + 1).padStart(2, '0')}`;
  }

  private isJobNumberConflict(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return false;
    }
    const target = (error.meta as { target?: string[] | string } | undefined)?.target;
    if (Array.isArray(target)) {
      return target.some((entry) => String(entry).includes('jobNumber'));
    }
    if (typeof target === 'string') {
      return target.includes('jobNumber');
    }
    return false;
  }

  async previewJobNumber() {
    return { jobNumber: await this.getNextJobNumber() };
  }

  private formatPriceLabel(amount: number, priceType: PriceType) {
    if (priceType === PriceType.QUOTE_REQUIRED) {
      return 'Quote required';
    }
    if (priceType === PriceType.FROM) {
      return `From $${amount.toFixed(2)}`;
    }
    return `$${amount.toFixed(2)}`;
  }

  private buildPricingSnapshot(
    service: any | null,
    additionalServices: any[],
    servicePackage: any | null,
    packagePrice: any | null,
    upsells: any[],
    vehicleType: VehicleType,
  ) {
    const items = [];
    let total = 0;
    let hasEstimate = false;
    let hasQuoteRequired = false;

    if (service) {
      const basePrice = Number(service.basePrice ?? 0);
      if (service.priceType === PriceType.FROM) {
        hasEstimate = true;
        total += basePrice;
      } else if (service.priceType === PriceType.FIXED) {
        total += basePrice;
      } else {
        hasQuoteRequired = true;
      }
      items.push({
        type: 'service',
        id: service.id,
        name: service.name,
        basePrice,
        priceType: service.priceType,
        label: this.formatPriceLabel(basePrice, service.priceType),
      });
    }

    additionalServices.forEach((additionalService) => {
      const basePrice = Number(additionalService.basePrice ?? 0);
      if (additionalService.priceType === PriceType.FROM) {
        hasEstimate = true;
        total += basePrice;
      } else if (additionalService.priceType === PriceType.FIXED) {
        total += basePrice;
      } else {
        hasQuoteRequired = true;
      }
      items.push({
        type: 'additional_service',
        id: additionalService.id,
        name: additionalService.name,
        basePrice,
        priceType: additionalService.priceType,
        label: this.formatPriceLabel(basePrice, additionalService.priceType),
      });
    });

    if (servicePackage && packagePrice) {
      const basePrice = Number(packagePrice.basePrice ?? 0);
      if (packagePrice.priceType === PriceType.FROM) {
        hasEstimate = true;
        total += basePrice;
      } else if (packagePrice.priceType === PriceType.FIXED) {
        total += basePrice;
      } else {
        hasQuoteRequired = true;
      }
      items.push({
        type: 'service_package',
        id: servicePackage.id,
        name: servicePackage.name,
        basePrice,
        vehicleType,
        priceType: packagePrice.priceType,
        notes: packagePrice.notes ?? null,
        label: this.formatPriceLabel(basePrice, packagePrice.priceType),
      });
    }

    upsells.forEach((upsell) => {
      const price = Number(upsell.price ?? 0);
      if (upsell.priceType === PriceType.FROM) {
        hasEstimate = true;
        total += price;
      } else if (upsell.priceType === PriceType.FIXED) {
        total += price;
      } else {
        hasQuoteRequired = true;
      }
      items.push({
        type: 'upsell',
        id: upsell.id,
        name: upsell.name,
        basePrice: price,
        priceType: upsell.priceType,
        label: this.formatPriceLabel(price, upsell.priceType),
      });
    });

    return {
      items,
      estimatedTotal: total,
      hasEstimate,
      hasQuoteRequired,
    };
  }

  private buildPackageInclusionsLines(servicePackage: any | null, mode: InvoiceInclusionMode) {
    if (!servicePackage?.inclusions?.length) {
      return [];
    }
    const ordered = [...servicePackage.inclusions].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    if (mode === InvoiceInclusionMode.LINE_ITEMS) {
      return ordered.map((inclusion: any) => ({
        description: `Inclusion: ${inclusion.title}`,
        quantity: 1,
        unitPrice: 0,
      }));
    }
    const lines = ordered.map((inclusion: any, index: number) => `${index + 1}. ${inclusion.title}`);
    return [
      {
        description: `Inclusions:\n${lines.join('\n')}`,
        quantity: 1,
        unitPrice: 0,
      },
    ];
  }

  private buildInvoiceItems(
    service: any | null,
    additionalServices: any[],
    servicePackage: any | null,
    packagePrice: any | null,
    upsells: any[],
    inclusionMode: InvoiceInclusionMode,
    notes?: string,
    jobNotes?: string,
  ) {
    const items: { description: string; quantity: number; unitPrice: number }[] = [];

    if (service) {
      const basePrice = Number(service.basePrice ?? 0);
      if (service.priceType === PriceType.QUOTE_REQUIRED) {
        items.push({ description: `${service.name} (Quote required)`, quantity: 1, unitPrice: 0 });
      } else if (service.priceType === PriceType.FROM) {
        items.push({ description: `${service.name} (From $${basePrice.toFixed(2)} - estimate)`, quantity: 1, unitPrice: basePrice });
      } else {
        items.push({ description: service.name, quantity: 1, unitPrice: basePrice });
      }
    }

    additionalServices.forEach((additionalService) => {
      const basePrice = Number(additionalService.basePrice ?? 0);
      if (additionalService.priceType === PriceType.QUOTE_REQUIRED) {
        items.push({ description: `${additionalService.name} (Quote required)`, quantity: 1, unitPrice: 0 });
      } else if (additionalService.priceType === PriceType.FROM) {
        items.push({
          description: `${additionalService.name} (From $${basePrice.toFixed(2)} - estimate)`,
          quantity: 1,
          unitPrice: basePrice,
        });
      } else {
        items.push({ description: additionalService.name, quantity: 1, unitPrice: basePrice });
      }
    });

    if (servicePackage && packagePrice) {
      const packageBasePrice = Number(packagePrice.basePrice ?? 0);
      if (packagePrice.priceType === PriceType.QUOTE_REQUIRED) {
        items.push({ description: `Package: ${servicePackage.name} (Quote required)`, quantity: 1, unitPrice: 0 });
      } else if (packagePrice.priceType === PriceType.FROM) {
        items.push({
          description: `Package: ${servicePackage.name} (From $${packageBasePrice.toFixed(2)} - estimate)`,
          quantity: 1,
          unitPrice: packageBasePrice,
        });
      } else {
        items.push({ description: `Package: ${servicePackage.name}`, quantity: 1, unitPrice: packageBasePrice });
      }

      const inclusionLines = this.buildPackageInclusionsLines(servicePackage, inclusionMode);
      items.push(...inclusionLines);
    }

    upsells.forEach((upsell) => {
      const price = Number(upsell.price ?? 0);
      if (upsell.priceType === PriceType.QUOTE_REQUIRED) {
        items.push({ description: `${upsell.name} (Quote required)`, quantity: 1, unitPrice: 0 });
      } else if (upsell.priceType === PriceType.FROM) {
        items.push({ description: `${upsell.name} (From $${price.toFixed(2)} - estimate)`, quantity: 1, unitPrice: price });
      } else {
        items.push({ description: upsell.name, quantity: 1, unitPrice: price });
      }
    });

    if (notes && notes.trim()) {
      items.push({ description: `Customer notes: ${notes.trim()}`, quantity: 1, unitPrice: 0 });
    }

    if (jobNotes && jobNotes.trim()) {
      items.push({ description: `Job details: ${jobNotes.trim()}`, quantity: 1, unitPrice: 0 });
    }

    return items;
  }

  private async createDraftInvoice(
    job: any,
    customerId: string,
    service: any | null,
    additionalServices: any[],
    servicePackage: any | null,
    packagePrice: any | null,
    upsells: any[],
    notes?: string,
  ) {
    const settings = await this.prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: {},
    });
    const inclusionMode = settings.packageInclusionInvoiceMode ?? InvoiceInclusionMode.NOTES;
    const items = this.buildInvoiceItems(
      service,
      additionalServices,
      servicePackage,
      packagePrice,
      upsells,
      inclusionMode,
      notes,
      job?.description,
    );
    const total = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    return this.prisma.$transaction(
      async (tx) => {
        const invoiceNumber = await getNextInvoiceNumber(tx);
        return tx.invoice.create({
          data: {
            invoiceNumber,
            customerId,
            jobId: job.id,
            status: 'DRAFT',
            total,
            items: {
              create: items.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.quantity * item.unitPrice,
              })),
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async createPublicJob(dto: PublicJobDto, fallbackJobType: JobType) {
    const { customer, vehicle } = await this.createOrUpdateCustomer(dto);
    const jobType = dto.jobType ?? fallbackJobType;
    const hasSelectedService = Boolean(dto.selectedServiceId);
    const hasSelectedPackage = Boolean(dto.selectedServicePackageId);
    if ((hasSelectedService && hasSelectedPackage) || (!hasSelectedService && !hasSelectedPackage)) {
      throw new BadRequestException('Select either a single service or a service package');
    }
    const vehicleType = dto.vehicleType ?? VehicleType.JAPANESE;
    const service = dto.selectedServiceId
      ? await this.prisma.serviceCategory.findFirst({
          where: { id: dto.selectedServiceId, active: true },
        })
      : null;
    if (dto.selectedServiceId && !service) {
      throw new BadRequestException('Selected service is invalid');
    }
    const servicePackage = dto.selectedServicePackageId
      ? await this.prisma.servicePackage.findFirst({
          where: { id: dto.selectedServicePackageId, isActive: true },
          include: {
            prices: true,
            inclusions: { orderBy: { sortOrder: 'asc' } },
          },
        })
      : null;
    if (dto.selectedServicePackageId && !servicePackage) {
      throw new BadRequestException('Selected service package is invalid');
    }
    const selectedPackagePrice = servicePackage?.prices.find((price) => price.vehicleType === vehicleType) ?? null;
    if (servicePackage && !selectedPackagePrice) {
      throw new BadRequestException(`No pricing found for ${vehicleType.toLowerCase()} vehicles`);
    }
    const dedupedAdditionalServiceIds = [...new Set(dto.additionalServiceIds || [])]
      .filter(Boolean)
      .filter((serviceId) => serviceId !== service?.id);
    const additionalServices = dedupedAdditionalServiceIds.length
      ? await this.prisma.serviceCategory.findMany({
          where: { id: { in: dedupedAdditionalServiceIds }, active: true },
        })
      : [];
    if (additionalServices.length !== dedupedAdditionalServiceIds.length) {
      throw new BadRequestException('One or more additional services are invalid');
    }
    const upsells = dto.selectedUpsellIds?.length
      ? await this.prisma.upsellOption.findMany({ where: { id: { in: dto.selectedUpsellIds } } })
      : [];
    const additionalServiceNames = additionalServices.map((additionalService) => additionalService.name);
    const primaryServiceName = service?.name || servicePackage?.name || '';
    const detailsParts = [
      dto.notes?.trim() ? `Notes: ${dto.notes.trim()}` : '',
      primaryServiceName ? `Service: ${primaryServiceName}` : '',
      additionalServiceNames.length ? `Additional services: ${additionalServiceNames.join(', ')}` : '',
      servicePackage ? `Service package: ${servicePackage.name}` : '',
      servicePackage ? `Vehicle type: ${vehicleType}` : '',
      dto.selectedUpsellIds?.length ? `Upsells: ${upsells.map((u) => u.name).join(', ')}` : '',
      dto.odometerKm != null ? `Odometer: ${dto.odometerKm} km` : '',
      dto.wofExpiryDate ? `WOF expiry: ${dto.wofExpiryDate}` : '',
      dto.regoExpiryDate ? `Rego expiry: ${dto.regoExpiryDate}` : '',
    ].filter((line) => line);
    let jobNumber = dto.jobNumber || await this.getNextJobNumber();
    const serviceType = [primaryServiceName, ...additionalServiceNames]
      .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
      .join(' + ') || null;
    const pricingSnapshot = this.buildPricingSnapshot(
      service,
      additionalServices,
      servicePackage,
      selectedPackagePrice,
      upsells,
      vehicleType,
    );
    let job: any = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        job = await this.prisma.job.create({
          data: {
            customerId: customer.id,
            vehicleId: vehicle?.id ?? null,
            title: jobType === JobType.MAINTENANCE ? 'Regular Maintenance' : 'Repair Job',
            description: detailsParts.join('\n'),
            serviceType,
            jobType,
            jobNumber,
            odometerKm: dto.odometerKm,
            wofExpiryDate: dto.wofExpiryDate ? new Date(dto.wofExpiryDate) : undefined,
            regoExpiryDate: dto.regoExpiryDate ? new Date(dto.regoExpiryDate) : undefined,
            selectedServiceId: service?.id,
            selectedServicePackageId: servicePackage?.id,
            vehicleType,
            packageBasePriceSnapshot: selectedPackagePrice?.basePrice,
            packageVehicleTypeSnapshot: selectedPackagePrice?.vehicleType,
            packagePriceTypeSnapshot: selectedPackagePrice?.priceType,
            packagePricingNotesSnapshot: selectedPackagePrice?.notes ?? null,
            pricingSnapshot,
            upsells: upsells.length
              ? {
                  create: upsells.map((upsell) => ({
                    upsellId: upsell.id,
                  })),
                }
              : undefined,
          },
        });
        break;
      } catch (error) {
        if (this.isJobNumberConflict(error) && attempt < 2) {
          jobNumber = await this.getNextJobNumber();
          continue;
        }
        throw error;
      }
    }
    if (!job) {
      throw new BadRequestException('Unable to allocate a unique job number. Please try again.');
    }

    await this.createDraftInvoice(
      job,
      customer.id,
      service,
      additionalServices,
      servicePackage,
      selectedPackagePrice,
      upsells,
      dto.notes,
    );
    return job;
  }

  async findCustomerByRego(rego?: string) {
    if (!rego) return null;
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { rego: { equals: rego, mode: 'insensitive' } },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!vehicle) {
      return null;
    }

    const [latestWofRecord, latestRegoRecord] = await Promise.all([
      this.prisma.job.findFirst({
        where: {
          vehicleId: vehicle.id,
          wofExpiryDate: { not: null },
        },
        orderBy: [{ wofExpiryDate: 'desc' }, { createdAt: 'desc' }],
        select: { wofExpiryDate: true },
      }),
      this.prisma.job.findFirst({
        where: {
          vehicleId: vehicle.id,
          regoExpiryDate: { not: null },
        },
        orderBy: [{ regoExpiryDate: 'desc' }, { createdAt: 'desc' }],
        select: { regoExpiryDate: true },
      }),
    ]);

    return {
      rego: vehicle.rego,
      vehicleBrand: vehicle.vehicleBrand,
      vehicleModel: vehicle.vehicleModel,
      firstName: vehicle.customer.firstName,
      lastName: vehicle.customer.lastName,
      phone: vehicle.customer.phone,
      email: vehicle.customer.email,
      wofExpiryDate: latestWofRecord?.wofExpiryDate ?? null,
      regoExpiryDate: latestRegoRecord?.regoExpiryDate ?? null,
    };
  }

  async createRepairJob(dto: PublicJobDto) {
    return this.createPublicJob(dto, JobType.REPAIR);
  }

  private async hasWofServiceSelection(dto: PublicJobDto) {
    if (dto.selectedServiceId) {
      const service = await this.prisma.serviceCategory.findFirst({
        where: { id: dto.selectedServiceId, active: true },
        select: { name: true },
      });
      if (isWofText(service?.name)) {
        return true;
      }
    }

    const additionalServiceIds = [...new Set(dto.additionalServiceIds || [])].filter(Boolean);
    if (additionalServiceIds.length) {
      const additionalServices = await this.prisma.serviceCategory.findMany({
        where: { id: { in: additionalServiceIds }, active: true },
        select: { name: true },
      });
      if (additionalServices.some((service) => isWofText(service.name))) {
        return true;
      }
    }

    if (dto.selectedServicePackageId) {
      const servicePackage = await this.prisma.servicePackage.findFirst({
        where: { id: dto.selectedServicePackageId, isActive: true },
        select: {
          name: true,
          inclusions: {
            select: { title: true },
          },
        },
      });
      if (
        isWofText(servicePackage?.name)
        || (servicePackage?.inclusions || []).some((inclusion) => isWofText(inclusion.title))
      ) {
        return true;
      }
    }

    return false;
  }

  private async createComplianceDatesOnlyUpdate(dto: PublicJobDto) {
    if (!dto.wofExpiryDate || !dto.regoExpiryDate) {
      throw new BadRequestException('WOF and Rego expiry dates are required for compliance-only updates');
    }

    const { customer, vehicle } = await this.createOrUpdateCustomer(dto);
    const detailsParts = [
      'Compliance update only (no WOF booking selected).',
      dto.notes?.trim() ? `Notes: ${dto.notes.trim()}` : '',
      dto.odometerKm != null ? `Odometer: ${dto.odometerKm} km` : '',
      `WOF expiry: ${dto.wofExpiryDate}`,
      `Rego expiry: ${dto.regoExpiryDate}`,
    ].filter((line) => line);

    const job = await this.prisma.job.create({
      data: {
        customerId: customer.id,
        vehicleId: vehicle?.id ?? null,
        title: 'Compliance date update',
        description: detailsParts.join('\n'),
        status: 'COMPLETED',
        jobType: JobType.MAINTENANCE,
        serviceType: 'Compliance update only',
        odometerKm: dto.odometerKm,
        wofExpiryDate: new Date(dto.wofExpiryDate),
        regoExpiryDate: new Date(dto.regoExpiryDate),
      },
    });

    return {
      complianceOnly: true,
      complianceUpdated: true,
      jobId: job.id,
    };
  }

  async createServiceBooking(dto: PublicJobDto) {
    if (dto.requireWofForServiceBooking) {
      const hasWofService = await this.hasWofServiceSelection(dto);
      if (!hasWofService) {
        return this.createComplianceDatesOnlyUpdate(dto);
      }
    }
    return this.createPublicJob(dto, JobType.MAINTENANCE);
  }

  async listServices() {
    await this.ensureWofService();
    return this.prisma.serviceCategory.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' } });
  }

  listServicePackages() {
    return this.prisma.servicePackage.findMany({
      where: { isActive: true },
      include: {
        prices: { orderBy: { vehicleType: 'asc' } },
        inclusions: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async ensureDefaultUpsells() {
    const count = await this.prisma.upsellOption.count();
    if (count > 0) {
      return;
    }
    await this.prisma.upsellOption.createMany({
      data: DEFAULT_UPSELL_OPTIONS.map((option) => ({
        name: option.name,
        price: option.price ?? 0,
        priceType: option.priceType,
        applicabilityRules: option.applicabilityRules ?? undefined,
        isActive: true,
      })),
      skipDuplicates: true,
    });
  }

  async listUpsells() {
    await this.ensureDefaultUpsells();
    return this.prisma.upsellOption.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
  }

  async getPublicConfig() {
    const settings = await this.prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: {},
    });
    const businessName = settings.businessName ?? 'Carmaster';
    return {
      businessName,
      phone: settings.phone ?? null,
      logoUrl: settings.logoUrl ?? null,
      faviconUrl: settings.faviconUrl ?? null,
      pwaName: normalizePwaLabel(settings.pwaName, businessName),
      pwaShortName: normalizePwaLabel(settings.pwaShortName, businessName),
      pwaIconUrl: settings.pwaIconUrl ?? null,
      pwaIconMaskableUrl: settings.pwaIconMaskableUrl ?? null,
      bookingsEnabled: settings.bookingsEnabled ?? false,
      bookingsPageUrl: settings.bookingsPageUrl ?? null,
      bookingsBusinessId: settings.bookingsBusinessId ?? null,
      upsellMileageThreshold: settings.upsellMileageThreshold ?? 60000,
      upsellLastServiceMonths: settings.upsellLastServiceMonths ?? 12,
    };
  }

  async getPublicManifest() {
    const settings = await this.prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: {},
    });
    const businessName = settings.businessName ?? 'Carmaster';
    const name = normalizePwaLabel(settings.pwaName, businessName);
    const shortName = normalizePwaLabel(settings.pwaShortName, businessName);
    const themeColor = settings.themeSecondary ?? '#0a0a0a';
    const backgroundColor = settings.themeSecondary ?? '#0a0a0a';
    const icon192 = settings.pwaIconUrl ?? '/pwa-192.png';
    const icon512 = settings.pwaIconUrl ?? '/pwa-512.png';
    const maskableIcon = settings.pwaIconMaskableUrl ?? icon512;
    return {
      name,
      short_name: shortName,
      theme_color: themeColor,
      background_color: backgroundColor,
      description: `Public QR PWA and staff portal for ${businessName}, powered by Workshop Pro`,
      display: 'standalone',
      start_url: '/q',
      icons: [
        { src: icon192, sizes: '192x192', type: 'image/png' },
        { src: icon512, sizes: '512x512', type: 'image/png' },
        { src: maskableIcon, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    };
  }

  private async getBookingsSettings() {
    const settings = await this.prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: {},
    });
    if (!settings.bookingsEnabled) {
      throw new BadRequestException('Bookings is disabled');
    }
    if (!settings.bookingsBusinessId) {
      throw new BadRequestException('Bookings business ID is not configured');
    }
    return settings;
  }

  async listBookingServices() {
    const settings = await this.getBookingsSettings();
    const response = await this.bookings.listServices(settings.bookingsBusinessId!);
    return response?.value ?? [];
  }

  async getBookingAvailability(dto: BookingsAvailabilityDto) {
    const settings = await this.getBookingsSettings();
    const startTime = dto.startTime || '08:00';
    const endTime = dto.endTime || '17:00';
    const timeZone = dto.timeZone || 'Pacific/Auckland';
    const slotMinutes = dto.slotMinutes || 30;
    const startDateTime = `${dto.date}T${startTime}:00`;
    const endDateTime = `${dto.date}T${endTime}:00`;
    const response = await this.bookings.getAvailability({
      businessId: settings.bookingsBusinessId!,
      serviceId: dto.serviceId,
      startDateTime,
      endDateTime,
      timeZone,
      slotMinutes,
    });
    const slots = (response?.availabilityItems || [])
      .flatMap((item: any) => item?.availabilitySlots || [])
      .filter((slot: any) => slot?.status?.toLowerCase() === 'free')
      .map((slot: any) => ({
        startDateTime: slot?.startDateTime?.dateTime,
        endDateTime: slot?.endDateTime?.dateTime,
      }))
      .filter((slot: any) => slot.startDateTime && slot.endDateTime);
    return { slots };
  }

  async createBookingAppointment(dto: BookingsAppointmentDto) {
    const settings = await this.getBookingsSettings();
    const timeZone = dto.timeZone || 'Pacific/Auckland';
    const service = await this.bookings.getService(settings.bookingsBusinessId!, dto.serviceId);
    const appointment = await this.bookings.createAppointment({
      businessId: settings.bookingsBusinessId!,
      serviceId: dto.serviceId,
      customerName: `${dto.firstName} ${dto.lastName}`.trim(),
      customerEmail: dto.email,
      customerPhone: dto.phone,
      customerNotes: dto.notes,
      startDateTime: dto.startDateTime,
      endDateTime: dto.endDateTime,
      timeZone,
    });

    const { customer, vehicle } = await this.createOrUpdateCustomer({
      rego: dto.rego,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      email: dto.email,
      vehicleBrand: dto.vehicleBrand,
      vehicleModel: dto.vehicleModel,
    });
    const serviceName = service?.displayName || service?.name || 'Booking';
    const details = [
      `Bookings ID: ${appointment?.id || 'n/a'}`,
      `Service: ${serviceName}`,
      `Time: ${dto.startDateTime} - ${dto.endDateTime} (${timeZone})`,
      dto.notes ? `Notes: ${dto.notes}` : '',
    ]
      .filter((line) => line)
      .join('\n');

    const job = await this.prisma.job.create({
      data: {
        customerId: customer.id,
        vehicleId: vehicle?.id ?? null,
        title: 'Bookings Appointment',
        description: details,
        serviceType: serviceName,
        dueDate: new Date(dto.startDateTime),
      },
    });

    return { appointment, job };
  }
}
