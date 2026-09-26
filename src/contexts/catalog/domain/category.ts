/**
 * The aisles of the store. Stable codes, never display text: the storefront
 * owns the words shown to buyers, in their language, and can rename an aisle
 * without a change here.
 */
export const PRODUCT_CATEGORIES = [
  'coffee-makers',
  'grinders',
  'brewing',
  'accessories',
  'coffee',
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const isProductCategory = (value: unknown): value is ProductCategory =>
  typeof value === 'string' && (PRODUCT_CATEGORIES as readonly string[]).includes(value);
