import * as React from 'react';

/**
 * Global revision counter. Mutations bump it; every useApi() query re-runs.
 * Crude but adequate for a mock-backed prototype -- replace with React Query or
 * SWR when the real API lands.
 */
const listeners = new Set<() => void>();
let revision = 0;

export function invalidateAll(): void {
  revision += 1;
  listeners.forEach((fn) => fn());
}

function useRevision(): number {
  const [, force] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, [force]);
  return revision;
}

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
}

/**
 * Runs an api.ts function and tracks loading/error state.
 * `deps` should contain anything the fetcher closes over (e.g. a route param).
 *
 * The fetcher is held in a ref rather than a dependency: callers pass either a
 * stable import (identity never changes, so it cannot drive the effect) or a
 * fresh arrow function every render (identity always changes, which would loop).
 * `deps` plus the revision counter are the real triggers.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []): AsyncState<T> {
  const rev = useRevision();
  const [state, setState] = React.useState<AsyncState<T>>({
    data: undefined,
    loading: true,
    error: undefined,
  });

  const fetcherRef = React.useRef(fetcher);
  React.useEffect(() => {
    fetcherRef.current = fetcher;
  });

  React.useEffect(() => {
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: undefined }));

    fetcherRef.current().then(
      (data) => {
        if (active) setState({ data, loading: false, error: undefined });
      },
      (error: Error) => {
        if (active) setState({ data: undefined, loading: false, error });
      },
    );

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, ...deps]);

  return state;
}
