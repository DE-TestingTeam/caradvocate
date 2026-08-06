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

/**
 * POSTs and reads a server-sent event stream, calling `onEvent` for each one.
 *
 * Separate from `request` because the response is consumed as it arrives rather than parsed at
 * the end -- but everything before the first byte behaves identically, so a 401, a 402 from the
 * paid gate or a 404 for "no vehicle on file" still rejects with an `ApiError` and the status
 * callers branch on. Errors raised *after* the stream opens cannot use that channel; the
 * endpoint reports those as events instead (see routes/chat.ts).
 */
async function stream(
  path: string,
  body: unknown,
  onEvent: (event: string, data: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  const token = accessTokenGetter();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (cause) {
    if (signal?.aborted) return;
    throw new ApiError(0, undefined, 'Could not reach the server. Is the API running?');
  }

  if (!response.ok) {
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as ApiErrorBody) : undefined;
    throw new ApiError(response.status, parsed, `Request failed (${response.status})`);
  }
  if (!response.body) throw new ApiError(0, undefined, 'The server sent an empty response.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line; a partial one stays in the buffer for next read.
      let split = buffer.indexOf('\n\n');
      while (split !== -1) {
        emit(buffer.slice(0, split), onEvent);
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf('\n\n');
      }
    }
  } catch (cause) {
    // An abort mid-stream is the caller leaving, not a failure worth surfacing.
    if (!signal?.aborted) throw new ApiError(0, undefined, 'The connection dropped mid-answer.');
  } finally {
    reader.releaseLock();
  }
}

/** Turns one `event:`/`data:` frame into a callback. A frame we cannot read is skipped. */
function emit(frame: string, onEvent: (event: string, data: unknown) => void): void {
  let name = 'message';
  const data: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }

  if (data.length === 0) return;
  try {
    onEvent(name, JSON.parse(data.join('\n')));
  } catch {
    // Malformed frame. Dropping it is right: the endpoint always sends a final `message`.
  }
}

export const http = {
  get: <T>(path: string) => request<T>('GET', path),
  stream,
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
