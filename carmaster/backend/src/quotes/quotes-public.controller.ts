import { Body, Controller, Param, Post } from '@nestjs/common';
import { QuotesService } from './quotes.service';
import { IsIn, IsString } from 'class-validator';

class QuoteDecisionDto {
  @IsIn(['approve', 'decline'])
  action: 'approve' | 'decline';

  @IsString()
  token: string;
}

@Controller('public/quotes')
export class QuotesPublicController {
  constructor(private readonly quotesService: QuotesService) {}

  @Post(':id/decision')
  decide(@Param('id') id: string, @Body() body: QuoteDecisionDto) {
    return this.quotesService.respond(id, body.token, body.action);
  }
}
