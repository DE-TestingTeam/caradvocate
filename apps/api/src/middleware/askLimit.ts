/**
 * Throttles Ask CA per owner.
 *
 * Every other endpoint reads the database. This one calls a paid model, so it is the only place
 * where a stuck retry loop, a held-down key, or a script holding a valid token turns directly
 * into a bill. Two limits, because they stop different things:
 *
 *   - a burst limit, so one owner cannot fire a hundred questions in a minute;
 *   - one answer in flight at a time, which is the case a burst limit alone misses. A tab that
 *     retries on every failure can keep several calls open at once without ever exceeding a
 *     per-minute count, and each one is being paid for.
 *
 * Deliberately in memory, and that is a real limitation: the counters reset when the API
 * restarts and are per-process, so two instances behind a load balancer allow two windows each.
 * That is honest for a prototype running one process -- it is a cost guard, not a security
 * boundary, and a real deployment wants this in Postgres or Redis. It is written down here
 * rather than discovered later.
 */
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/httpError.js';
import { userIdOf } from './currentUser.js';

/** Generous for a person, tight for a loop. A real conversation is a handful of turns. */
const MAX_IN_WINDOW = 20;
const WINDOW_MS = 5 * 60 * 1000;

/**
 * Stale entries are swept when the map grows past this, rather than on a timer -- an interval
 * would keep the process alive and needs tearing down in tests and on shutdown.
 */
const SWEEP_AT = 500;

interface Bucket {
  /** Timestamps of recent requests, oldest first. Trimmed to the window on each check. */
  recent: number[];
  inFlight: boolean;
}

const buckets = new Map<string, Bucket>();

export function askLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = userIdOf(req);
  const now = Date.now();

  if (buckets.size > SWEEP_AT) sweep(now);

  const bucket = buckets.get(userId) ?? { recent: [], inFlight: false };
  buckets.set(userId, bucket);

  if (bucket.inFlight) {
    throw HttpError.rateLimited('Still answering your last question. Give it a moment.');
  }

  bucket.recent = bucket.recent.filter((at) => now - at < WINDOW_MS);
  if (bucket.recent.length >= MAX_IN_WINDOW) {
    const waitMs = WINDOW_MS - (now - bucket.recent[0]);
    const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
    throw HttpError.rateLimited(
      `That is a lot of questions in a short time. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    );
  }

  bucket.recent.push(now);
  bucket.inFlight = true;

  // 'close' fires on a completed response and on a dropped connection alike, which is what we
  // want: either way this owner no longer has an answer in flight. 'finish' alone would leak the
  // slot when someone closes the tab mid-answer.
  res.once('close', () => {
    bucket.inFlight = false;
  });

  next();
}

/** Drops owners with nothing recent. Called on growth, so it costs nothing in the common case. */
function sweep(now: number): void {
  for (const [userId, bucket] of buckets) {
    if (bucket.inFlight) continue;
    if (bucket.recent.every((at) => now - at >= WINDOW_MS)) buckets.delete(userId);
  }
}
