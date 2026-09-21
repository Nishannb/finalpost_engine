/**
 * Outbound HTTP with timeouts and bounded retries.
 *
 * Retries only idempotent-safe failures (network, 408, 429, 5xx) with jittered
 * backoff — an ASR or LLM call that already succeeded must never be re-billed.
 */

import {EngineError, type EngineErrorCode} from './errors.ts';
import {logger} from './logger.ts';

export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  /** Only the two shapes this service sends: multipart uploads and JSON. */
  body?: FormData | string | undefined;
  timeoutMs?: number;
  retries?: number;
  /** Error code used when every attempt fails. */
  failureCode?: EngineErrorCode;
  label: string;
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

export async function requestWithRetry(
  url: string,
  options: RequestOptions,
): Promise<Response> {
  const {
    method = 'GET',
    headers,
    body,
    timeoutMs = 30_000,
    retries = 2,
    failureCode = 'internal',
    label,
  } = options;

  let lastStatus = 0;
  let lastDetail = '';

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      if (response.ok) {
        return response;
      }
      lastStatus = response.status;
      lastDetail = (await safeText(response)).slice(0, 400);
      if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) {
        throw new EngineError(
          response.status === 429 ? 'rate_limited' : failureCode,
          `${label} failed (HTTP ${response.status})`,
          {status: response.status, detail: lastDetail},
        );
      }
      logger.warn(
        {label, status: response.status, attempt},
        'retrying upstream request',
      );
    } catch (error) {
      if (error instanceof EngineError) {
        throw error;
      }
      const aborted = error instanceof Error && error.name === 'AbortError';
      // A timed-out LLM call will time out again with the same payload. Fail
      // over immediately so the director can drop thinking / switch models.
      if (aborted || attempt === retries) {
        throw new EngineError(
          aborted ? 'upstream_timeout' : failureCode,
          aborted
            ? `${label} timed out after ${timeoutMs}ms`
            : `${label} could not be reached`,
          {status: lastStatus, detail: lastDetail},
        );
      }
      logger.warn({label, attempt, aborted}, 'retrying upstream request');
    } finally {
      clearTimeout(timer);
    }
    await sleep(250 * 2 ** attempt + Math.floor(Math.random() * 150));
  }

  throw new EngineError(failureCode, `${label} failed`);
}

export async function requestJson<T>(
  url: string,
  options: RequestOptions,
): Promise<T> {
  const response = await requestWithRetry(url, options);
  const text = await safeText(response);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new EngineError(
      options.failureCode ?? 'internal',
      `${options.label} returned malformed JSON`,
      {preview: text.slice(0, 200)},
    );
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
