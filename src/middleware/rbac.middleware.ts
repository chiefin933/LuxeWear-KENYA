import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors/app.error.js';
import { RoleName } from '@prisma/client';

export const requireRole = (allowedRoles: RoleName[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    const userRoles = req.user.roles || [];
    const hasRole = userRoles.some((role) => allowedRoles.includes(role));

    if (!hasRole) {
      return next(
        new ForbiddenError(
          `Insufficient role authorization. Allowed roles: [${allowedRoles.join(', ')}]`
        )
      );
    }

    next();
  };
};

export const requirePermission = (requiredPermissions: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    const userPermissions = req.user.permissions || [];
    const hasPermission = requiredPermissions.every((perm) => userPermissions.includes(perm));

    if (!hasPermission) {
      return next(
        new ForbiddenError(
          `Insufficient permission authorization. Required permissions: [${requiredPermissions.join(', ')}]`
        )
      );
    }

    next();
  };
};
