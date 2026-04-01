import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { GraphService } from '../integrations/graph.service';
import PDFDocument from 'pdfkit';
import { existsSync, mkdirSync, createWriteStream, unlinkSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import axios from 'axios';
import { formatInvoiceNumber, getNextInvoiceNumber } from './invoice-number.util';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

const invoiceDir = join(process.cwd(), 'uploads', 'invoices');
if (!existsSync(invoiceDir)) mkdirSync(invoiceDir, { recursive: true });

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
    private readonly configService: ConfigService,
  ) {}

  private buildPublicPdfToken(input: {
    id: string;
    customerEmail?: string | null;
    total?: Prisma.Decimal | number | string | null;
    pdfPath?: string | null;
  }) {
    const secret = this.configService.get<string>('JWT_SECRET') || 'dev-secret';
    return createHmac('sha256', secret)
      .update([
        input.id,
        input.customerEmail || '',
        String(input.total ?? ''),
        input.pdfPath || '',
      ].join(':'))
      .digest('hex');
  }

  private buildPublicPdfUrl(input: {
    id: string;
    customerEmail?: string | null;
    total?: Prisma.Decimal | number | string | null;
    pdfPath?: string | null;
  }) {
    const publicUrl = (this.configService.get<string>('PUBLIC_PORTAL_URL') || '').replace(/\/$/, '');
    const token = this.buildPublicPdfToken(input);
    const path = `/api/public/invoices/${input.id}/pdf?token=${token}`;
    return publicUrl ? `${publicUrl}${path}` : path;
  }

  private getInvoiceInclude() {
    return {
      items: true,
      customer: true,
      job: {
        include: {
          customer: true,
          vehicle: true,
          selectedService: true,
          selectedServicePackage: true,
          upsells: { include: { upsell: true } },
        },
      },
      invoiceJobs: {
        include: {
          job: {
            include: {
              customer: true,
              vehicle: true,
              selectedService: true,
              selectedServicePackage: true,
              upsells: { include: { upsell: true } },
            },
          },
        },
      },
    } as const;
  }

  private getRequestedJobIds(input: { jobId?: string; jobIds?: string[] }) {
    const ordered = [
      ...(Array.isArray(input.jobIds) ? input.jobIds : []),
      ...(input.jobId ? [input.jobId] : []),
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean);

    return ordered.filter((value, index) => ordered.indexOf(value) === index);
  }

  private async resolveInvoiceJobs(client: any, requestedJobIds: string[]) {
    if (!requestedJobIds.length) {
      return [];
    }

    const jobs = await client.job.findMany({
      where: { id: { in: requestedJobIds } },
      include: {
        customer: true,
        vehicle: true,
        selectedService: true,
        selectedServicePackage: true,
        upsells: { include: { upsell: true } },
      },
    });
    const jobsById = new Map(jobs.map((job: any) => [job.id, job]));
    const orderedJobs = requestedJobIds
      .map((jobId) => jobsById.get(jobId))
      .filter(Boolean);

    if (orderedJobs.length !== requestedJobIds.length) {
      throw new NotFoundException('One or more selected jobs were not found');
    }

    const customerIds = [...new Set(orderedJobs.map((job: any) => job.customerId))];
    if (customerIds.length > 1) {
      throw new BadRequestException('All selected jobs must belong to the same customer');
    }

    return orderedJobs;
  }

  private getInvoiceAssociatedJobs(invoice: any) {
    const linkedJobs = Array.isArray(invoice?.invoiceJobs)
      ? invoice.invoiceJobs.map((entry: any) => entry?.job).filter(Boolean)
      : [];

    if (linkedJobs.length > 0) {
      const seen = new Set<string>();
      return linkedJobs.filter((job: any) => {
        if (!job?.id || seen.has(job.id)) {
          return false;
        }
        seen.add(job.id);
        return true;
      });
    }

    return invoice?.job ? [invoice.job] : [];
  }

  private getInvoiceJobSummary(invoice: any) {
    const jobs = this.getInvoiceAssociatedJobs(invoice);
    if (!jobs.length) {
      return 'your service';
    }
    if (jobs.length === 1) {
      return jobs[0]?.title || jobs[0]?.selectedService?.name || jobs[0]?.selectedServicePackage?.name || 'your service';
    }

    const firstLabel = jobs[0]?.title || jobs[0]?.selectedService?.name || jobs[0]?.selectedServicePackage?.name || 'service';
    return `${firstLabel} + ${jobs.length - 1} more job${jobs.length === 2 ? '' : 's'}`;
  }

  private formatJobInvoiceItemLabel(type?: string) {
    if (type === 'service') return 'Service';
    if (type === 'additional_service') return 'Additional service';
    if (type === 'service_package') return 'Service package';
    if (type === 'upsell') return 'Upsell';
    return 'Service';
  }

  private buildJobHeading(job: any) {
    const title = job?.title || job?.selectedService?.name || job?.selectedServicePackage?.name || 'Booked job';
    return job?.jobNumber ? `${title} (#${job.jobNumber})` : title;
  }

  private buildInvoiceItemsFromJob(job: any) {
    const pricingSnapshot = job?.pricingSnapshot as any;
    const pricingItems = Array.isArray(pricingSnapshot?.items) ? pricingSnapshot.items : [];
    const jobHeading = this.buildJobHeading(job);

    if (pricingItems.length > 0) {
      return pricingItems.map((item: any) => {
        const descriptionParts = [`Job: ${jobHeading}`, `${this.formatJobInvoiceItemLabel(item?.type)}: ${item?.name || 'Booked service'}`];
        if (item?.vehicleType) {
          descriptionParts.push(`Vehicle type: ${String(item.vehicleType).toLowerCase()}`);
        }
        if (item?.notes) {
          descriptionParts.push(String(item.notes));
        }
        if (item?.priceType === 'QUOTE_REQUIRED') {
          descriptionParts.push('Final price to be confirmed.');
        }
        return {
          description: descriptionParts.join('\n'),
          quantity: 1,
          unitPrice: Number(item?.basePrice ?? 0),
        };
      });
    }

    const fallbackItems = [
      job?.selectedService?.name
        ? {
            description: `Job: ${jobHeading}\nService: ${job.selectedService.name}`,
            quantity: 1,
            unitPrice: 0,
          }
        : null,
      job?.selectedServicePackage?.name
        ? {
            description: `Job: ${jobHeading}\nService package: ${job.selectedServicePackage.name}`,
            quantity: 1,
            unitPrice: Number(job?.packageBasePriceSnapshot ?? 0),
          }
        : null,
      ...(job?.upsells || []).map((entry: any) => ({
        description: `Job: ${jobHeading}\nUpsell: ${entry?.upsell?.name || 'Additional item'}`,
        quantity: 1,
        unitPrice: Number(entry?.upsell?.price ?? 0),
      })),
    ].filter(Boolean);

    if (fallbackItems.length > 0) {
      return fallbackItems;
    }

    return [
      {
        description: `Job: ${jobHeading}`,
        quantity: 1,
        unitPrice: 0,
      },
    ];
  }

  private buildInvoiceItemsFromJobs(jobs: any[]) {
    return jobs.flatMap((job) => this.buildInvoiceItemsFromJob(job));
  }

  private buildInvoiceJobDetailBlocks(invoice: any) {
    return this.getInvoiceAssociatedJobs(invoice)
      .map((job: any) => {
        const jobVehicle = job?.vehicle ?? job?.customer;
        const vehicle = [jobVehicle?.vehicleBrand, jobVehicle?.vehicleModel].filter(Boolean).join(' ');
        return {
          title: this.buildJobHeading(job),
          lines: [
            job?.selectedService?.name ? `Service booked: ${job.selectedService.name}` : '',
            job?.selectedServicePackage?.name ? `Package booked: ${job.selectedServicePackage.name}` : '',
            jobVehicle?.rego ? `Rego: ${jobVehicle.rego}` : '',
            vehicle ? `Vehicle: ${vehicle}` : '',
          ].filter(Boolean),
        };
      })
      .filter((block: any) => block.title || block.lines.length);
  }

  async create(dto: CreateInvoiceDto) {
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : undefined;
    return this.prisma.$transaction(
      async (tx) => {
        const quote = dto.quoteId
          ? await tx.quote.findUnique({
              where: { id: dto.quoteId },
              include: {
                items: true,
                customer: true,
                job: {
                  include: {
                    customer: true,
                    vehicle: true,
                  },
                },
              },
            })
          : null;

        if (dto.quoteId && !quote) {
          throw new NotFoundException('Quote not found');
        }

        const requestedJobIds = this.getRequestedJobIds(dto);
        if (quote?.jobId && requestedJobIds.length > 0 && !requestedJobIds.includes(quote.jobId)) {
          throw new BadRequestException('Selected quote belongs to a different job');
        }

        const jobs: any[] = await this.resolveInvoiceJobs(tx, requestedJobIds.length ? requestedJobIds : quote?.jobId ? [quote.jobId] : []);

        if (jobs.length && dto.customerId && dto.customerId !== jobs[0].customerId) {
          throw new BadRequestException('Selected job belongs to a different customer');
        }
        if (quote?.customerId && dto.customerId && dto.customerId !== quote.customerId) {
          throw new BadRequestException('Selected quote belongs to a different customer');
        }
        const invoiceItems: Array<{ description: string; quantity: number; unitPrice: number }> =
          dto.items?.length
            ? dto.items
            : quote?.items?.length
              ? quote.items.map((item: any) => ({
                  description: item.description,
                  quantity: item.quantity,
                  unitPrice: Number(item.unitPrice),
                }))
              : jobs.length
                ? this.buildInvoiceItemsFromJobs(jobs)
                : [];
        if (!invoiceItems.length) {
          throw new BadRequestException('Add at least one invoice item or select a booked job');
        }
        const total = invoiceItems.reduce((sum: number, item) => sum + item.quantity * item.unitPrice, 0);
        const invoiceNumber = await getNextInvoiceNumber(tx);
        return tx.invoice.create({
          data: {
            invoiceNumber,
            quoteId: quote?.id,
            customerId: quote?.customerId ?? jobs[0]?.customerId ?? dto.customerId,
            jobId: jobs[0]?.id ?? quote?.jobId ?? null,
            dueDate,
            total,
            invoiceJobs: jobs.length
              ? {
                  create: jobs.map((job: any) => ({
                    jobId: job.id,
                  })),
                }
              : undefined,
            items: {
              create: invoiceItems.map((item: { description: string; quantity: number; unitPrice: number }) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.quantity * item.unitPrice,
              })),
            },
          },
          include: this.getInvoiceInclude(),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  findAll() {
    return this.prisma.invoice.findMany({
      include: this.getInvoiceInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.invoice.findUnique({
      where: { id },
      include: this.getInvoiceInclude(),
    });
  }

  async remove(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: {
        id: true,
        pdfPath: true,
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    await this.prisma.invoice.delete({
      where: { id },
    });

    if (invoice.pdfPath) {
      const pdfAbsolutePath = join(process.cwd(), invoice.pdfPath.replace(/^\//, ''));
      if (existsSync(pdfAbsolutePath)) {
        try {
          unlinkSync(pdfAbsolutePath);
        } catch {
          // PDF cleanup should not block invoice deletion.
        }
      }
    }

    return { success: true };
  }

  async update(id: string, dto: UpdateInvoiceDto) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const requestedJobIds = dto.jobIds !== undefined || dto.jobId !== undefined
      ? this.getRequestedJobIds(dto)
      : undefined;
    const jobs: any[] | null = requestedJobIds !== undefined
      ? await this.resolveInvoiceJobs(this.prisma, requestedJobIds)
      : null;

    if (jobs && jobs.length && dto.customerId && dto.customerId !== jobs[0].customerId) {
      throw new BadRequestException('Selected job belongs to a different customer');
    }

    const dueDate = dto.dueDate ? new Date(dto.dueDate) : invoice.dueDate;
    const effectiveItems = dto.items
      ? dto.items
      : jobs
        ? this.buildInvoiceItemsFromJobs(jobs)
        : null;
    const total = effectiveItems
      ? effectiveItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
      : invoice.total;
    const data: any = {
      dueDate,
      total,
    };
    if (dto.status) data.status = dto.status;
    if (jobs) {
      data.customerId = jobs[0]?.customerId ?? dto.customerId ?? invoice.customerId;
      data.jobId = jobs[0]?.id ?? null;
      data.invoiceJobs = {
        deleteMany: {},
        create: jobs.map((job: any) => ({
          jobId: job.id,
        })),
      };
    } else if (dto.customerId) {
      data.customerId = dto.customerId;
    }
    return this.prisma.invoice.update({
      where: { id },
      data: {
        ...data,
        items: effectiveItems
          ? {
              deleteMany: {},
              create: effectiveItems.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.quantity * item.unitPrice,
              })),
            }
          : undefined,
      },
      include: this.getInvoiceInclude(),
    });
  }

  async generatePdf(id: string, payload?: { notes?: string; terms?: string; subject?: string; taxRate?: number }) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: this.getInvoiceInclude(),
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const settings = await this.prisma.setting.findUnique({ where: { id: 1 } });
    const filePath = join(invoiceDir, `${invoice.id}.pdf`);
    const pdfPath = `/uploads/invoices/${invoice.id}.pdf`;
    const doc = new PDFDocument({ margin: 50 });
    const stream = createWriteStream(filePath);
    doc.pipe(stream);
    const businessName = settings?.businessName || 'Carmaster';
    const address = settings?.address;
    const phone = settings?.phone;
    const gstNumber = settings?.gstNumber;
    const bankDetails = settings?.bankDetails?.trim();
    const logoUrl = settings?.logoUrl;
    const taxRate = Number(payload?.taxRate ?? settings?.taxRate) || 0;
    const subtotal = invoice.items.reduce((sum, item) => sum + Number(item.total), 0);
    const taxAmount = (subtotal * taxRate) / 100;
    const totalWithTax = subtotal + taxAmount;

    const money = (value: number) => `$${value.toFixed(2)}`;
    const formatDate = (value?: Date | null) =>
      value ? new Date(value).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

    let logoBuffer: Buffer | null = null;
    if (logoUrl) {
      try {
        const response = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 5000 });
        logoBuffer = Buffer.from(response.data);
      } catch {
        logoBuffer = null;
      }
    }

    const margin = doc.page.margins.left;
    const pageWidth = doc.page.width - margin * 2;
    const footerText = 'Invoice generated using WorkshopPro by Edgepoint.';
    const drawFooter = () => {
      const footerLineY = doc.page.height - doc.page.margins.bottom - 20;
      const footerTextY = footerLineY + 6;
      doc
        .strokeColor('#e5e7eb')
        .moveTo(margin, footerLineY)
        .lineTo(margin + pageWidth, footerLineY)
        .stroke();
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#6b7280')
        .text(footerText, margin, footerTextY, { width: pageWidth, align: 'center' });
    };
    doc.on('pageAdded', drawFooter);
    drawFooter();
    let y = margin;

    const headerX = margin;
    const headerY = y;
    const logoSize = 60;
    let logoDrawn = false;
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, headerX, headerY, { fit: [logoSize, logoSize] });
        logoDrawn = true;
      } catch {
        logoDrawn = false;
      }
    }

    const detailLines = [];
    if (address) detailLines.push(address);
    if (phone) detailLines.push(`Phone: ${phone}`);
    if (gstNumber) detailLines.push(`GST: ${gstNumber}`);
    const detailText = detailLines.join('\n');

    const nameY = logoDrawn ? headerY + logoSize + 8 : headerY;
    doc.font('Helvetica-Bold').fillColor('#111111').fontSize(20).text(businessName, headerX, nameY);
    const nameHeight = doc.heightOfString(businessName, { width: pageWidth * 0.6 });
    if (detailText) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#5a5a5a')
        .text(detailText, headerX, nameY + nameHeight + 4);
    }

    const metaBoxWidth = 210;
    const metaBoxHeight = 88;
    const metaBoxX = doc.page.width - margin - metaBoxWidth;
    const metaBoxY = headerY;
    doc.roundedRect(metaBoxX, metaBoxY, metaBoxWidth, metaBoxHeight, 6).fillAndStroke('#f5f5f5', '#e2e2e2');
    doc
      .fillColor('#111111')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text('INVOICE', metaBoxX + 12, metaBoxY + 10);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#333333')
      .text(`Invoice # ${formatInvoiceNumber(invoice.invoiceNumber, invoice.id)}`, metaBoxX + 12, metaBoxY + 32)
      .text(`Status: ${invoice.status}`, metaBoxX + 12, metaBoxY + 46)
      .text(`Date: ${formatDate(invoice.createdAt)}`, metaBoxX + 12, metaBoxY + 60)
      .text(`Due: ${formatDate(invoice.dueDate)}`, metaBoxX + 12, metaBoxY + 74);

    const leftBlockHeight = (logoDrawn ? logoSize + 8 : 0) + nameHeight + (detailText ? 14 + doc.heightOfString(detailText, { width: pageWidth * 0.6 }) : 0);
    const headerHeight = Math.max(leftBlockHeight, metaBoxHeight);
    y = headerY + headerHeight + 24;

    const sectionTitleColor = '#0f172a';
    const labelColor = '#6b7280';

    doc.font('Helvetica-Bold').fontSize(11).fillColor(sectionTitleColor).text('Bill To', margin, y);
    doc.font('Helvetica').fontSize(10).fillColor('#111111');
    doc.text(`${invoice.customer.firstName} ${invoice.customer.lastName}`, margin, y + 16);
    doc.fillColor(labelColor).text(invoice.customer.email || '-', margin, y + 32);
    doc.fillColor(labelColor).text(invoice.customer.phone || '-', margin, y + 46);

    y += 72;
    doc.moveTo(margin, y).lineTo(margin + pageWidth, y).strokeColor('#e5e7eb').stroke();
    y += 16;

    const tableHeaderHeight = 22;
    const colGap = 8;
    const qtyWidth = 45;
    const unitWidth = 70;
    const totalWidth = 80;
    const descWidth = pageWidth - qtyWidth - unitWidth - totalWidth - colGap * 3;
    const colX = {
      desc: margin,
      qty: margin + descWidth + colGap,
      unit: margin + descWidth + colGap + qtyWidth + colGap,
      total: margin + descWidth + colGap + qtyWidth + colGap + unitWidth + colGap,
    };

    let tableStarted = false;
    const ensurePageSpace = (neededHeight: number) => {
      const bottomLimit = doc.page.height - margin - 140;
      if (y + neededHeight > bottomLimit) {
        doc.addPage();
        y = margin;
        if (tableStarted) {
          drawTableHeader();
        }
      }
    };

    const drawTableHeader = () => {
      tableStarted = true;
      doc.rect(margin, y, pageWidth, tableHeaderHeight).fill('#111827');
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#ffffff')
        .text('Description', colX.desc + 6, y + 6)
        .text('Qty', colX.qty, y + 6, { width: qtyWidth, align: 'right' })
        .text('Unit', colX.unit, y + 6, { width: unitWidth, align: 'right' })
        .text('Total', colX.total, y + 6, { width: totalWidth, align: 'right' });
      y += tableHeaderHeight;
      doc.fillColor('#111111').font('Helvetica').fontSize(10);
    };

    const jobDetailBlocks = this.buildInvoiceJobDetailBlocks(invoice);
    if (jobDetailBlocks.length > 0) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(sectionTitleColor).text('Job Details', margin, y);
      y += 16;
      jobDetailBlocks.forEach((block: any, index: number) => {
        const blockText = block.lines.join('\n');
        const blockHeight = Math.max(
          doc.heightOfString(block.title, { width: pageWidth }),
          doc.heightOfString(blockText || '-', { width: pageWidth }),
        );
        ensurePageSpace(blockHeight + 12);
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111').text(block.title, margin, y, { width: pageWidth });
        if (blockText) {
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#4b5563')
            .text(blockText, margin, y + 14, { width: pageWidth });
        }
        y += blockHeight + 10 + (index === jobDetailBlocks.length - 1 ? 0 : 6);
      });
      y += 6;
    }

    drawTableHeader();

    invoice.items.forEach((item) => {
      const description = item.description || '-';
      const descHeight = doc.heightOfString(description, { width: descWidth - 10 });
      const rowHeight = Math.max(18, descHeight + 8);
      ensurePageSpace(rowHeight + 10);

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#111111')
        .text(description, colX.desc + 6, y + 6, { width: descWidth - 10 });
      doc
        .fillColor('#111111')
        .text(String(item.quantity), colX.qty, y + 6, { width: qtyWidth, align: 'right' });
      doc.text(money(Number(item.unitPrice)), colX.unit, y + 6, { width: unitWidth, align: 'right' });
      doc.text(money(Number(item.total)), colX.total, y + 6, { width: totalWidth, align: 'right' });
      doc.moveTo(margin, y + rowHeight).lineTo(margin + pageWidth, y + rowHeight).strokeColor('#e5e7eb').stroke();
      y += rowHeight;
    });

    y += 16;
    const totalsBoxTop = y;
    const totalsBoxWidth = 220;
    const totalsX = doc.page.width - margin - totalsBoxWidth;
    const totalsRows = taxRate > 0 ? 3 : 2;
    const totalsHeight = 18 * totalsRows + 20;
    doc.roundedRect(totalsX, totalsBoxTop, totalsBoxWidth, totalsHeight, 6).fillAndStroke('#f9fafb', '#e5e7eb');
    let totalsY = totalsBoxTop + 10;
    doc.font('Helvetica').fontSize(10).fillColor('#374151');
    doc.text('Subtotal', totalsX + 12, totalsY);
    doc.text(money(subtotal), totalsX, totalsY, { width: totalsBoxWidth - 12, align: 'right' });
    totalsY += 18;
    if (taxRate > 0) {
      doc.text(`Tax (${taxRate.toFixed(2)}%)`, totalsX + 12, totalsY);
      doc.text(money(taxAmount), totalsX, totalsY, { width: totalsBoxWidth - 12, align: 'right' });
      totalsY += 18;
    }
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111');
    doc.text('Total', totalsX + 12, totalsY);
    doc.text(money(totalWithTax), totalsX, totalsY, { width: totalsBoxWidth - 12, align: 'right' });

    const notesWidth = Math.max(200, pageWidth - totalsBoxWidth - 20);
    const notesX = margin;
    let sideColumnBottom = totalsBoxTop;
    if (payload?.notes) {
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(sectionTitleColor)
        .text('Notes', notesX, totalsBoxTop);
      const notesTextHeight = doc.heightOfString(payload.notes, { width: notesWidth });
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#4b5563')
        .text(payload.notes, notesX, totalsBoxTop + 14, { width: notesWidth });
      sideColumnBottom = totalsBoxTop + 14 + notesTextHeight;
    }

    if (bankDetails) {
      const bankBoxY = sideColumnBottom > totalsBoxTop ? sideColumnBottom + 16 : totalsBoxTop;
      const bankDetailsTextY = bankBoxY + 14;
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(sectionTitleColor)
        .text('Bank Details', notesX, bankBoxY);
      const bankTextHeight = doc.heightOfString(bankDetails, { width: notesWidth });
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#4b5563')
        .text(bankDetails, notesX, bankDetailsTextY, { width: notesWidth });
      sideColumnBottom = bankDetailsTextY + bankTextHeight;
    }

    y = Math.max(totalsBoxTop + totalsHeight + 10, sideColumnBottom + 24);
    if (payload?.terms) {
      ensurePageSpace(80);
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(sectionTitleColor)
        .text('Terms & Conditions', margin, y);
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#6b7280')
        .text(payload.terms, margin, y + 14, { width: pageWidth });
      y += doc.heightOfString(payload.terms, { width: pageWidth }) + 24;
    }

    doc.end();
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
    await this.prisma.invoice.update({ where: { id }, data: { pdfPath: `/uploads/invoices/${invoice.id}.pdf` } });
    return { pdfPath, filePath };
  }

  async sendEmail(id: string) {
    let invoice = await this.findOne(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'DRAFT') {
      invoice = await this.prisma.invoice.update({
        where: { id },
        data: { status: 'SENT' },
        include: this.getInvoiceInclude(),
      });
    }
    const pdf = await this.generatePdf(id);
    const link = this.buildPublicPdfUrl({
      id: invoice.id,
      customerEmail: invoice.customer.email,
      total: invoice.total,
      pdfPath: pdf.pdfPath,
    });
    const settings = await this.prisma.setting.findUnique({ where: { id: 1 } });
    const taxRate = Number(settings?.taxRate) || 0;
    const subtotal = invoice.items.reduce((sum, item) => sum + Number(item.total), 0);
    const taxAmount = (subtotal * taxRate) / 100;
    const totalWithTax = subtotal + taxAmount;
    const money = (value: number) => `$${value.toFixed(2)}`;
    const attachmentBytes = await readFile(pdf.filePath, { encoding: 'base64' });
    const invoiceJobSummary = this.getInvoiceJobSummary(invoice);
    const defaultHtml = `
        <div style="font-family:Inter,system-ui,sans-serif;background:#0b0b0b;color:#f9f9f9;padding:20px">
          <table width="100%" style="max-width:640px;margin:0 auto;background:#111;border:1px solid #222;border-radius:12px;padding:20px">
            <tr><td>
              <h2 style="margin:0 0 8px 0;color:#f4c430;">Your Carmaster Invoice</h2>
              <p style="margin:0 0 12px 0;">Hi ${invoice.customer.firstName}, your invoice is ready for ${invoiceJobSummary}.</p>
              <p style="margin:0 0 6px 0;">Subtotal: <strong>${money(subtotal)}</strong></p>
              ${taxRate > 0 ? `<p style="margin:0 0 6px 0;">GST (${taxRate.toFixed(2)}%): <strong>${money(taxAmount)}</strong></p>` : ''}
              <p style="margin:0 0 12px 0;">Total: <strong>${money(totalWithTax)}</strong></p>
              <p style="font-size:12px;color:#aaa;margin-top:12px;">Your invoice PDF is attached to this email. For questions call or reply to this email.</p>
            </td></tr>
          </table>
        </div>
      `;
    const html = settings?.invoiceEmailTemplate
      ? this.renderTemplate(settings.invoiceEmailTemplate, {
          customerName: `${invoice.customer.firstName} ${invoice.customer.lastName}`.trim(),
          jobTitle: invoiceJobSummary,
          total: money(totalWithTax),
          subtotal: money(subtotal),
          taxRate: taxRate.toFixed(2),
          taxAmount: money(taxAmount),
          totalWithTax: money(totalWithTax),
          invoiceLink: link,
          bankDetails: settings?.bankDetails?.trim() || '',
        })
      : defaultHtml;
    const mailResult = await this.graph.sendMail({
      to: invoice.customer.email,
      subject: `Invoice for ${invoiceJobSummary}`,
      html,
      attachments: [
        {
          name: `invoice-${formatInvoiceNumber(invoice.invoiceNumber, invoice.id)}.pdf`,
          contentType: 'application/pdf',
          contentBytes: attachmentBytes,
        },
      ],
    });
    if ('skipped' in mailResult && mailResult.skipped) {
      throw new BadRequestException('Email sender is not configured');
    }
    if ('sent' in mailResult && !mailResult.sent) {
      throw new InternalServerErrorException(mailResult.error || 'Unable to send invoice email');
    }
    return { sent: true, link };
  }

  async getPublicPdf(id: string, token: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const expected = this.buildPublicPdfToken({
      id: invoice.id,
      customerEmail: invoice.customer.email,
      total: invoice.total,
      pdfPath: invoice.pdfPath,
    });
    if (token !== expected) {
      throw new NotFoundException('Invoice not found');
    }

    const pdf = (!invoice.pdfPath || !existsSync(join(process.cwd(), invoice.pdfPath.replace(/^\//, ''))))
      ? await this.generatePdf(id)
      : {
          pdfPath: invoice.pdfPath,
          filePath: join(process.cwd(), invoice.pdfPath.replace(/^\//, '')),
        };

    return pdf;
  }

  private renderTemplate(template: string, tokens: Record<string, string>) {
    return Object.entries(tokens).reduce((output, [key, value]) => {
      const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      return output.replace(pattern, value);
    }, template);
  }
}
