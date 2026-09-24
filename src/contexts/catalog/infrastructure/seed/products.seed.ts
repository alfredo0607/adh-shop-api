export interface ProductSeed {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly priceInCents: number;
  readonly currency: string;
  readonly imageUrl: string;
  readonly available: number;
}

/**
 * Dummy products the store is seeded with.
 *
 * The brief requires a seeded catalogue and explicitly says there is no need
 * for an endpoint that creates products, so this is the only way inventory
 * enters the system.
 *
 * Prices are Colombian pesos in integer minor units: 89_990_00 is $89,990.00.
 * One product starts sold out on purpose — an empty state that only appears
 * after someone buys the last unit is an empty state nobody ever tests.
 */
export const PRODUCT_SEED: readonly ProductSeed[] = [
  {
    id: 'prod-espresso-01',
    name: 'Cafetera espresso Artigiano',
    description:
      'Manual espresso machine with a 1.5 L tank, 15 bar pump and a stainless steel milk frother.',
    priceInCents: 89_990_00,
    currency: 'COP',
    imageUrl: 'https://images.unsplash.com/photo-1517668808822-9ebb02f2a0e6?w=800&q=80&fm=webp',
    available: 12,
  },
  {
    id: 'prod-grinder-02',
    name: 'Molino cónico Fresa',
    description: 'Conical burr grinder with 40 grind settings, from espresso to French press.',
    priceInCents: 42_500_00,
    currency: 'COP',
    imageUrl: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=800&q=80&fm=webp',
    available: 8,
  },
  {
    id: 'prod-kettle-03',
    name: 'Hervidor de cuello de ganso',
    description:
      'Gooseneck kettle with variable temperature control between 40 and 100 degrees, 1 L.',
    priceInCents: 27_900_00,
    currency: 'COP',
    imageUrl: 'https://images.unsplash.com/photo-1608354580875-30bd4168b351?w=800&q=80&fm=webp',
    available: 25,
  },
  {
    id: 'prod-scale-04',
    name: 'Báscula de precisión 0.1 g',
    description: 'Brewing scale with a built-in timer, accurate to a tenth of a gram, up to 2 kg.',
    priceInCents: 15_400_00,
    currency: 'COP',
    imageUrl: 'https://images.unsplash.com/photo-1524350876685-274059332603?w=800&q=80&fm=webp',
    available: 40,
  },
  {
    id: 'prod-chemex-05',
    name: 'Chemex de vidrio 6 tazas',
    description: 'Hand-blown borosilicate pour-over brewer with a wooden collar, 6 cup capacity.',
    priceInCents: 33_200_00,
    currency: 'COP',
    imageUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&q=80&fm=webp',
    available: 6,
  },
  {
    id: 'prod-beans-06',
    name: 'Café de origen Huila 500 g',
    description: 'Washed Caturra from Huila, 1,700 m. Notes of panela, orange and cocoa.',
    priceInCents: 4_800_00,
    currency: 'COP',
    imageUrl: 'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=800&q=80&fm=webp',
    // Deliberately sold out, so the empty state is visible without having to
    // buy out a product first.
    available: 0,
  },
];
