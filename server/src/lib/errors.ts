/**
 * Error taxonomy for the pipeline.
 *
 * Every failure the client can act on is an `EngineError` with a stable `code`
 * so the mobile app can branch (retry, upgrade prompt, "captions unavailable")
 * without string-matching English messages.
 */

import {noteBillingFailure} from './billingGuard.ts';

export type EngineErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'not_found'
  | 'not_configured'
  | 'source_unreachable'
  | 'source_too_long'
  | 'source_too_large'
  | 'no_speech_detected'
  | 'transcribe_failed'
  | 'broll_failed'
  | 'render_failed'
  | 'matting_failed'
  | 'pro_required'
  | 'entitlement_unavailable'
  | 'style_unavailable'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'upstream_timeout'
  | 'billing_blocked'
  | 'ai_direction_failed'
  | 'internal';

const STATUS_BY_CODE: Record<EngineErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  not_configured: 503,
  source_unreachable: 422,
  source_too_long: 413,
  source_too_large: 413,
  no_speech_detected: 422,
  transcribe_failed: 502,
  broll_failed: 502,
  render_failed: 502,
  matting_failed: 502,
  /** The creator's plan does not include this feature (server-verified, never client-supplied). */
  pro_required: 403,
  /** No trusted source could confirm the plan, so paid work is refused (fail closed). */
  entitlement_unavailable: 503,
  /** The edit style exists but cannot be started right now (catalog `available: false`). */
  style_unavailable: 409,
  quota_exceeded: 429,
  rate_limited: 429,
  upstream_timeout: 504,
  billing_blocked: 402,
  ai_direction_failed: 502,
  internal: 500,
};

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: EngineErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.status = STATUS_BY_CODE[code] ?? 500;
    this.details = details;
    // Inside an opt-in strict run this records a terminal billing failure; anywhere else it is a no-op.
    const status = typeof details?.status === 'number' ? details.status : undefined;
    noteBillingFailure(/gemini|director|content profile|occupancy|layout critique|motion graphics/i.test(message) ? 'gemini' : 'unknown', status, `${message} ${typeof details?.detail === 'string' ? details.detail : ''}`);
  }

  toJSON(): Record<string, unknown> {
    return {
      ok: false,
      code: this.code,
      error: this.message,
      ...(this.details ? {details: this.details} : {}),
    };
  }
}

export function isEngineError(value: unknown): value is EngineError {
  return value instanceof EngineError;
}

/** Wrap an unknown throwable so nothing leaks a raw stack to the client. */
export function toEngineError(value: unknown): EngineError {
  if (isEngineError(value)) {
    return value;
  }
  if (value instanceof Error && value.name === 'AbortError') {
    return new EngineError('upstream_timeout', 'Upstream request timed out');
  }
  const aws = value as {
    name?: string;
    Code?: string;
    $metadata?: {httpStatusCode?: number};
    message?: string;
  };
  if (
    aws?.$metadata?.httpStatusCode === 503 ||
    aws?.Code === 'ServiceUnavailable' ||
    aws?.name === 'ServiceUnavailable'
  ) {
    return new EngineError(
      'render_failed',
      'Cloudflare R2 was temporarily unavailable. Please try again.',
      {status: 503, detail: (aws.message || '').slice(0, 200)},
    );
  }
  const message = value instanceof Error ? value.message : String(value);
  return new EngineError('internal', message || 'Unexpected engine failure');
}
