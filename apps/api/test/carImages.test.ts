/**
 * The CarImages vehicle photo: response parsing, the origin check, and the route.
 *
 * Three things here are silent failures rather than loud ones, which is why each
 * gets a case:
 *
 *   - An unresolvable vehicle comes back as `{"urls":[null]}`, not an error. Passed
 *     through, that becomes `src="null"` on the <img>.
 *   - The response decides what URL the browser loads on an authenticated page, so
 *     a non-CarImages origin must be dropped rather than forwarded.
 *   - The route must answer 200 with `{}` when there is nothing to show. A 404 or a
 *     500 would put an error state on My Car over a missing decoration.
 */
import {
  firstUrl,
  isCarImagesUrl,
  readExpires,
  setImageFetcherForTesting,
} from '../src/services/carImages.js';
import { check, section } from './assert.js';
import { goOffline } from './offline.js';
import { startTestServer } from './server.js';

/** The shape the signed-URL endpoint returns, captured from their documented example. */
const SIGNED_RESPONSE = {
  urls: [
    'https://carimagesapi.com/image?make=BMW&model=3+Series&year=2022&api_key=ci_x&expires=1741539900&sig=a1b2c3',
  ],
};

export async function run(): Promise<void> {
  section('CarImages vehicle photo');

  /* ------------------------------------------------- reading the response */

  check('a signed URL is read out of the batch response', firstUrl(SIGNED_RESPONSE) === SIGNED_RESPONSE.urls[0]);

  // The documented failure mode: the batch keeps its position and reports null.
  check('an unresolved vehicle yields no URL', firstUrl({ urls: [null] }) === undefined);
  check('an empty batch yields no URL', firstUrl({ urls: [] }) === undefined);
  check('a quota error body yields no URL', firstUrl({ error: 'Monthly quota exceeded' }) === undefined);
  check('a blank string is not a URL', firstUrl({ urls: ['   '] }) === undefined);
  check('a non-object body yields no URL', firstUrl('nope') === undefined);
  check('an absent body yields no URL', firstUrl(undefined) === undefined);

  /* --------------------------------------------------------- origin check */

  check('the API host is accepted', isCarImagesUrl('https://carimagesapi.com/image?make=BMW'));
  check('their edge CDN is accepted', isCarImagesUrl('https://cdn.carimagesapi.com/vehicles/bmw/x5.webp'));
  check('another host is rejected', !isCarImagesUrl('https://evil.example.com/x.webp'));

  // A suffix check written as `includes` or without the dot would accept this.
  check(
    'a lookalike host is rejected',
    !isCarImagesUrl('https://carimagesapi.com.evil.example.com/x.webp'),
  );
  check('plain http is rejected', !isCarImagesUrl('http://carimagesapi.com/image'));
  check('a javascript: URL is rejected', !isCarImagesUrl('javascript:alert(1)'));
  check('a data: URL is rejected', !isCarImagesUrl('data:image/webp;base64,AAAA'));

  // A signed URL that somehow arrives from elsewhere must not reach the page, so
  // the origin check has to hold through the parser and not only on its own.
  check(
    'a foreign URL is dropped by the parser, not just by the checker',
    firstUrl({ urls: ['https://evil.example.com/x.webp'] }) === undefined,
  );

  /* -------------------------------------------------------- expiry parsing */

  // What the cache lifetime is read from. Getting the unit wrong is invisible: too
  // long hands out dead URLs, too short spends the monthly quota on re-resolving.
  check(
    'the expiry stamp is read as seconds, not milliseconds',
    readExpires(SIGNED_RESPONSE.urls[0]) === 1741539900 * 1000,
    `got ${readExpires(SIGNED_RESPONSE.urls[0])}`,
  );
  check('a URL with no stamp has no expiry', readExpires('https://carimagesapi.com/image?make=BMW') === undefined);
  check('a non-numeric stamp has no expiry', readExpires('https://x.test/?expires=soon') === undefined);
  check('a negative stamp has no expiry', readExpires('https://x.test/?expires=-1') === undefined);
  // Read as-is this would land in the year 56000 and never re-resolve again.
  check(
    'a millisecond stamp has no expiry',
    readExpires('https://x.test/?expires=1741539900000') === undefined,
  );
  check('an unparseable URL has no expiry', readExpires('not a url') === undefined);

  /* ------------------------------------------------------------- the route */

  const { request, close } = await startTestServer();

  try {
    // Installed in place of the offline stub, so the route runs its real path.
    setImageFetcherForTesting(async (lookup) => ({
      imageUrl: `https://carimagesapi.com/image?v=${lookup.year}-${lookup.make}-${lookup.model}`,
    }));

    const found = await request('GET', '/api/vehicle/image');
    check('the image endpoint answers 200', found.status === 200, `got ${found.status}`);
    check('it returns an image URL', typeof found.body.imageUrl === 'string');

    // The lookup is the car on file, not anything the client sent. Alex's seeded
    // vehicle is a 2019 Honda Civic.
    check(
      'the vehicle on file is what gets looked up',
      found.body.imageUrl === 'https://carimagesapi.com/image?v=2019-Honda-Civic',
      `got ${found.body.imageUrl}`,
    );

    /* --------------------------- nothing to show is a 200, not an error */

    setImageFetcherForTesting(async () => ({}));

    const empty = await request('GET', '/api/vehicle/image');
    check('an unconfigured or unmatched photo still answers 200', empty.status === 200, `got ${empty.status}`);
    check('with no image URL rather than an error', empty.body.imageUrl === undefined);

    /* ------------------------------------------------------ authorisation */

    // Two owners, two cars -- Alex's Civic and Dana's RAV4. The photo is derived
    // from the caller's own vehicle, so it cannot be pointed at someone else's.
    setImageFetcherForTesting(async (lookup) => ({
      imageUrl: `https://carimagesapi.com/image?v=${lookup.model}`,
    }));

    const dana = await request('GET', '/api/vehicle/image', { as: 'dana@example.com' });
    check('another owner gets their own car', dana.status === 200, `got ${dana.status}`);
    check(
      "and not the first owner's",
      dana.body.imageUrl === 'https://carimagesapi.com/image?v=RAV4',
      `got ${dana.body.imageUrl}`,
    );
  } finally {
    goOffline();
    await close();
  }
}
