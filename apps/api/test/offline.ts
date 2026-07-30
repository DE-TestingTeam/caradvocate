/**
 * Keeps the suite off the network.
 *
 * Routes now reach NHTSA and CarImages on a cache miss, which would make unrelated
 * tests depend on a third party being up and turn a 200ms suite into a slow one. The
 * default for every test is therefore "upstream unreachable"; the recall, complaint
 * and photo suites install their own fetchers and call this again afterwards to hand
 * the next suite a known state.
 *
 * Note this is not the same as passing `undefined` to those setters -- that restores
 * the real fetcher, and with it the network.
 */
import { setImageFetcherForTesting } from '../src/services/carImages.js';
import { setComplaintFetcherForTesting } from '../src/services/complaintSync.js';
import { setRecallFetcherForTesting } from '../src/services/recallSync.js';
import { setSafetyRatingFetcherForTesting } from '../src/services/safetyRatingSync.js';

export function goOffline(): void {
  setRecallFetcherForTesting(async () => undefined);
  setComplaintFetcherForTesting(async () => undefined);
  setSafetyRatingFetcherForTesting(async () => undefined);
  // Empty rather than undefined: the image's "nothing to show" is `{}`, and the
  // route must be reachable in tests without a CarImages key.
  setImageFetcherForTesting(async () => ({}));
}
