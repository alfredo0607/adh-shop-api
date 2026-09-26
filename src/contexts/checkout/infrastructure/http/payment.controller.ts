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
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { toHttpResponse } from '../../../../shared/infrastructure/http/domain-http.exception';
import { IdempotencyInterceptor } from '../../../../shared/infrastructure/idempotency/idempotency.interceptor';
// Value imports: see the note in the catalogue's controller.
import { GetPaymentTerms } from '../../application/get-payment-terms.usecase';
import { PayTransaction } from '../../application/pay-transaction.usecase';
import { PayTransactionBody, PaymentTermsResponse } from './payment.dto';
import { TransactionResponse } from './transaction.response';

@ApiTags('Payments')
@Controller({ version: '1' })
export class PaymentController {
  constructor(
    private readonly getPaymentTerms: GetPaymentTerms,
    private readonly payTransaction: PayTransaction,
  ) {}

  @Get('payment-terms')
  @ApiOperation({
    operationId: 'getPaymentTerms',
    summary: 'Documents the buyer must accept, and where to tokenise the card',
  })
  @ApiOkResponse({ type: PaymentTermsResponse })
  @ApiResponse({ status: 503, description: 'PAYMENT_GATEWAY_UNAVAILABLE' })
  // The acceptance tokens are issued per request and expire.
  @Header('Cache-Control', 'no-store')
  async terms(): Promise<PaymentTermsResponse> {
    return PaymentTermsResponse.from(toHttpResponse(await this.getPaymentTerms.execute()));
  }

  @Post('transactions/:id/payment')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({
    operationId: 'payTransaction',
    summary: 'Charge the card for a PENDING transaction',
    description:
      'Answers 202: the gateway settles the payment a few seconds later. Poll ' +
      'GET /transactions/:id until the status is no longer PENDING. A declined card is a ' +
      'final status, not an error.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'A new UUID per payment attempt. A retry with the same key returns the original ' +
      'response instead of charging again.',
  })
  @ApiAcceptedResponse({ type: TransactionResponse })
  @ApiResponse({ status: 400, description: 'Missing or malformed Idempotency-Key' })
  @ApiResponse({ status: 404, description: 'TRANSACTION_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'TRANSACTION_NOT_PAYABLE, RESERVATION_EXPIRED or IDEMPOTENT_REQUEST_IN_PROGRESS',
  })
  @ApiResponse({ status: 422, description: 'PAYMENT_REJECTED or IDEMPOTENCY_KEY_REUSED' })
  @ApiResponse({ status: 503, description: 'PAYMENT_GATEWAY_UNAVAILABLE' })
  @Header('Cache-Control', 'no-store')
  async pay(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: PayTransactionBody,
  ): Promise<TransactionResponse> {
    const transaction = await this.payTransaction.execute({ transactionId: id, ...body });

    return TransactionResponse.from(toHttpResponse(transaction));
  }
}
