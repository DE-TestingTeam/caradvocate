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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Sends the session cookie once real auth is in place.
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
