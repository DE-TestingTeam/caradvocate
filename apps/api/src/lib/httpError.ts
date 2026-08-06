import { httpStatusForCode, type ApiErrorCode } from '@caradvocate/shared';

/** Throw this from anywhere in a route; the error handler turns it into a response. */
export class HttpError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: { path: string; message: string }[];

  constructor(code: ApiErrorCode, message: string, details?: { path: string; message: string }[]) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = httpStatusForCode[code];
    this.details = details;
  }

  static notFound(message = 'Not found'): HttpError {
    return new HttpError('not_found', message);
  }

  static unauthenticated(message = 'Not authenticated'): HttpError {
    return new HttpError('unauthenticated', message);
  }

  static conflict(message: string): HttpError {
    return new HttpError('conflict', message);
  }

  /** A paid feature the caller has not unlocked. 402, so the client can offer the paywall. */
  static paymentRequired(message = 'This feature has not been unlocked'): HttpError {
    return new HttpError('payment_required', message);
  }

  /** Too many requests. 429, and the message is shown to the owner, so it says what to do. */
  static rateLimited(message: string): HttpError {
    return new HttpError('rate_limited', message);
  }
}
