import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { HttpError } from '../lib/httpError.js';

/**
 * Validates and replaces `req.body`. Handlers downstream get a parsed, typed
 * body and never re-check it.
 */
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body) as z.infer<S>;
      next();
    } catch (error) {
      next(toHttpError(error));
    }
  };
}

/** Validates a single route param, e.g. that :id is a uuid. */
export function validateParams<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      schema.parse(req.params);
      next();
    } catch (error) {
      next(toHttpError(error));
    }
  };
}

function toHttpError(error: unknown): unknown {
  if (!(error instanceof ZodError)) return error;
  return new HttpError(
    'validation_failed',
    'Request body failed validation',
    error.issues.map((issue) => ({ path: issue.path.join('.') || '(root)', message: issue.message })),
  );
}
