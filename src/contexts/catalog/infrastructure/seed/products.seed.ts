export interface ProductSeed {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly priceInCents: number;
  readonly currency: string;
  readonly imageKey: string;
  readonly available: number;
}

/**
 * Dummy products the store is seeded with. Names and descriptions are shown to
 * buyers as they are, so they are written in Spanish (Colombia).
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
      'Cafetera espresso manual con tanque de 1,5 L, bomba de 15 bares y espumador de leche en acero inoxidable.',
    priceInCents: 89_990_00,
    currency: 'COP',
    imageKey: 'product/prod-espresso-01.webp',
    available: 12,
  },
  {
    id: 'prod-grinder-02',
    name: 'Molino cónico Fresa',
    description:
      'Molino de fresas cónicas con 40 niveles de molienda, desde espresso hasta prensa francesa.',
    priceInCents: 42_500_00,
    currency: 'COP',
    imageKey: 'product/prod-grinder-02.webp',
    available: 8,
  },
  {
    id: 'prod-kettle-03',
    name: 'Hervidor de cuello de ganso',
    description:
      'Hervidor de cuello de ganso de 1 L con temperatura ajustable entre 40 y 100 grados.',
    priceInCents: 27_900_00,
    currency: 'COP',
    imageKey: 'product/prod-kettle-03.webp',
    available: 25,
  },
  {
    id: 'prod-scale-04',
    name: 'Báscula de precisión 0.1 g',
    description:
      'Báscula para preparar café con temporizador integrado, precisión de 0,1 g y capacidad de hasta 2 kg.',
    priceInCents: 15_400_00,
    currency: 'COP',
    imageKey: 'product/prod-scale-04.webp',
    available: 40,
  },
  {
    id: 'prod-chemex-05',
    name: 'Chemex de vidrio 6 tazas',
    description:
      'Cafetera de filtro en vidrio borosilicato soplado a mano, con collar de madera, para 6 tazas.',
    priceInCents: 33_200_00,
    currency: 'COP',
    imageKey: 'product/prod-chemex-05.webp',
    available: 6,
  },
  {
    id: 'prod-beans-06',
    name: 'Café de origen Huila 500 g',
    description: 'Caturra lavado del Huila, cultivado a 1.700 m. Notas de panela, naranja y cacao.',
    priceInCents: 4_800_00,
    currency: 'COP',
    imageKey: 'product/prod-beans-06.webp',
    // Deliberately sold out, so the empty state is visible without having to
    // buy out a product first.
    available: 0,
  },
];
