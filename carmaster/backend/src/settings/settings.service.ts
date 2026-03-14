import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingDto } from './dto/update-setting.dto';
import { ServiceCategoryDto } from './dto/service-category.dto';
import { BookingsService } from '../integrations/bookings.service';
import { UpsellOptionDto } from './dto/upsell-option.dto';
import { DEFAULT_UPSELL_OPTIONS } from './upsell-defaults';
import { ServicePackageDto } from './dto/service-package.dto';
import { PriceType, Prisma } from '@prisma/client';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
  ) {}

  getSettings() {
    return this.prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: {},
    });
  }

  updateSettings(dto: UpdateSettingDto) {
    return this.prisma.setting.upsert({
      where: { id: 1 },
      update: dto,
      create: dto,
    });
  }

  private async ensureWofService() {
    const existing = await this.prisma.serviceCategory.findFirst({
      where: {
        OR: [
          { name: { equals: 'Warranty of Fitness (WOF)', mode: 'insensitive' } },
          { name: { equals: 'Warranty of Fitness', mode: 'insensitive' } },
          { name: { equals: 'WOF', mode: 'insensitive' } },
          { name: { contains: 'Warranty of Fitness', mode: 'insensitive' } },
          { name: { contains: 'WOF', mode: 'insensitive' } },
        ],
      },
    });
    if (existing) return existing;
    return this.prisma.serviceCategory.create({
      data: {
        name: 'Warranty of Fitness (WOF)',
        description: 'Roadworthy inspection and compliance check',
        checklist: ['Brake inspection', 'Lights and indicators check', 'Tyre and suspension safety check'],
        basePrice: 80,
        priceType: PriceType.FIXED,
        durationMinutes: 45,
        active: true,
      },
    });
  }

  async listServices() {
    await this.ensureWofService();
    return this.prisma.serviceCategory.findMany({ orderBy: { createdAt: 'desc' } });
  }

  createService(dto: ServiceCategoryDto) {
    return this.prisma.serviceCategory.create({ data: dto });
  }

  updateService(id: string, dto: ServiceCategoryDto) {
    return this.prisma.serviceCategory.update({ where: { id }, data: dto });
  }

  removeService(id: string) {
    return this.prisma.serviceCategory.delete({ where: { id } });
  }

  async listUpsells() {
    const existing = await this.prisma.upsellOption.findMany({ orderBy: { createdAt: 'asc' } });
    if (existing.length > 0) {
      return existing;
    }
    await this.prisma.upsellOption.createMany({
      data: DEFAULT_UPSELL_OPTIONS.map((option) => ({
        name: option.name,
        price: option.price ?? 0,
        priceType: option.priceType,
        applicabilityRules: option.applicabilityRules ?? undefined,
        isActive: true,
      })),
      skipDuplicates: true,
    });
    return this.prisma.upsellOption.findMany({ orderBy: { createdAt: 'asc' } });
  }

  createUpsell(dto: UpsellOptionDto) {
    return this.prisma.upsellOption.create({ data: dto });
  }

  updateUpsell(id: string, dto: UpsellOptionDto) {
    return this.prisma.upsellOption.update({ where: { id }, data: dto });
  }

  removeUpsell(id: string) {
    return this.prisma.upsellOption.delete({ where: { id } });
  }

  private validatePackagePriceVehicleTypes(prices: ServicePackageDto['prices']) {
    const unique = new Set(prices.map((price) => price.vehicleType));
    if (unique.size !== prices.length) {
      throw new BadRequestException('Each vehicle type can only have one package price');
    }
  }

  private servicePackageInclude = {
    prices: { orderBy: { vehicleType: 'asc' as const } },
    inclusions: { orderBy: { sortOrder: 'asc' as const } },
  };

  listServicePackages() {
    return this.prisma.servicePackage.findMany({
      include: this.servicePackageInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  createServicePackage(dto: ServicePackageDto) {
    this.validatePackagePriceVehicleTypes(dto.prices);
    return this.prisma.servicePackage.create({
      data: {
        name: dto.name,
        description: dto.description?.trim() || null,
        isActive: dto.isActive ?? true,
        prices: {
          create: dto.prices.map((price) => ({
            vehicleType: price.vehicleType,
            basePrice: price.basePrice,
            notes: price.notes?.trim() || null,
            priceType: price.priceType ?? PriceType.FIXED,
          })),
        },
        inclusions: {
          create: (dto.inclusions || []).map((inclusion, index) => ({
            type: inclusion.type,
            title: inclusion.title,
            isRequired: inclusion.isRequired ?? true,
            sortOrder: inclusion.sortOrder ?? index,
          })),
        },
      },
      include: this.servicePackageInclude,
    });
  }

  updateServicePackage(id: string, dto: ServicePackageDto) {
    this.validatePackagePriceVehicleTypes(dto.prices);
    return this.prisma.servicePackage.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description?.trim() || null,
        isActive: dto.isActive ?? true,
        prices: {
          deleteMany: {},
          create: dto.prices.map((price) => ({
            vehicleType: price.vehicleType,
            basePrice: price.basePrice,
            notes: price.notes?.trim() || null,
            priceType: price.priceType ?? PriceType.FIXED,
          })),
        },
        inclusions: {
          deleteMany: {},
          create: (dto.inclusions || []).map((inclusion, index) => ({
            type: inclusion.type,
            title: inclusion.title,
            isRequired: inclusion.isRequired ?? true,
            sortOrder: inclusion.sortOrder ?? index,
          })),
        },
      },
      include: this.servicePackageInclude,
    });
  }

  removeServicePackage(id: string) {
    return this.prisma.servicePackage.delete({ where: { id } });
  }

  listActivityLogs(params: {
    action?: string;
    entity?: string;
    actor?: string;
    status?: string;
    limit?: string;
  }) {
    const takeParsed = Number(params.limit);
    const take = Number.isFinite(takeParsed) ? Math.min(500, Math.max(10, Math.trunc(takeParsed))) : 200;

    const where: Prisma.ActivityLogWhereInput = {};
    if (params.action?.trim()) {
      where.action = params.action.trim().toUpperCase();
    }
    if (params.status?.trim()) {
      where.status = params.status.trim().toUpperCase();
    }
    if (params.entity?.trim()) {
      where.entity = {
        equals: params.entity.trim(),
        mode: 'insensitive',
      };
    }
    if (params.actor?.trim()) {
      const actor = params.actor.trim();
      where.OR = [
        { actorEmail: { contains: actor, mode: 'insensitive' } },
        { actorName: { contains: actor, mode: 'insensitive' } },
      ];
    }

    return this.prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async testBookingsConnection() {
    const settings = await this.prisma.setting.upsert({
      where: { id: 1 },
      update: {},
      create: {},
    });
    if (!settings.bookingsBusinessId) {
      throw new BadRequestException('Bookings business ID is not configured');
    }
    try {
      const response = await this.bookings.listServices(settings.bookingsBusinessId);
      const services = response?.value ?? [];
      return { ok: true, serviceCount: services.length };
    } catch (error: any) {
      const graphMessage =
        error?.body?.error?.message ||
        error?.response?.data?.error?.message ||
        error?.message ||
        'Unknown error';
      throw new BadRequestException(`Bookings test failed: ${graphMessage}`);
    }
  }
}
