import { Prisma } from '@prisma/client';

const DEFAULT_INVOICE_NUMBER_START = 1;

export const formatInvoiceNumber = (invoiceNumber?: number | null, invoiceId?: string) => {
  if (invoiceNumber && Number.isFinite(invoiceNumber)) {
    return `INV-${invoiceNumber}`;
  }
  if (!invoiceId) {
    return 'INV-';
  }
  return `INV-${invoiceId.slice(0, 6).toUpperCase()}`;
};

export const getNextInvoiceNumber = async (tx: Prisma.TransactionClient) => {
  await tx.$executeRawUnsafe('LOCK TABLE "Invoice" IN EXCLUSIVE MODE');

  const settings = await tx.setting.upsert({
    where: { id: 1 },
    update: {},
    create: {},
    select: { invoiceNumberStart: true },
  });

  const start = Math.max(DEFAULT_INVOICE_NUMBER_START, Number(settings.invoiceNumberStart ?? DEFAULT_INVOICE_NUMBER_START));
  const latest = await tx.invoice.aggregate({ _max: { invoiceNumber: true } });
  const maxNumber = Number(latest._max.invoiceNumber ?? 0);

  return maxNumber >= start ? maxNumber + 1 : start;
};
