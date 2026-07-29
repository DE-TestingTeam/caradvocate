import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@caradvocate/shared';
import { HttpError } from '../lib/httpError.js';
import { env } from '../env.js';

/** 404 for unmatched routes, so the client always gets the standard envelope. */
export function notFoundHandler(_req: Request, res: Response): void {
  const body: ApiErrorBody = { error: { code: 'not_found', message: 'No such endpoint' } };
  res.status(404).json(body);
}

/** Terminal error handler. Must be mounted last and must keep all four params. */
export function errorHandler() {
  return (error: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof HttpError) {
      const body: ApiErrorBody = {
        error: { code: error.code, message: error.message, details: error.details },
      };
      res.status(error.status).json(body);
      return;
    }

    // Anything unrecognised is a bug: log it server-side, tell the client nothing.
    if (env.NODE_ENV !== 'test') console.error('Unhandled error:', error);
    const body: ApiErrorBody = {
      error: { code: 'internal_error', message: 'Something went wrong' },
    };
    res.status(500).json(body);
  };
}
