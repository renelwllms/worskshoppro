import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { GraphService } from '../integrations/graph.service';
import { randomUUID, createHash } from 'crypto';
import { Prisma, QuoteStatus, TokenAction } from '@prisma/client';
import { UpdateQuoteDto } from './dto/update-quote.dto';
import PDFDocument from 'pdfkit';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import axios from 'axios';
import { getNextInvoiceNumber } from '../invoices/invoice-number.util';

const quoteDir = join(process.cwd(), 'uploads', 'quotes');
if (!existsSync(quoteDir)) mkdirSync(quoteDir, { recursive: true });

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphService,
  ) {}

  async create(dto: CreateQuoteDto) {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    const total = dto.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const quote = await this.prisma.quote.create({
      data: {
        jobId: dto.jobId,
        customerId: dto.customerId,
        expiresAt,
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
    return quote;
  }

  findAll() {
    return this.prisma.quote.findMany({
      include: { customer: true, job: true, items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.quote.findUnique({
      where: { id },
      include: { items: true, customer: true, job: true },
    });
  }

  async update(id: string, dto: UpdateQuoteDto) {
    const quote = await this.prisma.quote.findUnique({ where: { id } });
    if (!quote) throw new NotFoundException('Quote not found');
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : quote.expiresAt;
    const total = dto.items
      ? dto.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0)
      : quote.total;
    const data: any = {
      expiresAt,
      total,
    };
    if (dto.status) data.status = dto.status;
    if (dto.customerId) data.customerId = dto.customerId;
    if (dto.jobId) data.jobId = dto.jobId;
    return this.prisma.quote.update({
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

  async remove(id: string) {
    await this.prisma.quote.delete({ where: { id } });
    return { deleted: true };
  }

  async generatePdf(id: string, payload?: { notes?: string; terms?: string; subject?: string }) {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: { items: true, customer: true, job: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    const settings = await this.prisma.setting.findUnique({ where: { id: 1 } });
    const filePath = join(quoteDir, `${quote.id}.pdf`);
    const pdfPath = `/uploads/quotes/${quote.id}.pdf`;
    const doc = new PDFDocument({ margin: 50 });
    const stream = createWriteStream(filePath);
    doc.pipe(stream);
    const businessName = settings?.businessName || 'Carmaster';
    const address = settings?.address;
    const phone = settings?.phone;
    const gstNumber = settings?.gstNumber;
    const logoUrl = settings?.logoUrl;
    const subtotal = quote.items.reduce((sum, item) => sum + Number(item.total), 0);

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
    const footerText = 'Quote generated using WorkshopPro by Edgepoint.';
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
    const metaBoxHeight = 80;
    const metaBoxX = doc.page.width - margin - metaBoxWidth;
    const metaBoxY = headerY;
    doc.roundedRect(metaBoxX, metaBoxY, metaBoxWidth, metaBoxHeight, 6).fillAndStroke('#f5f5f5', '#e2e2e2');
    doc
      .fillColor('#111111')
      .font('Helvetica-Bold')
      .fontSize(13)
      .text('QUOTE', metaBoxX + 12, metaBoxY + 10);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#333333')
      .text(`Quote # ${quote.id}`, metaBoxX + 12, metaBoxY + 32)
      .text(`Status: ${quote.status}`, metaBoxX + 12, metaBoxY + 46)
      .text(`Date: ${formatDate(quote.createdAt)}`, metaBoxX + 12, metaBoxY + 60)
      .text(`Expires: ${formatDate(quote.expiresAt)}`, metaBoxX + 12, metaBoxY + 72);

    const leftBlockHeight =
      (logoDrawn ? logoSize + 8 : 0) +
      nameHeight +
      (detailText ? 14 + doc.heightOfString(detailText, { width: pageWidth * 0.6 }) : 0);
    const headerHeight = Math.max(leftBlockHeight, metaBoxHeight);
    y = headerY + headerHeight + 24;

    const sectionTitleColor = '#0f172a';
    const labelColor = '#6b7280';

    doc.font('Helvetica-Bold').fontSize(11).fillColor(sectionTitleColor).text('Bill To', margin, y);
    doc.font('Helvetica').fontSize(10).fillColor('#111111');
    doc.text(`${quote.customer.firstName} ${quote.customer.lastName}`, margin, y + 16);
    doc.fillColor(labelColor).text(quote.customer.email || '-', margin, y + 32);
    doc.fillColor(labelColor).text(quote.customer.phone || '-', margin, y + 46);

    const rightColX = margin + pageWidth * 0.6 + 20;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(sectionTitleColor).text('Details', rightColX, y);
    doc.font('Helvetica').fontSize(10).fillColor('#111111');
    if (quote.job?.title) {
      doc.text(`Job: ${quote.job.title}`, rightColX, y + 16, { width: pageWidth * 0.4 - 20 });
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

    quote.items.forEach((item) => {
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
    const totalsHeight = 18 * 2 + 20;
    doc.roundedRect(totalsX, totalsBoxTop, totalsBoxWidth, totalsHeight, 6).fillAndStroke('#f9fafb', '#e5e7eb');
    let totalsY = totalsBoxTop + 10;
    doc.font('Helvetica').fontSize(10).fillColor('#374151');
    doc.text('Subtotal', totalsX + 12, totalsY);
    doc.text(money(subtotal), totalsX, totalsY, { width: totalsBoxWidth - 12, align: 'right' });
    totalsY += 18;
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111');
    doc.text('Total', totalsX + 12, totalsY);
    doc.text(money(subtotal), totalsX, totalsY, { width: totalsBoxWidth - 12, align: 'right' });

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

    doc.end();
    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
    return { pdfPath, filePath };
  }

  async sendQuoteEmail(id: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id },
      include: { items: true, customer: true, job: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');

    const baseUrl = process.env.PUBLIC_PORTAL_URL || 'http://localhost:5173';
    const ttlHours = Number(process.env.QUOTE_TOKEN_TTL_HOURS || 72);
    const expiry = new Date();
    expiry.setHours(expiry.getHours() + ttlHours);

    const approveToken = randomUUID();
    const declineToken = randomUUID();
    const approveHash = createHash('sha256').update(approveToken).digest('hex');
    const declineHash = createHash('sha256').update(declineToken).digest('hex');

    await this.prisma.quoteApprovalToken.deleteMany({ where: { quoteId: id } });
    await this.prisma.quoteApprovalToken.createMany({
      data: [
        { quoteId: id, hashedToken: approveHash, action: TokenAction.APPROVE, expiresAt: expiry },
        { quoteId: id, hashedToken: declineHash, action: TokenAction.DECLINE, expiresAt: expiry },
      ],
    });

    const approveLink = `${baseUrl}/q/quotes/${id}/decision?token=${approveToken}&action=approve`;
    const declineLink = `${baseUrl}/q/quotes/${id}/decision?token=${declineToken}&action=decline`;

    const defaultHtml = `
      <div style="font-family:Inter,system-ui,sans-serif;background:#0b0b0b;color:#f9f9f9;padding:20px">
        <table width="100%" style="max-width:640px;margin:0 auto;background:#111;border:1px solid #222;border-radius:12px;padding:20px">
          <tr><td>
            <h2 style="margin:0 0 8px 0;color:#f4c430;">Carmaster Quote</h2>
            <p style="margin:0 0 12px 0;">Hi ${quote.customer.firstName},</p>
            <p style="margin:0 0 8px 0;">Please review your quote for <strong>${quote.job.title}</strong>.</p>
            <p style="margin:0 0 12px 0;">Total: <strong>$${quote.total.toFixed(2)}</strong></p>
            <div style="margin:14px 0;">
              <a href="${approveLink}" style="padding:12px 16px;background:#f4c430;color:#000;text-decoration:none;border-radius:10px;font-weight:700;">Approve</a>
              <a href="${declineLink}" style="padding:12px 16px;background:#1c1c1c;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;margin-left:10px;border:1px solid #2c2c2c;">Decline</a>
            </div>
            <p style="font-size:12px;color:#aaa;">Links expire in ${ttlHours}h.</p>
          </td></tr>
        </table>
      </div>`;
    const settings = await this.prisma.setting.findUnique({ where: { id: 1 } });
    const html = settings?.quoteEmailTemplate
      ? this.renderTemplate(settings.quoteEmailTemplate, {
          customerName: `${quote.customer.firstName} ${quote.customer.lastName}`.trim(),
          jobTitle: quote.job.title,
          total: `$${quote.total.toFixed(2)}`,
          approveLink,
          declineLink,
          ttlHours: String(ttlHours),
        })
      : defaultHtml;
    const mailResult = await this.graph.sendMail({
      to: quote.customer.email,
      subject: `Quote for ${quote.job.title}`,
      html,
    });
    if ('skipped' in mailResult && mailResult.skipped) {
      throw new BadRequestException('Email sender is not configured');
    }
    if ('sent' in mailResult && !mailResult.sent) {
      throw new InternalServerErrorException(mailResult.error || 'Unable to send quote email');
    }
    await this.prisma.quote.update({ where: { id }, data: { status: QuoteStatus.SENT } });
    return { sent: true, approveLink, declineLink };
  }

  async respond(id: string, token: string, action: 'approve' | 'decline') {
    const hash = createHash('sha256').update(token).digest('hex');
    const stored = await this.prisma.quoteApprovalToken.findUnique({ where: { hashedToken: hash } });
    if (!stored || stored.quoteId !== id) throw new NotFoundException('Invalid token');
    if (stored.used) throw new BadRequestException('Token already used');
    if (stored.expiresAt < new Date()) throw new BadRequestException('Token expired');
    if (
      (action === 'approve' && stored.action !== TokenAction.APPROVE) ||
      (action === 'decline' && stored.action !== TokenAction.DECLINE)
    ) {
      throw new BadRequestException('Mismatched action');
    }

    const quote = await this.prisma.quote.update({
      where: { id },
      data: {
        status: action === 'approve' ? QuoteStatus.APPROVED : QuoteStatus.DECLINED,
      },
      include: { items: true, customer: true },
    });

    await this.prisma.quoteApprovalToken.update({
      where: { hashedToken: hash },
      data: { used: true },
    });

    if (action === 'approve') {
      await this.createInvoiceFromQuote(quote.id);
    }

    return { status: quote.status };
  }

  private async createInvoiceFromQuote(quoteId: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { items: true, customer: true, job: true },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    await this.prisma.$transaction(
      async (tx) => {
        const invoiceNumber = await getNextInvoiceNumber(tx);
        await tx.invoice.create({
          data: {
            invoiceNumber,
            quoteId: quote.id,
            customerId: quote.customerId,
            jobId: quote.jobId,
            status: 'DRAFT',
            total: quote.total,
            items: {
              create: quote.items.map((item) => ({
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                total: item.total,
              })),
            },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private renderTemplate(template: string, tokens: Record<string, string>) {
    return Object.entries(tokens).reduce((output, [key, value]) => {
      const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      return output.replace(pattern, value);
    }, template);
  }
}
