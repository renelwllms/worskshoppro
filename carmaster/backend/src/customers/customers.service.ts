import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

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
  };

  create(dto: CreateCustomerDto) {
    return this.prisma.customer.create({ data: dto });
  }

  findAll(search?: string) {
    if (!search)
      return this.prisma.customer.findMany({
        orderBy: { createdAt: 'desc' },
        include: this.customerJobsInclude,
      });
    return this.prisma.customer.findMany({
      where: {
        OR: [
          { rego: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: this.customerJobsInclude,
    });
  }

  findOne(id: string) {
    return this.prisma.customer.findUnique({
      where: { id },
      include: { jobs: { orderBy: { createdAt: 'desc' } } },
    });
  }

  update(id: string, dto: UpdateCustomerDto) {
    return this.prisma.customer.update({ where: { id }, data: dto });
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

      await tx.customer.delete({
        where: { id },
      });

      return { deleted: true };
    });
  }
}
