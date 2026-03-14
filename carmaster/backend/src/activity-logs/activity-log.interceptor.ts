import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type RequestWithUser = {
  method?: string;
  path?: string;
  url?: string;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  user?: {
    userId?: string;
    id?: string;
    email?: string;
    displayName?: string;
    role?: string;
  } | null;
};

@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}
  private readonly retentionDays = 30;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const method = String(request.method || '').toUpperCase();
    const path = (request.path || request.url || '').split('?')[0];
    const isLogin = method === 'POST' && path.includes('/auth/login');
    const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    if (!isMutating || !request.user) {
      return next.handle();
    }

    const action = this.resolveAction(method, path, isLogin);
    const entity = this.resolveEntity(path);
    const actorId = request.user.userId || request.user.id || null;
    const actorEmail = request.user.email || null;
    const actorName = request.user.displayName || null;
    const actorRole = request.user.role || null;
    const entityId = request.params?.id || null;

    const persist = (status: 'SUCCESS' | 'FAILED', errorMessage?: string) => {
      const query =
        request.query && Object.keys(request.query).length > 0 ? request.query : undefined;
      const queryDetails = query ? JSON.parse(JSON.stringify(query)) : undefined;
      const details = {
        query: queryDetails,
        error: errorMessage || undefined,
      } as Prisma.InputJsonValue;
      const retentionCutoff = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);
      void this.prisma
        .$transaction([
          this.prisma.activityLog.deleteMany({
            where: {
              createdAt: {
                lt: retentionCutoff,
              },
            },
          }),
          this.prisma.activityLog.create({
            data: {
              action,
              status,
              entity,
              entityId,
              actorId,
              actorEmail,
              actorName,
              actorRole,
              method,
              path,
              details,
            },
          }),
        ])
        .catch(() => undefined);
    };

    return next.handle().pipe(
      tap({
        next: () => persist('SUCCESS'),
        error: (error: unknown) => persist('FAILED', this.getErrorMessage(error)),
      }),
    );
  }

  private resolveAction(method: string, path: string, isLogin: boolean) {
    if (isLogin) return 'LOGIN';
    if (method === 'DELETE') return 'DELETE';
    if (method === 'PATCH' || method === 'PUT') return 'EDIT';
    if (method === 'POST') {
      if (path.includes('/send') || path.includes('/test') || path.includes('/sync')) {
        return 'EDIT';
      }
      return 'CREATE';
    }
    return 'OTHER';
  }

  private resolveEntity(path: string) {
    const segments = path.split('/').filter(Boolean);
    if (!segments.length) return 'system';
    if (segments[0] === 'api') segments.shift();
    if (!segments.length) return 'system';
    if (segments[0] === 'settings' && segments[1]) return segments[1];
    return segments[0];
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object') {
        const message = (response as Record<string, unknown>).message;
        if (Array.isArray(message)) return message.join(', ');
        if (typeof message === 'string') return message;
      }
      return error.message;
    }
    if (error instanceof Error) return error.message;
    return 'Request failed';
  }
}
