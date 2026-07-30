/**
 * The studio photo of the owner's model on My Car, from CarImages
 * (carimagesapi.com).
 *
 * Verified against the live service:
 *
 *   curl -X POST 'https://carimagesapi.com/api/v1/signed-urls?api_key=KEY' \
 *     -H 'Content-Type: application/json' \
 *     -d '{"images":[{"make":"Honda","model":"Civic","year":"2019","width":"1200","format":"webp"}]}'
 *
 * ===================== WHY THIS RUNS SERVER-SIDE ============================
 * CarImages ships a browser loader that takes the API key in a script tag and is
 * protected by a domain allowlist. That is their design and it is sound, but it
 * puts a credential in the bundle and a third-party script with a whole-document
 * MutationObserver on an authenticated page. Resolving here instead means nothing
 * about the account reaches the browser -- only a signed, expiring URL.
 *
 * The API secret is optional and only matters if a domain allowlist is ever set on
 * the key. Verified against the live service: with no allowlist, the signed-URL
 * endpoint answers a keyed server-side call that sends no Origin or Referer at
 * all. Set an allowlist in their dashboard and those calls start failing 403 --
 * that is what CARIMAGES_API_SECRET is there to fix, by proving key ownership.
 * (The catalogue endpoints under /api/v1 do demand it unconditionally, but nothing
 * here uses them.)
 * ============================================================================
 *
 * Defensive in the same way as recalls.ts and safetyRatings.ts: a timeout, a
 * non-200 or an unexpected shape yields no image rather than throwing. This is
 * decoration on a page about recalls and it must never be able to break it.
 *
 * ============================ WHAT IT CANNOT TELL YOU ========================
 * The signed-URL endpoint returns a URL and nothing else, so two outcomes are
 * indistinguishable from here: a real photo of this generation, and the generic
 * placeholder CarImages substitutes for a vehicle it has nothing for. It does not
 * error on an unknown car -- asking for a 1974 Bricklin SV-1 returns a perfectly
 * valid 200. Nothing in this module or the UI claims the photo is the owner's
 * actual car; see the caption in the component.
 * ============================================================================
 */
import type { VehicleImage } from '@caradvocate/shared';
import { env } from '../env.js';

const SIGNED_URLS = 'https://carimagesapi.com/api/v1/signed-urls';
const TIMEOUT_MS = 6000;

/**
 * 1200 is the largest size before `full`, and every vehicle tried comes back at
 * 1125x750 regardless -- see the note on the 3:2 frame in the component. The
 * viewer is a hero at most one column wide, so this is comfortably above what any
 * display needs.
 */
const IMAGE_WIDTH = 1200;

/**
 * WebP because it is the only format the free plan serves. Paid plans add PNG
 * (transparent) and JPG; PNG would be worth revisiting if the image ever needs to
 * sit on a coloured background rather than in its own frame.
 */
const IMAGE_FORMAT = 'webp';

export interface ImageLookup {
  year: number;
  make: string;
  model: string;
}

/** Test seam, mirroring setRecallFetcherForTesting. The suite must never call out. */
type ImageFetcher = (lookup: ImageLookup) => Promise<VehicleImage>;

let fetcher: ImageFetcher | undefined;

export function setImageFetcherForTesting(next: ImageFetcher | undefined): void {
  fetcher = next;
}

/**
 * True when an image can be resolved at all.
 *
 * An installed test fetcher counts, for the same reason as askIsConfigured: no key
 * is set in tests, so without this the suite could never reach the real route.
 */
export function carImagesIsConfigured(): boolean {
  return Boolean(fetcher) || Boolean(env.CARIMAGES_API_KEY);
}

/* ------------------------------------------------------------------- cache ---
 * Every resolve counts one request against a monthly quota -- 5,000 on the free
 * plan, 25,000 on Pro -- and My Car asks on every visit. Without this, one owner
 * reloading their own car would spend the free month on it.
 *
 * Keyed on year/make/model rather than vehicle id: the photo describes a
 * generation, so every owner of a 2019 Civic shares one entry.
 *
 * In-process and therefore per-instance. That is the right size for this: it is a
 * quota optimisation, not correctness, and a shared cache would mean handing a
 * signed URL to a second process that may serve it past its usefulness.
 */

/** How long a URL is trusted when its own expiry stamp cannot be read. */
const FALLBACK_LIFETIME_MS = 60_000;

/** Re-resolve this far before the URL expires, so one is never handed out dead. */
const EXPIRY_MARGIN_MS = 30_000;

/**
 * Bound so a long-lived process cannot grow one entry per generation ever asked
 * for. Far above the single-vehicle app's needs; small enough to stay trivial.
 */
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
 * The signed image URL for one vehicle.
 *
 * Never rejects. An empty object means the owner sees the placeholder, which is
 * the same outcome for "not configured", "no match" and "CarImages is down" --
 * see the VehicleImage contract in the shared package.
 */
export async function fetchVehicleImage(lookup: ImageLookup): Promise<VehicleImage> {
  if (fetcher) return fetcher(lookup);
  if (!carImagesIsConfigured()) return {};

  const key = cacheKey(lookup);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.image;

  const imageUrl = await requestImageUrl(lookup);

  // Deliberately not cached: a timeout or a 503 would otherwise persist as a
  // missing image for the whole cache lifetime, which is up to a day.
  if (!imageUrl) return {};

  remember(key, imageUrl);
  return { imageUrl };
}

/** Caches one resolved URL, unless it is already too near expiry to be worth holding. */
function remember(key: string, imageUrl: string): void {
  const expiresAt = softExpiry(imageUrl);

  // Already inside the margin -- see softExpiry. Storing this would serve a URL
  // that expires before the browser fetches it, and a re-resolve costs one request.
  if (expiresAt <= Date.now()) {
    cache.delete(key);
    return;
  }

  // Insertion-ordered, so the first key is the oldest. Evicting one per write is
  // enough to hold the bound, since each write adds one.
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }

  cache.set(key, { image: { imageUrl }, expiresAt });
}

/**
 * When to stop trusting a URL.
 *
 * Read from the `expires` stamp CarImages signs into it rather than assumed,
 * because guessing long would hand out a dead link and guessing short would waste
 * the quota this cache exists to protect, less a margin for the round trip and the
 * browser's own fetch.
 *
 * Observed live, their stamps land on the next UTC midnight rather than minutes
 * out -- which is why this is read and not hardcoded, since that is their choice to
 * change. The one consequence worth naming: in the last seconds before that
 * boundary this returns a time already past, and `remember` declines to cache
 * rather than hand out a URL that dies on the way to the browser.
 *
 * A URL with no readable stamp falls back to FALLBACK_LIFETIME_MS.
 */
function softExpiry(url: string): number {
  const stamp = readExpires(url);
  if (stamp === undefined) return Date.now() + FALLBACK_LIFETIME_MS;
  return stamp - EXPIRY_MARGIN_MS;
}

/**
 * The largest value still plausible as a seconds stamp -- the year 2286. Anything
 * above it is a millisecond value, which would read as the year 56000 and disable
 * re-resolution for the life of the process.
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
 * The signed image URL.
 *
 * Make, model and year go up as strings and CarImages fuzzy-matches them: it is
 * accent- and case-insensitive, ignores hyphens and word order, and picks the
 * closest generation to the year. That matters because our make and model come
 * from NHTSA's VIN decode in whatever casing NHTSA used -- `NISSAN`, not `Nissan`.
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

  // Only ever CarImages' own hosts. This value becomes an <img src> on an
  // authenticated page, so an unexpected origin is dropped rather than forwarded.
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
        // Only when set, and in the header rather than the query string so the
        // secret stays out of their access logs and ours. See the note on the env
        // var: not required unless a domain allowlist is configured on the key.
        ...(env.CARIMAGES_API_SECRET ? { 'X-Api-Secret': env.CARIMAGES_API_SECRET } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Worth a line: a wrong key, a revoked secret and an exhausted quota all
      // present as a silently missing image otherwise.
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
