import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { GraphService } from '../integrations/graph.service';
import PDFDocument from 'pdfkit';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { formatInvoiceNumber, getNextInvoiceNumber } from './invoice-number.util';

const invoiceDir = join(process.cwd(), 'uploads', 'invoices');
if (!existsSync(invoiceDir)) mkdirSync(invoiceDir, { recursive: true });

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
  ) {}

  async create(dto: CreateInvoiceDto) {
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : undefined;
    const total = dto.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    return this.prisma.$transaction(
      async (tx) => {
        const invoiceNumber = await getNextInvoiceNumber(tx);
        return tx.invoice.create({
          data: {
            invoiceNumber,
            customerId: dto.customerId,
            jobId: dto.jobId,
            dueDate,
            total,
            items: {
              create: dto.items.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.quantity * item.unitPrice,
              })),
            },
          },
          include: { items: true, customer: true, job: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  findAll() {
    return this.prisma.invoice.findMany({
      include: { items: true, customer: true, job: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true, customer: true, job: true },
    });
  }

  async update(id: string, dto: UpdateInvoiceDto) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : invoice.dueDate;
    const total = dto.items
      ? dto.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
      : invoice.total;
    const data: any = {
      dueDate,
      total,
    };
    if (dto.status) data.status = dto.status;
    if (dto.customerId) data.customerId = dto.customerId;
    if (dto.jobId) data.jobId = dto.jobId;
    return this.prisma.invoice.update({
      where: { id },
      data: {
        ...data,
        items: dto.items
          ? {
              deleteMany: {},
              create: dto.items.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.quantity * item.unitPrice,
              })),
            }
          : undefined,
      },
      include: { items: true, customer: true, job: true },
    });
  }

  async generatePdf(id: string, payload?: { notes?: string; terms?: string; subject?: string; taxRate?: number }) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true, customer: true, job: true },
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

    const rightColX = margin + pageWidth * 0.6 + 20;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(sectionTitleColor).text('Details', rightColX, y);
    doc.font('Helvetica').fontSize(10).fillColor('#111111');
    if (invoice.job?.title) {
      doc.text(`Job: ${invoice.job.title}`, rightColX, y + 16, { width: pageWidth * 0.4 - 20 });
    }
    if (payload?.subject) {
      doc.text(`Subject: ${payload.subject}`, rightColX, y + 32, { width: pageWidth * 0.4 - 20 });
    }

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

    const drawTableHeader = () => {
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

    drawTableHeader();

    const ensurePageSpace = (neededHeight: number) => {
      const bottomLimit = doc.page.height - margin - 140;
      if (y + neededHeight > bottomLimit) {
        doc.addPage();
        y = margin;
        drawTableHeader();
      }
    };

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

    y = totalsBoxTop + totalsHeight + 10;
    const notesWidth = Math.max(200, pageWidth - totalsBoxWidth - 20);
    const notesX = margin;
    if (payload?.notes) {
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(sectionTitleColor)
        .text('Notes', notesX, totalsBoxTop);
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#4b5563')
        .text(payload.notes, notesX, totalsBoxTop + 14, { width: notesWidth });
    }

    y += 24;
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

    const footerText = `Thank you for choosing ${businessName}.`;
    const footerHeight = doc.heightOfString(footerText, { width: pageWidth });
    if (y + footerHeight + 10 > doc.page.height - margin) {
      doc.addPage();
      y = margin;
    }
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#6b7280')
      .text(footerText, margin, y, { width: pageWidth, align: 'center' });

    doc.end();
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
    await this.prisma.invoice.update({ where: { id }, data: { pdfPath: `/uploads/invoices/${invoice.id}.pdf` } });
    return { pdfPath, filePath };
  }

  async sendEmail(id: string) {
    const invoice = await this.findOne(id);
    if (!invoice) throw new NotFoundException('Invoice not found');
    const pdf = await this.generatePdf(id);
    const publicUrl = (process.env.PUBLIC_PORTAL_URL || '').replace(/\/$/, '');
    const link = publicUrl ? `${publicUrl}${pdf.pdfPath}` : pdf.pdfPath;
    const settings = await this.prisma.setting.findUnique({ where: { id: 1 } });
    const taxRate = Number(settings?.taxRate) || 0;
    const subtotal = invoice.items.reduce((sum, item) => sum + Number(item.total), 0);
    const taxAmount = (subtotal * taxRate) / 100;
    const totalWithTax = subtotal + taxAmount;
    const money = (value: number) => `$${value.toFixed(2)}`;
    const defaultHtml = `
        <div style="font-family:Inter,system-ui,sans-serif;background:#0b0b0b;color:#f9f9f9;padding:20px">
          <table width="100%" style="max-width:640px;margin:0 auto;background:#111;border:1px solid #222;border-radius:12px;padding:20px">
            <tr><td>
              <h2 style="margin:0 0 8px 0;color:#f4c430;">Your Carmaster Invoice</h2>
              <p style="margin:0 0 12px 0;">Hi ${invoice.customer.firstName}, your invoice is ready for ${invoice.job?.title ?? 'your service'}.</p>
              <p style="margin:0 0 6px 0;">Subtotal: <strong>${money(subtotal)}</strong></p>
              ${taxRate > 0 ? `<p style="margin:0 0 6px 0;">GST (${taxRate.toFixed(2)}%): <strong>${money(taxAmount)}</strong></p>` : ''}
              <p style="margin:0 0 12px 0;">Total: <strong>${money(totalWithTax)}</strong></p>
              <a href="${link}" style="padding:12px 16px;background:#f4c430;color:#000;text-decoration:none;border-radius:10px;font-weight:700;">View Invoice PDF</a>
              <p style="font-size:12px;color:#aaa;margin-top:12px;">For questions call or reply to this email.</p>
            </td></tr>
          </table>
        </div>
      `;
    const html = settings?.invoiceEmailTemplate
      ? this.renderTemplate(settings.invoiceEmailTemplate, {
          customerName: `${invoice.customer.firstName} ${invoice.customer.lastName}`.trim(),
          jobTitle: invoice.job?.title ?? 'your service',
          total: money(totalWithTax),
          subtotal: money(subtotal),
          taxRate: taxRate.toFixed(2),
          taxAmount: money(taxAmount),
          totalWithTax: money(totalWithTax),
          invoiceLink: link,
        })
      : defaultHtml;
    await this.graph.sendMail({
      to: invoice.customer.email,
      subject: `Invoice for ${invoice.job?.title ?? 'service'}`,
      html,
    });
    return { sent: true, link: pdf.pdfPath };
  }

  private renderTemplate(template: string, tokens: Record<string, string>) {
    return Object.entries(tokens).reduce((output, [key, value]) => {
      const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      return output.replace(pattern, value);
    }, template);
  }
}
