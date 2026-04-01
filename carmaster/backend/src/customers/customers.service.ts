import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly customerVehiclesInclude = {
    vehicles: {
      orderBy: [{ createdAt: 'asc' as const }, { rego: 'asc' as const }],
      include: {
        jobs: {
          orderBy: { createdAt: 'desc' as const },
          select: {
            id: true,
            title: true,
            serviceType: true,
            createdAt: true,
            wofExpiryDate: true,
            regoExpiryDate: true,
          },
        },
      },
    },
  };

  private readonly customerJobsInclude = {
    jobs: {
      orderBy: { createdAt: 'desc' as const },
      select: {
        id: true,
        title: true,
        serviceType: true,
        createdAt: true,
        wofExpiryDate: true,
        regoExpiryDate: true,
      },
    },
    ...this.customerVehiclesInclude,
  };

  private mapCustomerResponse(customer: any) {
    const vehicles = Array.isArray(customer?.vehicles) ? customer.vehicles : [];
    const primaryVehicle =
      vehicles.find((vehicle: any) =>
        customer?.rego && String(vehicle?.rego || '').toLowerCase() === String(customer.rego).toLowerCase(),
      ) ?? vehicles[0] ?? null;

    return {
      ...customer,
      rego: primaryVehicle?.rego ?? customer?.rego ?? null,
      vehicleBrand: primaryVehicle?.vehicleBrand ?? customer?.vehicleBrand ?? null,
      vehicleModel: primaryVehicle?.vehicleModel ?? customer?.vehicleModel ?? null,
      primaryVehicle,
      vehicles,
    };
  }

  private async upsertVehicleForCustomer(
    customerId: string,
    dto: Pick<CreateCustomerDto, 'rego' | 'vehicleBrand' | 'vehicleModel'>,
  ) {
    const rego = dto.rego?.trim().toUpperCase();
    if (!rego) {
      return null;
    }

    const existingVehicle = await this.prisma.vehicle.findFirst({
      where: { rego: { equals: rego, mode: 'insensitive' } },
    });

    if (existingVehicle) {
      return this.prisma.vehicle.update({
        where: { id: existingVehicle.id },
        data: {
          customerId,
          rego,
          vehicleBrand: dto.vehicleBrand || null,
          vehicleModel: dto.vehicleModel || null,
        },
      });
    }

    return this.prisma.vehicle.create({
      data: {
        customerId,
        rego,
        vehicleBrand: dto.vehicleBrand || null,
        vehicleModel: dto.vehicleModel || null,
      },
    });
  }

  async create(dto: CreateCustomerDto) {
    const customer = await this.prisma.customer.create({
      data: {
        rego: dto.rego?.trim().toUpperCase() || null,
        vehicleBrand: dto.vehicleBrand || null,
        vehicleModel: dto.vehicleModel || null,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        email: dto.email,
      },
      include: this.customerJobsInclude,
    });

    await this.upsertVehicleForCustomer(customer.id, dto);

    const reloaded = await this.prisma.customer.findUnique({
      where: { id: customer.id },
      include: this.customerJobsInclude,
    });
    return this.mapCustomerResponse(reloaded);
  }

  async findAll(search?: string) {
    const query = search?.trim();
    const customers = !query
      ? await this.prisma.customer.findMany({
          orderBy: { createdAt: 'desc' },
          include: this.customerJobsInclude,
        })
      : await this.prisma.customer.findMany({
          where: {
            OR: [
              { rego: { contains: query, mode: 'insensitive' } },
              { phone: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } },
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
              { vehicles: { some: { rego: { contains: query, mode: 'insensitive' } } } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          include: this.customerJobsInclude,
        });

    return customers.map((customer) => this.mapCustomerResponse(customer));
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: this.customerJobsInclude,
    });
    return customer ? this.mapCustomerResponse(customer) : null;
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        rego: dto.rego?.trim().toUpperCase() || undefined,
        vehicleBrand: dto.vehicleBrand === undefined ? undefined : dto.vehicleBrand || null,
        vehicleModel: dto.vehicleModel === undefined ? undefined : dto.vehicleModel || null,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        email: dto.email,
      },
      include: this.customerJobsInclude,
    });

    await this.upsertVehicleForCustomer(id, dto);

    const reloaded = await this.prisma.customer.findUnique({
      where: { id },
      include: this.customerJobsInclude,
    });
    return this.mapCustomerResponse(reloaded);
  }

  async remove(id: string) {
    const existing = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Customer not found');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.serviceSchedule.deleteMany({
        where: { customerId: id },
      });

      await tx.invoice.deleteMany({
        where: { customerId: id },
      });

      await tx.quote.deleteMany({
        where: { customerId: id },
      });

      await tx.job.deleteMany({
        where: { customerId: id },
      });

      await tx.vehicle.deleteMany({
        where: { customerId: id },
      });

      await tx.customer.delete({
        where: { id },
      });

      return { deleted: true };
    });
  }
}
