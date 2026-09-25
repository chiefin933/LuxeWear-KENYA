import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { UnauthorizedError, NotFoundError } from '../../errors/app.error.js';
import { RoleName } from '@prisma/client';

export interface JwtPayload {
  userId: string;
  email: string;
  roles: RoleName[];
  permissions: string[];
}

export class AuthService {
  static async login(email: string, passwordPlain: string) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    const isPasswordValid = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    // Compile Roles and Permissions
    const roles: RoleName[] = user.userRoles.map((ur) => ur.role.name);
    const permissionsSet = new Set<string>();

    for (const ur of user.userRoles) {
      for (const rp of ur.role.permissions) {
        permissionsSet.add(rp.permission.action);
      }
    }

    const permissions = Array.from(permissionsSet);

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      roles,
      permissions,
    };

    const accessToken = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: '1d',
      issuer: 'LuxeWear Kenya',
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        roles,
        permissions,
      },
    };
  }

  static async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      throw new NotFoundError('User profile not found.');
    }

    const roles: RoleName[] = user.userRoles.map((ur) => ur.role.name);
    const permissionsSet = new Set<string>();

    for (const ur of user.userRoles) {
      for (const rp of ur.role.permissions) {
        permissionsSet.add(rp.permission.action);
      }
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles,
      permissions: Array.from(permissionsSet),
      createdAt: user.createdAt,
    };
  }
}
