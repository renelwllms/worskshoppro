import { Module } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { QuotesController } from './quotes.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { QuotesPublicController } from './quotes-public.controller';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [PrismaModule, IntegrationsModule],
  controllers: [QuotesController, QuotesPublicController],
  providers: [QuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
