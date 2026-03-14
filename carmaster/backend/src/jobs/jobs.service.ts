import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { JobStatus, PriceType, Prisma, VehicleType } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const jobCardDir = join(process.cwd(), 'uploads', 'job-cards');
if (!existsSync(jobCardDir)) mkdirSync(jobCardDir, { recursive: true });

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  private formatPriceLabel(amount: number, priceType: PriceType) {
    if (priceType === PriceType.QUOTE_REQUIRED) return 'Quote required';
    if (priceType === PriceType.FROM) return `From $${amount.toFixed(2)}`;
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
    const items: any[] = [];
    let estimatedTotal = 0;
    let hasEstimate = false;
    let hasQuoteRequired = false;

    const addPricedItem = (basePrice: number, priceType: PriceType) => {
      if (priceType === PriceType.QUOTE_REQUIRED) {
        hasQuoteRequired = true;
        return;
      }
      if (priceType === PriceType.FROM) {
        hasEstimate = true;
      }
      estimatedTotal += basePrice;
    };

    if (service) {
      const basePrice = Number(service.basePrice ?? 0);
      addPricedItem(basePrice, service.priceType);
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
      addPricedItem(basePrice, additionalService.priceType);
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
      addPricedItem(basePrice, packagePrice.priceType);
      items.push({
        type: 'service_package',
        id: servicePackage.id,
        name: servicePackage.name,
        vehicleType,
        basePrice,
        priceType: packagePrice.priceType,
        notes: packagePrice.notes ?? null,
        label: this.formatPriceLabel(basePrice, packagePrice.priceType),
      });
    }

    upsells.forEach((upsell) => {
      const basePrice = Number(upsell.price ?? 0);
      addPricedItem(basePrice, upsell.priceType);
      items.push({
        type: 'upsell',
        id: upsell.id,
        name: upsell.name,
        basePrice,
        priceType: upsell.priceType,
        label: this.formatPriceLabel(basePrice, upsell.priceType),
      });
    });

    return { items, estimatedTotal, hasEstimate, hasQuoteRequired };
  }

  private formatDateValue(value?: Date | null) {
    if (!value) return 'Not set';
    return new Date(value).toLocaleDateString('en-NZ', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  private formatDateTimeValue(value?: Date | null) {
    if (!value) return 'Not set';
    return new Date(value).toLocaleString('en-NZ', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private formatItemTypeLabel(type?: string) {
    if (type === 'service') return 'Service';
    if (type === 'additional_service') return 'Additional service';
    if (type === 'service_package') return 'Service package';
    if (type === 'upsell') return 'Upsell';
    return 'Item';
  }

  private buildJobCardChecklist(job: any) {
    const tasks: string[] = [];
    const seen = new Set<string>();

    const addTask = (task?: string | null) => {
      const normalized = String(task || '').trim();
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      tasks.push(normalized);
    };

    addTask(job?.selectedService?.name ? `Perform service: ${job.selectedService.name}` : null);
    (job?.selectedService?.checklist || []).forEach((item: string) => addTask(item));

    addTask(job?.selectedServicePackage?.name ? `Complete package: ${job.selectedServicePackage.name}` : null);
    (job?.selectedServicePackage?.inclusions || []).forEach((inclusion: any) => addTask(inclusion?.title));

    (job?.upsells || []).forEach((entry: any) => {
      addTask(entry?.upsell?.name ? `Apply upsell: ${entry.upsell.name}` : null);
    });

    const pricingSnapshot = job?.pricingSnapshot as any;
    const pricingItems = Array.isArray(pricingSnapshot?.items) ? pricingSnapshot.items : [];
    pricingItems.forEach((item: any) => {
      if (item?.name) {
        addTask(`${this.formatItemTypeLabel(item.type)}: ${item.name}`);
      }
    });

    if (job?.serviceType) {
      String(job.serviceType)
        .split('+')
        .map((segment: string) => segment.trim())
        .filter(Boolean)
        .forEach((segment: string) => addTask(`Requested: ${segment}`));
    }

    if (!tasks.length) {
      tasks.push('Perform requested service and complete safety checks');
    }

    return tasks;
  }

  private getJobNumberPrefix(date = new Date()) {
    const baseDateUtcMs = Date.UTC(2024, 0, 1);
    const currentDateUtcMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const dayIndex = Math.floor((currentDateUtcMs - baseDateUtcMs) / 86_400_000) + 1;
    if (dayIndex < 1 || dayIndex > 9999) {
      throw new BadRequestException('Unable to generate a 6-digit job number for this date');
    }
    return String(dayIndex).padStart(4, '0');
  }

  private async getNextJobNumber(date = new Date()) {
    const prefix = this.getJobNumberPrefix(date);
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

  async generateJobCardPdf(id: string) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        customer: true,
        selectedService: true,
        selectedServicePackage: {
          include: {
            prices: { orderBy: { vehicleType: 'asc' } },
            inclusions: { orderBy: { sortOrder: 'asc' } },
          },
        },
        upsells: { include: { upsell: true } },
      },
    });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const settings = await this.prisma.setting.findUnique({ where: { id: 1 } });
    const filePath = join(jobCardDir, `${job.id}.pdf`);
    const pdfPath = `/uploads/job-cards/${job.id}.pdf`;
    const doc = new PDFDocument({ margin: 42 });
    const stream = createWriteStream(filePath);
    doc.pipe(stream);

    const businessName = settings?.businessName || 'Workshop Pro';
    const portalLabel = 'Carmaster Portal';
    const margin = doc.page.margins.left;
    const pageWidth = doc.page.width - margin * 2;
    const pageBottom = doc.page.height - margin;
    let y = margin;

    const ensurePageSpace = (requiredHeight: number) => {
      if (y + requiredHeight > pageBottom) {
        doc.addPage();
        y = margin;
      }
    };

    const drawInfoBox = (x: number, boxY: number, width: number, heading: string, lines: string[]) => {
      const lineHeight = 14;
      const boxHeight = Math.max(78, 28 + lines.length * lineHeight);
      doc.roundedRect(x, boxY, width, boxHeight, 6).strokeColor('#d1d5db').lineWidth(1).stroke();
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(heading, x + 10, boxY + 8);
      let lineY = boxY + 24;
      doc.font('Helvetica').fontSize(9).fillColor('#111111');
      lines.forEach((line) => {
        doc.text(line, x + 10, lineY, { width: width - 20 });
        lineY += lineHeight;
      });
      return boxHeight;
    };

    const toMoney = (value: number) => `$${value.toFixed(2)}`;

    doc.font('Helvetica-Bold').fontSize(22).fillColor('#111111').text('Job Card', margin, y);
    doc.font('Helvetica').fontSize(11).fillColor('#4b5563').text(businessName, margin, y + 24);
    doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(portalLabel, margin, y + 38);

    const metaBoxWidth = 230;
    const metaBoxHeight = 92;
    const metaBoxX = doc.page.width - margin - metaBoxWidth;
    doc.roundedRect(metaBoxX, y, metaBoxWidth, metaBoxHeight, 6).fillAndStroke('#f8fafc', '#e5e7eb');
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#111111')
      .text('Job Summary', metaBoxX + 10, y + 10);
    const displayJobNumber =
      job.jobNumber && /^\d{6}$/.test(job.jobNumber) ? job.jobNumber : `${this.getJobNumberPrefix(job.createdAt)}00`;

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#374151')
      .text(`Job #: ${displayJobNumber}`, metaBoxX + 10, y + 28)
      .text(`Status: ${job.status}`, metaBoxX + 10, y + 42)
      .text(`Created: ${this.formatDateTimeValue(job.createdAt)}`, metaBoxX + 10, y + 56)
      .text(`Due: ${this.formatDateValue(job.dueDate)}`, metaBoxX + 10, y + 70);

    y += Math.max(100, metaBoxHeight) + 16;

    const customerName = `${job.customer.firstName || ''} ${job.customer.lastName || ''}`.trim() || 'Not set';
    const vehicle = [job.customer.vehicleBrand, job.customer.vehicleModel].filter(Boolean).join(' ') || 'Not set';
    const vehicleType = job.vehicleType
      ? `${job.vehicleType.slice(0, 1)}${job.vehicleType.slice(1).toLowerCase()}`
      : 'Not set';
    const leftWidth = (pageWidth - 12) / 2;
    const rightX = margin + leftWidth + 12;

    const customerBoxHeight = drawInfoBox(margin, y, leftWidth, 'Customer & Vehicle', [
      `Name: ${customerName}`,
      `Rego: ${job.customer.rego || 'Not set'}`,
      `Vehicle: ${vehicle}`,
      `Vehicle type: ${vehicleType}`,
      `Phone: ${job.customer.phone || 'Not set'}`,
      `Email: ${job.customer.email || 'Not set'}`,
    ]);

    const pricingSnapshot = job.pricingSnapshot as any;
    const estimatedTotal = Number(pricingSnapshot?.estimatedTotal || 0);
    const rightLines = [
      `Job title: ${job.title || 'Untitled job'}`,
      `Service type: ${job.serviceType || 'Not set'}`,
      `Selected service: ${job.selectedService?.name || 'Not set'}`,
      `Selected package: ${job.selectedServicePackage?.name || 'Not set'}`,
      `WOF expiry: ${this.formatDateValue(job.wofExpiryDate)}`,
      `Rego expiry: ${this.formatDateValue(job.regoExpiryDate)}`,
      `Estimated total: ${toMoney(estimatedTotal)}`,
    ];
    const bookingBoxHeight = drawInfoBox(rightX, y, leftWidth, 'Booking Details', rightLines);
    y += Math.max(customerBoxHeight, bookingBoxHeight) + 14;

    const upsells = (job.upsells || [])
      .map((entry) => entry?.upsell?.name)
      .filter(Boolean)
      .join(', ');
    const serviceDescription = [
      job.description?.trim(),
      upsells ? `Upsells: ${upsells}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const normalizedDescription = serviceDescription || 'No booking notes provided.';
    const descriptionHeight = Math.max(58, doc.heightOfString(normalizedDescription, { width: pageWidth - 24 }) + 18);
    ensurePageSpace(descriptionHeight + 28);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111').text('Requested Services / Notes', margin, y);
    y += 14;
    doc.roundedRect(margin, y, pageWidth, descriptionHeight, 6).strokeColor('#d1d5db').stroke();
    doc.font('Helvetica').fontSize(9).fillColor('#111111').text(normalizedDescription, margin + 10, y + 10, {
      width: pageWidth - 20,
    });
    y += descriptionHeight + 16;

    const checklist = this.buildJobCardChecklist(job);
    const tickColWidth = 42;
    const commentColWidth = 190;
    const taskColWidth = pageWidth - tickColWidth - commentColWidth;

    const drawChecklistHeader = (title: string) => {
      ensurePageSpace(36);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111').text(title, margin, y);
      y += 14;
      doc.rect(margin, y, pageWidth, 22).fill('#111827');
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#ffffff')
        .text('Tick', margin + 10, y + 7)
        .text('Task', margin + tickColWidth + 8, y + 7)
        .text('Mechanic Comment', margin + tickColWidth + taskColWidth + 8, y + 7);
      y += 22;
      doc.fillColor('#111111');
    };

    drawChecklistHeader('Mechanic Checklist');
    checklist.forEach((task, index) => {
      const measuredTaskHeight = doc.heightOfString(task, { width: taskColWidth - 16 });
      const rowHeight = Math.max(26, measuredTaskHeight + 10);
      if (y + rowHeight > pageBottom - 12) {
        doc.addPage();
        y = margin;
        drawChecklistHeader('Mechanic Checklist (continued)');
      }

      doc.rect(margin, y, tickColWidth, rowHeight).strokeColor('#d1d5db').stroke();
      doc.rect(margin + tickColWidth, y, taskColWidth, rowHeight).strokeColor('#d1d5db').stroke();
      doc
        .rect(margin + tickColWidth + taskColWidth, y, commentColWidth, rowHeight)
        .strokeColor('#d1d5db')
        .stroke();
      doc.rect(margin + 14, y + Math.max(6, rowHeight / 2 - 6), 12, 12).strokeColor('#111111').lineWidth(1).stroke();
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#111111')
        .text(`${index + 1}. ${task}`, margin + tickColWidth + 8, y + 6, { width: taskColWidth - 16 });
      doc
        .moveTo(margin + tickColWidth + taskColWidth + 6, y + rowHeight - 8)
        .lineTo(margin + pageWidth - 8, y + rowHeight - 8)
        .strokeColor('#9ca3af')
        .lineWidth(0.7)
        .stroke();

      y += rowHeight;
    });

    y += 16;
    ensurePageSpace(180);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111').text('Additional Mechanic Notes', margin, y);
    y += 14;
    const notesRows = 6;
    const notesRowHeight = 22;
    for (let i = 0; i < notesRows; i += 1) {
      doc.rect(margin, y, pageWidth, notesRowHeight).strokeColor('#d1d5db').stroke();
      y += notesRowHeight;
    }

    y += 16;
    const sigLineY = y + 14;
    doc.font('Helvetica').fontSize(9).fillColor('#111111').text('Mechanic name / signature', margin, y);
    doc
      .moveTo(margin, sigLineY)
      .lineTo(margin + pageWidth * 0.62, sigLineY)
      .strokeColor('#111111')
      .lineWidth(0.9)
      .stroke();
    doc.text('Date completed', margin + pageWidth * 0.7, y);
    doc
      .moveTo(margin + pageWidth * 0.7, sigLineY)
      .lineTo(margin + pageWidth, sigLineY)
      .strokeColor('#111111')
      .lineWidth(0.9)
      .stroke();

    doc.end();
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    return { pdfPath, filePath };
  }

  async create(dto: CreateJobDto) {
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : undefined;
    const wofExpiryDate = dto.wofExpiryDate ? new Date(dto.wofExpiryDate) : undefined;
    const regoExpiryDate = dto.regoExpiryDate ? new Date(dto.regoExpiryDate) : undefined;
    if (dto.selectedServiceId && dto.selectedServicePackageId) {
      throw new BadRequestException('A job cannot have both service and service package selected');
    }
    const vehicleType = dto.vehicleType ?? VehicleType.JAPANESE;
    const service = dto.selectedServiceId
      ? await this.prisma.serviceCategory.findUnique({ where: { id: dto.selectedServiceId } })
      : null;
    if (dto.selectedServiceId && !service) {
      throw new NotFoundException('Selected service not found');
    }
    const servicePackage = dto.selectedServicePackageId
      ? await this.prisma.servicePackage.findUnique({
          where: { id: dto.selectedServicePackageId },
          include: { prices: true },
        })
      : null;
    if (dto.selectedServicePackageId && !servicePackage) {
      throw new NotFoundException('Selected service package not found');
    }
    const packagePrice = servicePackage?.prices.find((price) => price.vehicleType === vehicleType) ?? null;
    if (servicePackage && !packagePrice) {
      throw new NotFoundException(`Selected package has no price for ${vehicleType.toLowerCase()} vehicles`);
    }
    const dedupedAdditionalServiceIds = [...new Set(dto.additionalServiceIds || [])]
      .filter(Boolean)
      .filter((serviceId) => serviceId !== service?.id);
    const additionalServices = dedupedAdditionalServiceIds.length
      ? await this.prisma.serviceCategory.findMany({
          where: { id: { in: dedupedAdditionalServiceIds } },
        })
      : [];
    if (additionalServices.length !== dedupedAdditionalServiceIds.length) {
      throw new NotFoundException('One or more additional services were not found');
    }
    const upsells = dto.selectedUpsellIds?.length
      ? await this.prisma.upsellOption.findMany({ where: { id: { in: dto.selectedUpsellIds } } })
      : [];
    const additionalServiceNames = additionalServices.map((additionalService) => additionalService.name);
    const baseServiceType = dto.serviceType || service?.name || servicePackage?.name || null;
    const combinedServiceType = [baseServiceType, ...additionalServiceNames]
      .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
      .join(' + ') || null;
    const descriptionWithAdditionalServices = [
      dto.description?.trim() || '',
      additionalServiceNames.length ? `Additional services: ${additionalServiceNames.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const pricingSnapshot = this.buildPricingSnapshot(
      service,
      additionalServices,
      servicePackage,
      packagePrice,
      upsells,
      vehicleType,
    );
    const createData = {
      title: dto.title,
      description: descriptionWithAdditionalServices || null,
      serviceType: combinedServiceType,
      dueDate,
      wofExpiryDate,
      regoExpiryDate,
      customerId: dto.customerId,
      selectedServiceId: service?.id ?? null,
      selectedServicePackageId: servicePackage?.id ?? null,
      vehicleType,
      packageBasePriceSnapshot: packagePrice?.basePrice,
      packageVehicleTypeSnapshot: packagePrice?.vehicleType,
      packagePriceTypeSnapshot: packagePrice?.priceType,
      packagePricingNotesSnapshot: packagePrice?.notes ?? null,
      pricingSnapshot,
      upsells: upsells.length
        ? {
            create: upsells.map((upsell) => ({
              upsellId: upsell.id,
            })),
          }
        : undefined,
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const jobNumber = await this.getNextJobNumber();
      try {
        return await this.prisma.job.create({
          data: {
            ...createData,
            jobNumber,
          },
          include: {
            customer: true,
            images: true,
            selectedService: true,
            selectedServicePackage: {
              include: {
                prices: { orderBy: { vehicleType: 'asc' } },
                inclusions: { orderBy: { sortOrder: 'asc' } },
              },
            },
            upsells: { include: { upsell: true } },
          },
        });
      } catch (error) {
        if (this.isJobNumberConflict(error) && attempt < 2) {
          continue;
        }
        throw error;
      }
    }

    throw new BadRequestException('Unable to allocate a unique job number. Please try again.');
  }

  findAll(search?: string) {
    const filters: Prisma.JobWhereInput = search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { customer: { rego: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {};
    return this.prisma.job.findMany({
      where: filters,
      include: {
        customer: true,
        images: true,
        selectedService: true,
        selectedServicePackage: true,
        upsells: { include: { upsell: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.job.findUnique({
      where: { id },
      include: {
        customer: true,
        images: true,
        quotes: true,
        invoices: true,
        selectedService: true,
        selectedServicePackage: {
          include: {
            prices: { orderBy: { vehicleType: 'asc' } },
            inclusions: { orderBy: { sortOrder: 'asc' } },
          },
        },
        upsells: { include: { upsell: true } },
      },
    });
  }

  async update(id: string, dto: UpdateJobDto) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (dto.selectedServiceId && dto.selectedServicePackageId) {
      throw new BadRequestException('A job cannot have both service and service package selected');
    }
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : job.dueDate;
    const data: Prisma.JobUpdateInput = {
      title: dto.title,
      description: dto.description,
      serviceType: dto.serviceType,
      dueDate,
      status: dto.status ? (dto.status as JobStatus) : job.status,
    };

    if (dto.selectedServiceId !== undefined) {
      data.selectedService = dto.selectedServiceId
        ? { connect: { id: dto.selectedServiceId } }
        : { disconnect: true };
      if (dto.selectedServiceId) {
        data.selectedServicePackage = { disconnect: true };
      }
    }

    if (dto.selectedServicePackageId !== undefined) {
      data.selectedServicePackage = dto.selectedServicePackageId
        ? { connect: { id: dto.selectedServicePackageId } }
        : { disconnect: true };
      if (dto.selectedServicePackageId) {
        data.selectedService = { disconnect: true };
      }
    }

    if (dto.vehicleType !== undefined) {
      data.vehicleType = dto.vehicleType;
    }

    if (dto.selectedUpsellIds !== undefined) {
      data.upsells = {
        deleteMany: {},
        create: dto.selectedUpsellIds.map((upsellId) => ({ upsellId })),
      };
    }

    return this.prisma.job.update({
      where: { id },
      data,
      include: {
        customer: true,
        images: true,
        selectedService: true,
        selectedServicePackage: true,
        upsells: { include: { upsell: true } },
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.job.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Job not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const jobQuotes = await tx.quote.findMany({
        where: { jobId: id },
        select: { id: true },
      });
      const quoteIds = jobQuotes.map((quote) => quote.id);
      const invoiceWhere: Prisma.InvoiceWhereInput = quoteIds.length
        ? {
            OR: [{ jobId: id }, { quoteId: { in: quoteIds } }],
          }
        : { jobId: id };

      await tx.invoice.deleteMany({
        where: invoiceWhere,
      });

      await tx.quote.deleteMany({
        where: { jobId: id },
      });

      await tx.job.delete({
        where: { id },
      });

      return { deleted: true };
    });
  }

  async addImages(jobId: string, files: Express.Multer.File[]) {
    await this.prisma.jobImage.createMany({
      data: files.map((file) => ({
        jobId,
        url: `/uploads/jobs/${file.filename}`,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      })),
    });
    return this.prisma.jobImage.findMany({ where: { jobId }, orderBy: { createdAt: 'desc' } });
  }

  async dashboardStats() {
    const now = new Date();
    const startCurrent = startOfMonth(now);
    const endCurrent = endOfMonth(now);
    const currentMonthCount = await this.prisma.job.count({
      where: { createdAt: { gte: startCurrent, lte: endCurrent } },
    });

    const monthlyTrend: { month: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const monthStart = startOfMonth(subMonths(now, i));
      const monthEnd = endOfMonth(subMonths(now, i));
      const count = await this.prisma.job.count({
        where: { createdAt: { gte: monthStart, lte: monthEnd } },
      });
      monthlyTrend.push({
        month: monthStart.toLocaleString('en-NZ', { month: 'short' }),
        count,
      });
    }

    const overdue = await this.prisma.job.findMany({
      where: { dueDate: { lt: new Date() }, status: { notIn: [JobStatus.COMPLETED, JobStatus.CANCELLED] } },
      include: { customer: true },
    });

    return { currentMonthCount, monthlyTrend, overdue };
  }
}
