/**
 * Keeps the suite off the network.
 *
 * Routes now reach NHTSA on a cache miss, which would make unrelated tests depend
 * on a third party being up and turn a 200ms suite into a slow one. The default for
 * every test is therefore "upstream unreachable"; the recall and complaint suites
 * install their own fetchers and call this again afterwards to hand the next suite a
 * known state.
 *
 * Note this is not the same as passing `undefined` to those setters -- that restores
 * the real fetcher, and with it the network.
 */
import { setComplaintFetcherForTesting } from '../src/services/complaintSync.js';
import { setRecallFetcherForTesting } from '../src/services/recallSync.js';

export function goOffline(): void {
  setRecallFetcherForTesting(async () => undefined);
  setComplaintFetcherForTesting(async () => undefined);
}
