import { PriceType } from '@prisma/client';

type UpsellDefault = {
  name: string;
  price: number;
  priceType: PriceType;
  applicabilityRules?: Record<string, any>;
};

export const DEFAULT_UPSELL_OPTIONS: UpsellDefault[] = [
  {
    name: 'Top-Up All Fluids (coolant, brake, washer)',
    price: 25,
    priceType: PriceType.FIXED,
    applicabilityRules: { seasons: ['Winter', 'Autumn'] },
  },
  {
    name: 'Brake Inspection',
    price: 0,
    priceType: PriceType.QUOTE_REQUIRED,
    applicabilityRules: undefined,
  },
  {
    name: 'Upgrade to Full Synthetic Oil',
    price: 49,
    priceType: PriceType.FROM,
    applicabilityRules: { minKm: 60000 },
  },
  {
    name: 'Engine Flush',
    price: 79,
    priceType: PriceType.FROM,
    applicabilityRules: { minKm: 80000 },
  },
  {
    name: 'Cabin (Pollen) Filter Replacement',
    price: 45,
    priceType: PriceType.FIXED,
    applicabilityRules: { minKm: 30000 },
  },
  {
    name: 'Air Filter Replacement',
    price: 35,
    priceType: PriceType.FIXED,
    applicabilityRules: { minKm: 30000 },
  },
  {
    name: 'Wiper Blade Replacement',
    price: 39,
    priceType: PriceType.FIXED,
    applicabilityRules: { seasons: ['Winter', 'Autumn', 'Spring'] },
  },
  {
    name: 'Oil Filter Upgrade (Premium / OEM)',
    price: 29,
    priceType: PriceType.FROM,
    applicabilityRules: undefined,
  },
  {
    name: 'Fuel Filter Check / Replacement',
    price: 0,
    priceType: PriceType.QUOTE_REQUIRED,
    applicabilityRules: undefined,
  },
  {
    name: 'Battery Health Test',
    price: 0,
    priceType: PriceType.QUOTE_REQUIRED,
    applicabilityRules: undefined,
  },
  {
    name: 'Engine Diagnostic Scan',
    price: 95,
    priceType: PriceType.FIXED,
    applicabilityRules: undefined,
  },
  {
    name: 'Fuel System Cleaner Additive',
    price: 25,
    priceType: PriceType.FIXED,
    applicabilityRules: undefined,
  },
  {
    name: 'Windscreen Washer System Check',
    price: 0,
    priceType: PriceType.QUOTE_REQUIRED,
    applicabilityRules: undefined,
  },
];
