import type { ApiErrorBody } from '@caradvocate/shared';

/**
 * Thin fetch wrapper. Every API call in the app goes through this so error
 * handling, JSON encoding and the base path are defined once.
 *
 * Requests are relative, so the Vite dev proxy (see vite.config.ts) forwards
 * them to the API in development and a reverse proxy handles it in production.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: { path: string; message: string }[];

  constructor(status: number, body: ApiErrorBody | undefined, fallback: string) {
    super(body?.error.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error.code ?? 'internal_error';
    this.details = body?.error.details;
  }

}

const BASE = '/api';

/**
 * Supplies the current access token. Set by AuthProvider so this module has no
 * dependency on React or on Supabase -- in dev mode it simply returns undefined
 * and requests go out unauthenticated, which is what the API expects.
 */
let accessTokenGetter: () => string | undefined = () => undefined;

export function setAccessTokenGetter(getter: () => string | undefined): void {
  accessTokenGetter = getter;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = accessTokenGetter();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch (cause) {
    throw new ApiError(0, undefined, 'Could not reach the server. Is the API running?');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : undefined;

  if (!response.ok) {
    throw new ApiError(response.status, parsed as ApiErrorBody, `Request failed (${response.status})`);
  }

  return parsed as T;
}

export const http = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
