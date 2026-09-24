import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { toHttpResponse } from '../../../../shared/infrastructure/http/domain-http.exception';
// Value imports, not `import type`. A type-only import is erased at runtime,
// so emitDecoratorMetadata records `Function` instead of the class and Nest
// cannot resolve the dependency. It compiles cleanly and fails at boot.
import { FindProduct } from '../../application/find-product.usecase';
import { ListProducts } from '../../application/list-products.usecase';
import { ListProductsQueryDto } from './list-products.query';
import { ProductPageResponse, ProductResponse } from './product.response';

/**
 * HTTP adapter for the catalogue.
 *
 * Parses the request, calls one use case, maps the result to a status code.
 * There is no `if` about business state here — the moment a controller starts
 * deciding whether something is purchasable, that rule has left the domain and
 * the next caller will reimplement it slightly differently.
 */
@ApiTags('Catalog')
@Controller({ path: 'products', version: '1' })
export class ProductController {
  constructor(
    private readonly listProducts: ListProducts,
    private readonly findProduct: FindProduct,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List products available in the store' })
  @ApiOkResponse({ type: ProductPageResponse })
  // Short and revalidated. The catalogue changes whenever a unit is reserved,
  // so a long cache would show stock that is already gone; no cache at all
  // would make every page load hit the table.
  @Header('Cache-Control', 'public, max-age=10, stale-while-revalidate=30')
  async list(@Query() query: ListProductsQueryDto): Promise<ProductPageResponse> {
    const page = await this.listProducts.execute({ limit: query.limit, cursor: query.cursor });

    return ProductPageResponse.from(toHttpResponse(page));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read a single product' })
  @ApiParam({ name: 'id', example: 'prod-espresso-01' })
  @ApiOkResponse({ type: ProductResponse })
  @ApiResponse({ status: 404, description: 'No product with that id' })
  @Header('Cache-Control', 'public, max-age=10, stale-while-revalidate=30')
  async findOne(@Param('id') id: string): Promise<ProductResponse> {
    const product = await this.findProduct.execute(id);

    return ProductResponse.from(toHttpResponse(product));
  }
}
