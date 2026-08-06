/** Error envelope every non-2xx API response uses. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Field-level detail, present on validation failures. */
    details?: { path: string; message: string }[];
  };
}

export type ApiErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'not_found'
  | 'conflict'
  /** The caller has not unlocked a paid feature. See PaywallStatus. */
  | 'payment_required'
  /** Too many requests in too short a window. Only Ask CA throttles today. */
  | 'rate_limited'
  | 'internal_error';

export const httpStatusForCode: Record<ApiErrorCode, number> = {
  validation_failed: 422,
  unauthenticated: 401,
  not_found: 404,
  conflict: 409,
  payment_required: 402,
  rate_limited: 429,
  internal_error: 500,
};
