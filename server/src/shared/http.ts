import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AuthError } from './auth';

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

  if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409) {
    const message = 'message' in error && typeof error.message === 'string' ? error.message : 'Resource was modified by another request. Please refresh and try again.';
    return reply.code(409).send({
      error: 'VERSION_CONFLICT',
      message,
    });
  }

  if (error instanceof AuthError) {
    return reply.code(error.statusCode).send({
      error: error.code,
      message: error.message,
    });
  }

  const message = error instanceof Error ? error.message : 'Unknown infrastructure error';
  return reply.code(503).send({
    error: 'SERVICE_UNAVAILABLE',
    message,
  });
}
