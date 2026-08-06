/**
 * The studio photo of the owner's model on My Car, from CarImages (carimagesapi.com).
 *
 * Resolved server-side rather than with their browser loader, which would put the API
 * key in the bundle and a third-party script with a whole-document MutationObserver on
 * an authenticated page. Only a signed, expiring URL reaches the browser.
 *
 * A timeout, non-200 or unexpected shape yields no image rather than throwing -- this is
 * decoration on a page about recalls and must never be able to break it.
 *
 * Note the endpoint returns a URL and nothing else, so a real photo of this generation
 * and the generic placeholder CarImages substitutes for a vehicle it has nothing for are
 * indistinguishable from here; an unknown car returns a valid 200. Nothing in this
 * module or the UI claims the photo is the owner's actual car.
 */
import type { VehicleImage } from '@caradvocate/shared';
import { env } from '../env.js';

const SIGNED_URLS = 'https://carimagesapi.com/api/v1/signed-urls';
const TIMEOUT_MS = 6000;

/**
 * Measured, not assumed: `width` IS honoured, in tiers rather than exactly. 400 returns
 * 375x250, 600 and 800 both return the same middle tier, and 1200 returns 1125x750. This asks
 * for the largest because the photo runs full width on a phone, where a 1125px asset is about
 * what a 2x screen wants; on a laptop it sits at half the column and is oversized, which costs
 * bytes rather than correctness.
 */
const IMAGE_WIDTH = 1200;

/**
 * webp, and it already carries an alpha channel -- the returned image is RGBA with a fully
 * transparent background, so the car sits on the page rather than in a box. Verified against
 * the live endpoint rather than inferred: the corner pixel comes back (0,0,0,0).
 *
 * The account is on a paid plan, so PNG and JPG are available too, but neither is worth taking.
 * PNG is the same picture with the same transparency at 632KB against 141KB, and JPG cannot
 * hold an alpha channel at all.
 */
const IMAGE_FORMAT = 'webp';

export interface ImageLookup {
  year: number;
  make: string;
  model: string;
}

/** True when an image can be resolved at all. */
export function carImagesIsConfigured(): boolean {
  return Boolean(env.CARIMAGES_API_KEY);
}

/* ------------------------------------------------------------------- cache */

// Every resolve counts one request against a monthly quota (5,000 free, 25,000 Pro) and My Car
// asks on every visit, so one owner reloading could spend the free month.
//
// Keyed on year/make/model rather than vehicle id: the photo describes a generation, so every
// owner of a 2019 Civic shares one entry. In-process, since this is a quota optimisation rather
// than correctness.

/** How long a URL is trusted when its own expiry stamp cannot be read. */
const FALLBACK_LIFETIME_MS = 60_000;

/** Re-resolve this far before the URL expires, so one is never handed out dead. */
const EXPIRY_MARGIN_MS = 30_000;

/** Bound so a long-lived process cannot grow one entry per generation ever asked for. */
const MAX_ENTRIES = 200;

interface CacheEntry {
  image: VehicleImage;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(lookup: ImageLookup): string {
  return `${lookup.year}|${lookup.make.trim().toLowerCase()}|${lookup.model.trim().toLowerCase()}`;
}

/**
 * The signed image URL for one vehicle. Never rejects: an empty object means the owner
 * sees the placeholder, whatever the reason. See the VehicleImage contract.
 */
export async function fetchVehicleImage(lookup: ImageLookup): Promise<VehicleImage> {
  if (!carImagesIsConfigured()) return {};

  const key = cacheKey(lookup);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.image;

  const imageUrl = await requestImageUrl(lookup);

  // Deliberately not cached: a timeout or a 503 would otherwise persist as a missing
  // image for the whole cache lifetime, up to a day.
  if (!imageUrl) return {};

  remember(key, imageUrl);
  return { imageUrl };
}

/** Caches one resolved URL, unless it is already too near expiry to be worth holding. */
function remember(key: string, imageUrl: string): void {
  const expiresAt = softExpiry(imageUrl);

  // Already inside the margin. Storing this would serve a URL that expires before the
  // browser fetches it.
  if (expiresAt <= Date.now()) {
    cache.delete(key);
    return;
  }

  // Insertion-ordered, so the first key is the oldest. One eviction per write holds the
  // bound, since each write adds one.
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }

  cache.set(key, { image: { imageUrl }, expiresAt });
}

/**
 * When to stop trusting a URL: the `expires` stamp CarImages signs into it, less a
 * margin for the round trip and the browser's own fetch. Read rather than hardcoded
 * because the lifetime is their choice to change -- observed live, stamps land on the
 * next UTC midnight. Near that boundary this returns a time already past and `remember`
 * declines to cache. A URL with no readable stamp falls back to FALLBACK_LIFETIME_MS.
 */
function softExpiry(url: string): number {
  const stamp = readExpires(url);
  if (stamp === undefined) return Date.now() + FALLBACK_LIFETIME_MS;
  return stamp - EXPIRY_MARGIN_MS;
}

/**
 * The largest value still plausible as a seconds stamp (the year 2286). Anything above
 * it is milliseconds, which would disable re-resolution for the life of the process.
 */
const MAX_EXPIRES_SECONDS = 10_000_000_000;

/**
 * Exported for testing. The `expires` query param as epoch milliseconds, or
 * undefined if absent or junk.
 */
export function readExpires(url: string): number | undefined {
  let raw: string | null;
  try {
    raw = new URL(url).searchParams.get('expires');
  } catch {
    return undefined;
  }

  if (!raw) return undefined;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_EXPIRES_SECONDS) return undefined;
  return seconds * 1000;
}

/**
 * The signed image URL. CarImages fuzzy-matches make/model/year -- accent- and
 * case-insensitive, ignores hyphens and word order, picks the closest generation. That
 * matters because ours come from NHTSA's VIN decode as `NISSAN`, not `Nissan`.
 */
async function requestImageUrl(lookup: ImageLookup): Promise<string | undefined> {
  const body = await postSignedUrls({
    images: [
      {
        make: lookup.make,
        model: lookup.model,
        year: String(lookup.year),
        width: String(IMAGE_WIDTH),
        format: IMAGE_FORMAT,
      },
    ],
  });

  return firstUrl(body);
}

/**
 * Exported for testing. The endpoint answers `{ urls: [...] }`, and a vehicle it
 * could not resolve comes back as a null or absent entry rather than an error.
 */
export function firstUrl(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const urls = (body as Record<string, unknown>).urls;
  if (!Array.isArray(urls)) return undefined;

  const [first] = urls;
  if (typeof first !== 'string' || !first.trim()) return undefined;

  // This becomes an <img src> on an authenticated page, so an unexpected origin is
  // dropped rather than forwarded.
  return isCarImagesUrl(first) ? first : undefined;
}

/** Exported for testing. Their signed URLs point at the API host or its edge CDN. */
export function isCarImagesUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    return url.hostname === 'carimagesapi.com' || url.hostname.endsWith('.carimagesapi.com');
  } catch {
    return false;
  }
}

/**
 * One batch request. `undefined` on any failure, including a 429 -- the signed-URL
 * endpoint returns a JSON error when the monthly quota runs out rather than the
 * placeholder image the plain /image endpoint serves.
 */
async function postSignedUrls(payload: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const url = `${SIGNED_URLS}?api_key=${encodeURIComponent(env.CARIMAGES_API_KEY ?? '')}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // In the header rather than the query string, so the secret stays out of their
        // access logs and ours. Only needed when the key has a domain allowlist.
        ...(env.CARIMAGES_API_SECRET ? { 'X-Api-Secret': env.CARIMAGES_API_SECRET } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // A wrong key, a revoked secret and an exhausted quota otherwise present as a
      // silently missing image.
      console.warn(`CarImages: signed-urls answered ${response.status}`);
      return undefined;
    }

    return (await response.json()) as unknown;
  } catch {
    // Offline, blocked, slow, or malformed JSON. All the same to the caller.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
