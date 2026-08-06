/**
 * Thin fetch wrapper, so error handling, JSON encoding and the base path are defined once.
 * Requests are relative: the Vite dev proxy forwards them in development, a reverse proxy in
 * production.
 */
import type { ApiErrorBody } from '@caradvocate/shared';

/**
 * Every rejection from `http` is one of these. `status` is the HTTP status, or `0` when the
 * request never got a response at all -- callers that branch on a status (RequireVehicle treats
 * 404 as "no vehicle yet") must not mistake an offline browser for a real answer.
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

let accessTokenGetter: () => string | undefined = () => undefined;

/**
 * Supplies the token for every subsequent request. Called by AuthProvider, which keeps this module
 * free of any dependency on React or Supabase. Until it is called -- and after sign-out -- requests
 * go out unauthenticated and the API answers 401.
 */
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
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
