import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { toHttpResponse } from '../../../../shared/infrastructure/http/domain-http.exception';
// Value imports: see the note in the catalogue's controller.
import { CreateTransaction } from '../../application/create-transaction.usecase';
import { FindTransaction } from '../../application/find-transaction.usecase';
import { QuoteCheckout } from '../../application/quote-checkout.usecase';
import { CreateTransactionBody } from './create-transaction.body';
import { QuoteQuery } from './quote.query';
import { QuoteResponse, TransactionResponse } from './transaction.response';

@ApiTags('Checkout')
@Controller({ version: '1' })
export class TransactionController {
  constructor(
    private readonly quoteCheckout: QuoteCheckout,
    private readonly createTransaction: CreateTransaction,
    private readonly findTransaction: FindTransaction,
  ) {}

  @Get('quotes')
  @ApiOperation({
    summary: 'Price an order for the summary screen, without reserving anything',
  })
  @ApiOkResponse({ type: QuoteResponse })
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'INSUFFICIENT_STOCK' })
  @ApiResponse({ status: 422, description: 'Invalid product id or units' })
  // Prices and stock move; a cached quote would show a total that is no
  // longer true, and the transaction would then be refused for it.
  @Header('Cache-Control', 'no-store')
  async quote(@Query() query: QuoteQuery): Promise<QuoteResponse> {
    const quote = await this.quoteCheckout.execute(query);

    return QuoteResponse.from(query.productId, toHttpResponse(quote));
  }

  @Post('transactions')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Open a PENDING transaction, reserving the units until it is paid or expires',
  })
  @ApiCreatedResponse({
    type: TransactionResponse,
    headers: { Location: { description: 'URL of the new transaction' } },
  })
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'INSUFFICIENT_STOCK' })
  @ApiResponse({
    status: 422,
    description:
      'INVALID_CUSTOMER, INVALID_DELIVERY_ADDRESS, INVALID_TRANSACTION or AMOUNT_MISMATCH',
  })
  @Header('Cache-Control', 'no-store')
  async create(
    @Body() body: CreateTransactionBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TransactionResponse> {
    const transaction = toHttpResponse(await this.createTransaction.execute(body));

    response.location(`/api/v1/transactions/${transaction.id}`);

    return TransactionResponse.from(transaction);
  }

  @Get('transactions/:id')
  @ApiOperation({
    summary: 'Read a transaction, which is how the storefront resumes after a refresh',
  })
  @ApiOkResponse({ type: TransactionResponse })
  @ApiResponse({ status: 400, description: 'The id is not a UUID' })
  @ApiResponse({ status: 404, description: 'TRANSACTION_NOT_FOUND' })
  // Personal data and a status that changes: neither may sit in a shared cache.
  @Header('Cache-Control', 'no-store')
  async findOne(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<TransactionResponse> {
    const transaction = await this.findTransaction.execute(id);

    return TransactionResponse.from(toHttpResponse(transaction));
  }
}
