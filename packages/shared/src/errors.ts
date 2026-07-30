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
  | 'internal_error';

export const httpStatusForCode: Record<ApiErrorCode, number> = {
  validation_failed: 422,
  unauthenticated: 401,
  not_found: 404,
  conflict: 409,
  payment_required: 402,
  internal_error: 500,
};
