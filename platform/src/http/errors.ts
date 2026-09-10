import { ZodError } from 'zod';
import { SupplierBillingError, SupplierUnavailableError } from '../zernio/client';

export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message = code) {
    super(message);
    this.name = 'HttpError';
  }
}

export function publicError(error: unknown): { statusCode: number; body: { error: string } } {
  if (error instanceof SupplierBillingError) return { statusCode: 402, body: { error: error.reason === 'twitter_passthrough' ? 'zernio_x_billing_required' : 'zernio_billing_required' } };
  if (error instanceof SupplierUnavailableError) return { statusCode: 503, body: { error: 'zernio_unavailable' } };
  if (error instanceof HttpError) return { statusCode: error.statusCode, body: { error: error.code } };
  if (error instanceof ZodError) return { statusCode: 400, body: { error: 'invalid_request' } };
  if (error instanceof Error && error.message === 'Pipeline is not ready to activate') return { statusCode: 409, body: { error: 'pipeline_not_ready' } };
  if (error instanceof Error && error.message.startsWith('Forbidden:')) return { statusCode: 403, body: { error: 'forbidden' } };
  if (error instanceof Error && /not found|not available/i.test(error.message)) return { statusCode: 404, body: { error: 'not_found' } };
  return { statusCode: 500, body: { error: 'internal_error' } };
}
