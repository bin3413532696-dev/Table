import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export function sendValidationError(reply: FastifyReply, error: ZodError) {
  return reply.code(400).send({
    error: 'BAD_REQUEST',
    message: 'Request validation failed',
    details: error.flatten(),
  });
}

export function sendInfrastructureError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return sendValidationError(reply, error);
  }

  const message = error instanceof Error ? error.message : 'Unknown infrastructure error';
  return reply.code(503).send({
    error: 'SERVICE_UNAVAILABLE',
    message,
  });
}
