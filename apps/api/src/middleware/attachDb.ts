import type { NextFunction, Request, Response } from 'express';
import type { Database } from '../db/index.js';

/**
 * Puts the database on the request so tests can inject their own instead of the real pool.
 * Route handlers read `req.db` and never import the singleton.
 */
export function attachDb(db: Database) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.db = db;
    next();
  };
}
