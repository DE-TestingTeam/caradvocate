/**
 * VIN decoding via NHTSA's free vPIC API.
 *
 * Verified against the live service:
 *
 *   curl 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/2HGFC2F53KH124821?format=json'
 *
 * The documented shape held up: `{ Results: [ { Make, Model, ModelYear, Trim, ... } ] }`,
 * 154 fields, `ModelYear` as a *string*, and empty strings rather than nulls for
 * anything vPIC could not determine.
 *
 * Two things the live check settled that the docs did not:
 *
 *   - **An undecodable VIN is a 200, not an error.** Garbage in yields a full row
 *     with every field empty. That is why the "no make and no model" test below is
 *     what detects failure -- there is no status code to key off.
 *   - **`ErrorCode` is unreliable as a gate.** A valid, fully decoded VIN can still
 *     come back with `ErrorCode: '1'` ("check digit does not calculate properly"),
 *     and it arrives comma-joined ("6,7") when several apply. Rejecting on a
 *     non-zero code would throw away good decodes, so it is deliberately ignored.
 *
 * Everything here is defensive regardless: an unexpected shape, a missing field, a
 * timeout or a non-200 all resolve to `undefined`, and the UI falls back to manual
 * entry. A degraded decode cannot break onboarding.
 */
import type { DecodedVin } from '@caradvocate/shared';
import { HttpError } from '../lib/httpError.js';

const VPIC_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues';
const TIMEOUT_MS = 6000;

export async function decodeVin(vin: string): Promise<DecodedVin> {
  const raw = await fetchVpic(vin);
  const decoded = raw ? parseVpicResponse(vin, raw) : { vin };

  // A decode that yields neither make nor model is no more useful than nothing;
  // say so plainly so the client shows the manual form instead of empty fields.
  if (!decoded.make && !decoded.model) {
    throw HttpError.notFound('Could not decode that VIN. Enter the details manually.');
  }

  return decoded;
}

async function fetchVpic(vin: string): Promise<unknown | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${VPIC_BASE}/${encodeURIComponent(vin)}?format=json`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return undefined;
    return (await response.json()) as unknown;
  } catch {
    // Offline, blocked, slow, or malformed JSON. All the same to the caller.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Exported for testing. vPIC returns `{ Results: [ { Make, Model, ModelYear, ... } ] }`
 * with empty strings (not nulls) for fields it cannot determine -- confirmed against
 * the live service, where `Series` came back as `''` on a car that has no series.
 */
export function parseVpicResponse(vin: string, body: unknown): DecodedVin {
  const result = firstResult(body);
  if (!result) return { vin };

  return {
    vin,
    year: readYear(result),
    make: readString(result, 'Make'),
    model: readString(result, 'Model'),
    trim: readString(result, 'Trim') ?? readString(result, 'Series'),
  };
}

function firstResult(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const results = (body as Record<string, unknown>).Results;
  if (!Array.isArray(results) || results.length === 0) return undefined;
  const first = results[0];
  return first && typeof first === 'object' ? (first as Record<string, unknown>) : undefined;
}

function readString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  // vPIC uses empty strings, and occasionally "Not Applicable", for unknowns.
  if (!trimmed || /^not applicable$/i.test(trimmed)) return undefined;
  return trimmed;
}

function readYear(row: Record<string, unknown>): number | undefined {
  const raw = row.ModelYear;
  const value = typeof raw === 'number' ? raw : Number(readString(row, 'ModelYear'));
  if (!Number.isInteger(value)) return undefined;
  // Guard against a decoded year that cannot be real.
  if (value < 1900 || value > new Date().getFullYear() + 2) return undefined;
  return value;
}
