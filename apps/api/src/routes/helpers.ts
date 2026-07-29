import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import type { Database } from '../db/index.js';
import { vehicles } from '../db/schema.js';
import { HttpError } from '../lib/httpError.js';
import { userIdOf } from '../middleware/currentUser.js';

/**
 * Loads the requesting user's vehicle.
 *
 * Every vehicle-scoped read goes through here rather than querying by vehicle id
 * from the client, which is what keeps one user from naming another user's car.
 * The app is single-vehicle today; when it grows, this takes an explicit id and
 * keeps the `and(eq(id), eq(userId))` pairing.
 */
export async function requireOwnVehicle(req: Request) {
  const db: Database = req.db;
  const userId = userIdOf(req);

  const [row] = await db.select().from(vehicles).where(eq(vehicles.userId, userId)).limit(1);
  if (!row) throw HttpError.notFound('No vehicle on file for this account');
  return row;
}

/**
 * Reads a route parameter as a string.
 *
 * Express 5 types params as `string | string[]` because a path can repeat a name.
 * Ours never do, so this narrows and fails loudly rather than pushing the union
 * into every query.
 */
export function stringParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw new HttpError('validation_failed', `Expected a single ${name} in the path`);
  }
  return value;
}

