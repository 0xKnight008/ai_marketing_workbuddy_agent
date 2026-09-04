import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message = code) {
    super(message);
    this.name = 'HttpError';
  }
}

export function publicError(error: unknown): { statusCode: number; body: { error: string } } {
  if (error instanceof HttpError) return { statusCode: error.statusCode, body: { error: error.code } };
  if (error instanceof ZodError) return { statusCode: 400, body: { error: 'invalid_request' } };
  if (error instanceof Error && error.message === 'Pipeline is not ready to activate') return { statusCode: 409, body: { error: 'pipeline_not_ready' } };
  if (error instanceof Error && error.message.startsWith('Forbidden:')) return { statusCode: 403, body: { error: 'forbidden' } };
  if (error instanceof Error && /not found|not available/i.test(error.message)) return { statusCode: 404, body: { error: 'not_found' } };
  return { statusCode: 500, body: { error: 'internal_error' } };
}
