/**
 * A GET against a vendor's JSON API, with a deadline, answering `undefined` for anything that
 * is not a usable body.
 *
 * The deadline deliberately spans reading the body as well as the response head. A vendor that
 * accepts the connection and then dribbles bytes is exactly the hang this guards against, and
 * clearing the timer once the headers land would leave that case uncovered.
 *
 * Every failure collapses to `undefined` -- offline, blocked, timed out, a non-2xx, or a body
 * that is not JSON. That suits the callers who only need "did we get an answer": the sync
 * record is what tracks whether a check actually succeeded, so the reason is not load-bearing.
 * Vendors whose status codes *are* load-bearing keep their own fetch and map the codes onto a
 * discriminated union -- see `vehicleDatabases.ts` and `openLaborProject.ts`.
 */
export async function fetchJson(url: string | URL, timeoutMs: number): Promise<unknown | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
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
