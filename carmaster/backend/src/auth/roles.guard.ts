import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    const requiredRolesLower = requiredRoles.map((role) => role.toLowerCase());
    const userRole = typeof user?.role === 'string' ? user.role.trim().toLowerCase() : '';
    if (!userRole || !requiredRolesLower.includes(userRole)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
