import type { ProductCategory } from '../../domain/category';

export interface ProductSeed {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: ProductCategory;
  readonly priceInCents: number;
  readonly currency: string;
  readonly imageKey: string;
  readonly available: number;
}

const image = (id: string): string => `product/${id}.webp`;

/**
 * Dummy products the store is seeded with. Names and descriptions are shown to
 * buyers as they are, so they are written in Spanish (Colombia).
 *
 * The brief requires a seeded catalogue and explicitly says there is no need
 * for an endpoint that creates products, so this is the only way inventory
 * enters the system.
 *
 * Eighteen products across every category: enough for the storefront's filters
 * to narrow something down and for its pagination to have more than one page.
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
    category: 'coffee-makers',
    priceInCents: 89_990_00,
    currency: 'COP',
    imageKey: image('prod-espresso-01'),
    available: 12,
  },
  {
    id: 'prod-grinder-02',
    name: 'Molino cónico Fresa',
    description:
      'Molino de fresas cónicas con 40 niveles de molienda, desde espresso hasta prensa francesa.',
    category: 'grinders',
    priceInCents: 42_500_00,
    currency: 'COP',
    imageKey: image('prod-grinder-02'),
    available: 8,
  },
  {
    id: 'prod-kettle-03',
    name: 'Hervidor de cuello de ganso',
    description:
      'Hervidor de cuello de ganso de 1 L con temperatura ajustable entre 40 y 100 grados.',
    category: 'accessories',
    priceInCents: 27_900_00,
    currency: 'COP',
    imageKey: image('prod-kettle-03'),
    available: 25,
  },
  {
    id: 'prod-scale-04',
    name: 'Báscula de precisión 0.1 g',
    description:
      'Báscula para preparar café con temporizador integrado, precisión de 0,1 g y capacidad de hasta 2 kg.',
    category: 'accessories',
    priceInCents: 15_400_00,
    currency: 'COP',
    imageKey: image('prod-scale-04'),
    available: 40,
  },
  {
    id: 'prod-chemex-05',
    name: 'Chemex de vidrio 6 tazas',
    description:
      'Cafetera de filtro en vidrio borosilicato soplado a mano, con collar de madera, para 6 tazas.',
    category: 'brewing',
    priceInCents: 33_200_00,
    currency: 'COP',
    imageKey: image('prod-chemex-05'),
    available: 6,
  },
  {
    id: 'prod-beans-06',
    name: 'Café de origen Huila 500 g',
    description: 'Caturra lavado del Huila, cultivado a 1.700 m. Notas de panela, naranja y cacao.',
    category: 'coffee',
    priceInCents: 4_800_00,
    currency: 'COP',
    imageKey: image('prod-beans-06'),
    // Deliberately sold out, so the empty state is visible without having to
    // buy out a product first.
    available: 0,
  },
  {
    id: 'prod-moka-07',
    name: 'Cafetera moka 6 tazas',
    description:
      'Cafetera italiana de aluminio para estufa, con válvula de seguridad y mango resistente al calor.',
    category: 'coffee-makers',
    priceInCents: 11_900_00,
    currency: 'COP',
    imageKey: image('prod-moka-07'),
    available: 30,
  },
  {
    id: 'prod-drip-08',
    name: 'Cafetera de goteo programable',
    description:
      'Cafetera de goteo para 12 tazas con programación de encendido, jarra térmica y filtro permanente.',
    category: 'coffee-makers',
    priceInCents: 38_500_00,
    currency: 'COP',
    imageKey: image('prod-drip-08'),
    available: 9,
  },
  {
    id: 'prod-french-press-09',
    name: 'Prensa francesa 1 L',
    description:
      'Prensa francesa de vidrio y acero inoxidable con doble filtro de malla, para 8 tazas.',
    category: 'brewing',
    priceInCents: 9_800_00,
    currency: 'COP',
    imageKey: image('prod-french-press-09'),
    available: 22,
  },
  {
    id: 'prod-dripper-10',
    name: 'Gotero cerámico de filtro cónico',
    description:
      'Gotero de cerámica con estrías en espiral para una extracción pareja, de 1 a 4 tazas.',
    category: 'brewing',
    priceInCents: 8_500_00,
    currency: 'COP',
    imageKey: image('prod-dripper-10'),
    available: 18,
  },
  {
    id: 'prod-immersion-11',
    name: 'Cafetera de inmersión portátil',
    description:
      'Cafetera de inmersión y presión manual, ligera e irrompible, ideal para viajes y oficina.',
    category: 'brewing',
    priceInCents: 16_900_00,
    currency: 'COP',
    imageKey: image('prod-immersion-11'),
    available: 4,
  },
  {
    id: 'prod-grinder-electric-12',
    name: 'Molino eléctrico de muelas planas',
    description:
      'Molino eléctrico de muelas planas de 64 mm con dosificación por tiempo y 60 ajustes de molienda.',
    category: 'grinders',
    priceInCents: 124_900_00,
    currency: 'COP',
    imageKey: image('prod-grinder-electric-12'),
    available: 3,
  },
  {
    id: 'prod-grinder-travel-13',
    name: 'Molino manual de viaje',
    description:
      'Molino manual compacto con fresas de acero, manivela plegable y capacidad para 20 g de café.',
    category: 'grinders',
    priceInCents: 18_700_00,
    currency: 'COP',
    imageKey: image('prod-grinder-travel-13'),
    available: 15,
  },
  {
    id: 'prod-pitcher-14',
    name: 'Jarra para leche 600 ml',
    description: 'Jarra de acero inoxidable con pico de precisión para arte latte, 600 ml.',
    category: 'accessories',
    priceInCents: 5_900_00,
    currency: 'COP',
    imageKey: image('prod-pitcher-14'),
    available: 35,
  },
  {
    id: 'prod-tamper-15',
    name: 'Prensador de 58 mm',
    description: 'Prensador de base plana en acero inoxidable con mango de madera, de 58 mm.',
    category: 'accessories',
    priceInCents: 7_400_00,
    currency: 'COP',
    imageKey: image('prod-tamper-15'),
    available: 20,
  },
  {
    id: 'prod-filters-16',
    name: 'Filtros de papel × 100',
    description:
      'Filtros de papel cónicos sin blanquear, para goteros de 1 a 4 tazas. Caja de 100.',
    category: 'accessories',
    priceInCents: 2_500_00,
    currency: 'COP',
    imageKey: image('prod-filters-16'),
    available: 60,
  },
  {
    id: 'prod-beans-narino-17',
    name: 'Café de origen Nariño 500 g',
    description:
      'Castillo lavado de Nariño, cultivado a 2.000 m. Notas de caramelo, mandarina y flores.',
    category: 'coffee',
    priceInCents: 5_200_00,
    currency: 'COP',
    imageKey: image('prod-beans-narino-17'),
    available: 45,
  },
  {
    id: 'prod-beans-sierra-18',
    name: 'Café de origen Sierra Nevada 250 g',
    description:
      'Típica de la Sierra Nevada de Santa Marta, proceso natural. Notas de chocolate y frutos rojos.',
    category: 'coffee',
    priceInCents: 3_900_00,
    currency: 'COP',
    imageKey: image('prod-beans-sierra-18'),
    available: 2,
  },
];
