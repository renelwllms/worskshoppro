import 'dotenv/config';
import {
  PrismaClient,
  AuthProvider,
  PriceType,
  ServicePackageInclusionType,
  VehicleType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

async function main() {
  const serviceCategories = [
    {
      name: 'Engine Performance',
      description: 'Oil, cooling, belts and leak check',
      checklist: ['Oil & filter health', 'Cooling system pressure', 'Drive belt wear', 'Fluid leaks'],
      basePrice: 189,
      priceType: PriceType.FROM,
      durationMinutes: 60,
    },
    {
      name: 'Brake & Ride Control',
      description: 'Brake, suspension and steering assurance',
      checklist: ['Pad/rotor thickness', 'Brake fluid moisture test', 'Shock/strut condition', 'Steering play'],
      basePrice: 149,
      priceType: PriceType.FROM,
      durationMinutes: 45,
    },
    {
      name: 'Safety Systems',
      description: 'Roadworthy lighting and safety review',
      checklist: ['Tyre tread & pressures', 'All lights & signals', 'Wipers & washers', 'Battery/charging check'],
      basePrice: 129,
      priceType: PriceType.FIXED,
      durationMinutes: 30,
    },
  ];

  for (const category of serviceCategories) {
    await prisma.serviceCategory.upsert({
      where: { name: category.name },
      update: category,
      create: category,
    });
  }

  const servicePackages: Array<{
    name: string;
    description: string;
    prices: Array<{
      vehicleType: VehicleType;
      basePrice: number;
      priceType: PriceType;
      notes?: string;
    }>;
    inclusions: Array<{
      type: ServicePackageInclusionType;
      title: string;
      isRequired?: boolean;
    }>;
  }> = [
    {
      name: 'Basic Service',
      description: 'Core servicing essentials.',
      prices: [
        {
          vehicleType: VehicleType.JAPANESE,
          basePrice: 140,
          priceType: PriceType.FIXED,
          notes: 'Up to 5L engine oil',
        },
        {
          vehicleType: VehicleType.EUROPEAN,
          basePrice: 180,
          priceType: PriceType.FIXED,
          notes: 'Up to 5L engine oil',
        },
      ],
      inclusions: [
        {
          type: ServicePackageInclusionType.INCLUDED_SERVICE,
          title: 'Engine oil & oil filter change',
        },
      ],
    },
    {
      name: 'Standard Service',
      description: 'Expanded service checks and fluid top-ups.',
      prices: [
        { vehicleType: VehicleType.JAPANESE, basePrice: 170, priceType: PriceType.FIXED },
        { vehicleType: VehicleType.EUROPEAN, basePrice: 220, priceType: PriceType.FIXED },
      ],
      inclusions: [
        {
          type: ServicePackageInclusionType.INCLUDED_SERVICE,
          title: 'Engine oil & oil filter change',
        },
        {
          type: ServicePackageInclusionType.NOTE,
          title: 'Top-up fluids (as required): coolant, windscreen washer, power steering',
        },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'All lights check' },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'Interior safety check' },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'Exterior safety check' },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'Air conditioning check' },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'Brake check' },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'Suspension check' },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'Tyre condition check' },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'Wheel bearing check' },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'Differential check' },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'Axle/CV check' },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'Leak check (any type)' },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'Underbody check' },
        { type: ServicePackageInclusionType.CHECK_ITEM, title: 'Damage check' },
      ],
    },
    {
      name: 'Premium Service',
      description: 'Higher coverage package with transmission care.',
      prices: [
        { vehicleType: VehicleType.JAPANESE, basePrice: 540, priceType: PriceType.FIXED },
        {
          vehicleType: VehicleType.EUROPEAN,
          basePrice: 740,
          priceType: PriceType.FIXED,
          notes: 'Price may vary depending on transmission requirements',
        },
      ],
      inclusions: [
        { type: ServicePackageInclusionType.NOTE, title: 'Includes everything in Standard Service' },
        { type: ServicePackageInclusionType.INCLUDED_UPSELL, title: 'Cabin air filter replacement' },
        { type: ServicePackageInclusionType.INCLUDED_SERVICE, title: 'Transmission fluid change' },
      ],
    },
  ];

  for (const pkg of servicePackages) {
    const record = await prisma.servicePackage.upsert({
      where: { name: pkg.name },
      update: {
        description: pkg.description,
        isActive: true,
      },
      create: {
        name: pkg.name,
        description: pkg.description,
        isActive: true,
      },
    });

    for (const price of pkg.prices) {
      await prisma.servicePackagePrice.upsert({
        where: {
          servicePackageId_vehicleType: {
            servicePackageId: record.id,
            vehicleType: price.vehicleType,
          },
        },
        update: {
          basePrice: price.basePrice,
          priceType: price.priceType,
          notes: price.notes ?? null,
        },
        create: {
          servicePackageId: record.id,
          vehicleType: price.vehicleType,
          basePrice: price.basePrice,
          priceType: price.priceType,
          notes: price.notes ?? null,
        },
      });
    }

    await prisma.servicePackageInclusion.deleteMany({ where: { servicePackageId: record.id } });
    await prisma.servicePackageInclusion.createMany({
      data: pkg.inclusions.map((inclusion, index) => ({
        servicePackageId: record.id,
        type: inclusion.type,
        title: inclusion.title,
        isRequired: inclusion.isRequired ?? true,
        sortOrder: index,
      })),
    });
  }

  const adminEmail = 'admin@carmaster.co.nz';
  const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      displayName: 'Admin',
      passwordHash,
      provider: AuthProvider.LOCAL,
      role: 'admin',
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
