import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db/client';
import { provisionUser } from '../../shared/auth';
import {
  DEV_SESSION_COOKIE,
  getCurrentUserContext,
  getDefaultUserId,
  USER_ID_HEADER,
} from '../../shared/user-context';

const createUserSchema = z.object({
  id: z.string().uuid().optional(),
  displayName: z.string().trim().min(1).max(50),
  email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional(),
  bio: z.string().max(200).optional(),
});

const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(50).optional(),
  email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional(),
  bio: z.string().max(200).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});

const switchSessionSchema = z.object({
  userId: z.string().uuid(),
});

function extractBio(profileJson: unknown): string {
  if (!profileJson || typeof profileJson !== 'object' || Array.isArray(profileJson)) {
    return '';
  }

  const bio = (profileJson as Record<string, unknown>).bio;
  return typeof bio === 'string' ? bio : '';
}

function toAuthUser(user: {
  id: string;
  displayName: string;
  email: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  settings?: {
    profile_json: unknown;
  } | null;
}) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    status: user.status,
    bio: extractBio(user.settings?.profile_json),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/me', async () => {
    const context = getCurrentUserContext();
    const user = await prisma.user.findUniqueOrThrow({
      where: {
        id: context.userId,
      },
      include: {
        settings: {
          select: {
            profile_json: true,
          },
        },
      },
    });

    return {
      data: {
        user: toAuthUser(user),
        auth: {
          userIdHeader: USER_ID_HEADER,
          source: context.source,
          isDefaultUser: context.userId === getDefaultUserId(),
          devSessionCookie: DEV_SESSION_COOKIE,
        },
      },
    };
  });

  app.get('/users', async () => {
    const defaultUserId = getCurrentUserContext().userId;
    const users = await prisma.user.findMany({
      where: {
        status: 'active',
      },
      include: {
        settings: {
          select: {
            profile_json: true,
          },
        },
      },
      orderBy: [
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return {
      data: {
        items: users.map((user) => ({
          ...toAuthUser(user),
          isCurrentUser: user.id === defaultUserId,
        })),
        total: users.length,
      },
    };
  });

  app.post('/users', async (request, reply) => {
    const payload = createUserSchema.parse(request.body);
    const created = await provisionUser({
      id: payload.id,
      displayName: payload.displayName,
      email: payload.email === '' ? null : payload.email,
      bio: payload.bio,
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: {
        id: created.id,
      },
      include: {
        settings: {
          select: {
            profile_json: true,
          },
        },
      },
    });

    return reply.code(201).send({
      data: {
        user: toAuthUser(user),
      },
    });
  });

  app.patch('/me', async (request) => {
    const context = getCurrentUserContext();
    const payload = updateMeSchema.parse(request.body);

    const user = await prisma.user.findUniqueOrThrow({
      where: {
        id: context.userId,
      },
      include: {
        settings: true,
      },
    });

    const nextEmail = payload.email === '' ? null : payload.email;
    const nextProfile: Prisma.InputJsonValue = {
      bio: payload.bio !== undefined ? payload.bio : extractBio(user.settings?.profile_json),
    };

    const updated = await prisma.$transaction(async (tx) => {
      const nextUser = await tx.user.update({
        where: {
          id: context.userId,
        },
        data: {
          displayName: payload.displayName ?? user.displayName,
          email: payload.email !== undefined ? nextEmail : user.email,
        },
      });

      await tx.userSetting.upsert({
        where: {
          userId: context.userId,
        },
        update: {
          profile_json: nextProfile,
        },
        create: {
          userId: context.userId,
          theme: 'light',
          profile_json: nextProfile,
          notification_json: {},
          agentPreferencesJson: {},
        },
      });

      return tx.user.findUniqueOrThrow({
        where: {
          id: nextUser.id,
        },
        include: {
          settings: {
            select: {
              profile_json: true,
            },
          },
        },
      });
    });

    return {
      data: {
        user: toAuthUser(updated),
        auth: {
          userIdHeader: USER_ID_HEADER,
          source: context.source,
          isDefaultUser: context.userId === getDefaultUserId(),
          devSessionCookie: DEV_SESSION_COOKIE,
        },
      },
    };
  });

  app.post('/session', async (request, reply) => {
    const payload = switchSessionSchema.parse(request.body);

    const user = await prisma.user.findFirst({
      where: {
        id: payload.userId,
        status: 'active',
      },
      include: {
        settings: {
          select: {
            profile_json: true,
          },
        },
      },
    });

    if (!user) {
      return reply.code(404).send({
        message: 'User not found or inactive',
      });
    }

    reply.header(
      'Set-Cookie',
      `${DEV_SESSION_COOKIE}=${encodeURIComponent(payload.userId)}; Path=/; HttpOnly; SameSite=Lax`
    );

    return {
      data: {
        user: toAuthUser(user),
        auth: {
          userIdHeader: USER_ID_HEADER,
          source: 'session' as const,
          isDefaultUser: payload.userId === getDefaultUserId(),
          devSessionCookie: DEV_SESSION_COOKIE,
        },
      },
    };
  });

  app.delete('/session', async (_request, reply) => {
    reply.header(
      'Set-Cookie',
      `${DEV_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );

    const defaultUser = await prisma.user.findUniqueOrThrow({
      where: {
        id: getDefaultUserId(),
      },
      include: {
        settings: {
          select: {
            profile_json: true,
          },
        },
      },
    });

    return {
      data: {
        user: toAuthUser(defaultUser),
        auth: {
          userIdHeader: USER_ID_HEADER,
          source: 'default' as const,
          isDefaultUser: true,
          devSessionCookie: DEV_SESSION_COOKIE,
        },
      },
    };
  });
}
