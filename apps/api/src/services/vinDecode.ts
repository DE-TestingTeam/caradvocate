/**
 * VIN decoding via NHTSA's free vPIC API, which answers
 * `{ Results: [ { Make, Model, ModelYear, Trim, ... } ] }` with `ModelYear` as a string and
 * empty strings rather than nulls for anything it could not determine.
 *
 * Two things the live service settled that the docs did not. An undecodable VIN is a 200, not
 * an error -- garbage in yields a full row with every field empty, which is why the "no make
 * and no model" test below is what detects failure. And `ErrorCode` is unreliable as a gate: a
 * fully decoded VIN can carry `ErrorCode: '1'`, and several arrive comma-joined ("6,7"), so
 * rejecting on a non-zero code would throw away good decodes.
 *
 * Defensive throughout: an unexpected shape, a timeout or a non-200 all resolve to
 * `undefined` and the UI falls back to manual entry.
 */
import type { DecodedVin } from '@caradvocate/shared';
import { fetchJson } from '../lib/fetchJson.js';
import { HttpError } from '../lib/httpError.js';

const VPIC_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues';
const TIMEOUT_MS = 6000;

export async function decodeVin(vin: string): Promise<DecodedVin> {
  const raw = await fetchVpic(vin);
  const decoded = raw ? parseVpicResponse(vin, raw) : { vin };

  // Neither make nor model is no more useful than nothing, so say so and let the client show
  // the manual form instead of empty fields.
  if (!decoded.make && !decoded.model) {
    throw HttpError.notFound('Could not decode that VIN. Enter the details manually.');
  }

  return decoded;
}

async function fetchVpic(vin: string): Promise<unknown | undefined> {
  return fetchJson(`${VPIC_BASE}/${encodeURIComponent(vin)}?format=json`, TIMEOUT_MS);
}

/** Exported for testing. */
export function parseVpicResponse(vin: string, body: unknown): DecodedVin {
  const result = firstResult(body);
  if (!result) return { vin };

  const model = readString(result, 'Model');

  return {
    vin,
    year: readYear(result),
    make: readString(result, 'Make'),
    model,
    // `Series` is a fallback rather than a synonym: when vPIC has no trim it often repeats
    // the model there, so a 2011 Pathfinder decodes with Series "Pathfinder". Storing that
    // gives "2011 NISSAN Pathfinder Pathfinder" everywhere the name is shown, so a trim that
    // only echoes the model is dropped as the absent trim it actually is.
    trim: readTrim(result, model),
  };
}

/** The real trim, or undefined when vPIC only offered the model name back. */
function readTrim(
  result: Record<string, unknown>,
  model: string | undefined,
): string | undefined {
  const trim = readString(result, 'Trim') ?? readString(result, 'Series');
  if (trim === undefined) return undefined;
  if (model !== undefined && trim.toLowerCase() === model.trim().toLowerCase()) return undefined;
  return trim;
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
