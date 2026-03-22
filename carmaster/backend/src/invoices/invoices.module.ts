import { Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesPublicController } from './invoices-public.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [PrismaModule, IntegrationsModule],
  controllers: [InvoicesController, InvoicesPublicController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
