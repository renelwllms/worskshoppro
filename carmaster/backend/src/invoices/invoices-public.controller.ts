import { Controller, Get, Header, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import type { Response } from 'express';

@Controller('public/invoices')
export class InvoicesPublicController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Header('Cache-Control', 'no-store')
  @Get(':id/pdf')
  async viewPdf(@Param('id') id: string, @Query('token') token: string, @Res() res: Response) {
    if (!token?.trim()) {
      throw new NotFoundException('Invoice not found');
    }
    const pdf = await this.invoicesService.getPublicPdf(id, token);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${id}.pdf"`);
    return res.sendFile(pdf.filePath);
  }
}
