/**
 * Error taxonomy for the pipeline.
 *
 * Every failure the client can act on is an `EngineError` with a stable `code`
 * so the mobile app can branch (retry, upgrade prompt, "captions unavailable")
 * without string-matching English messages.
 */

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
  | 'quota_exceeded'
  | 'rate_limited'
  | 'upstream_timeout'
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
  quota_exceeded: 429,
  rate_limited: 429,
  upstream_timeout: 504,
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
