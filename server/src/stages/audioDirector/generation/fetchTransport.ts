/**
 * Phase 1.6: a live Runware transport with Node's built-in fetch, mirroring agents/music_specialist/runware.py RunwareTransport:
 *   POST RUNWARE_ENDPOINT, body = JSON array of tasks, headers Authorization: Bearer <key> and Content-Type: application/json;
 *   the returned audio URL is fetched without credentials (runware.py download()).
 *
 * Never constructed by the pipeline: createTransport() (runware.ts) still refuses live generation and AUDIO_DIRECTOR_GENERATION stays off. Only the
 * supervised one-call runner (listeningTest/generateFirstBgm.ts) builds this, after an explicit approval. The key is held privately and never logged,
 * returned or put in an error message.
 */

import {writeFileSync} from 'node:fs';

import {GenerationError, RUNWARE_ENDPOINT, type RunwareTransport} from './runware.ts';

type FetchLike = (input: string, init?: {method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal}) => Promise<{ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer>}>;

export class FetchRunwareTransport implements RunwareTransport {
  readonly live = true;
  /** Number of POSTs made (the runner reports it; one generation call plus any getResponse polls). */
  posts = 0;
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(opts: {apiKey: string; fetchImpl?: FetchLike; timeoutMs?: number}) {
    if (!opts.apiKey || !opts.apiKey.trim()) throw new GenerationError('generation_disabled', 'RUNWARE_API_KEY is not set');
    this.#apiKey = opts.apiKey.trim();
    this.#fetch = opts.fetchImpl ?? (fetch as unknown as FetchLike);
    this.#timeoutMs = opts.timeoutMs ?? 120_000;
  }

  async post(tasks: readonly Record<string, unknown>[]): Promise<unknown> {
    this.posts += 1;
    let response;
    try {
      response = await this.#fetch(RUNWARE_ENDPOINT, {
        method: 'POST',
        headers: {Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(tasks),
        signal: AbortSignal.timeout(Math.min(this.#timeoutMs, 120_000)),
      });
    } catch (error) {
      throw new GenerationError('transport_error', `request to Runware failed (${error instanceof Error ? error.name : 'error'})`);
    }
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new GenerationError('transport_error', `Runware answered HTTP ${response.status} with a non-JSON body`);
    }
    // An HTTP error that still carries Runware's {errors: [...]} body is returned, so parseRunwareResponse can report the provider's own code.
    if (!response.ok && !(body && typeof body === 'object' && Array.isArray((body as {errors?: unknown}).errors))) {
      throw new GenerationError('transport_error', `Runware answered HTTP ${response.status}`);
    }
    return body;
  }

  async download(url: string, dest: string): Promise<void> {
    if (!/^https:\/\//i.test(url)) throw new GenerationError('download_failed', 'the audio URL is not https');
    let response;
    try {
      response = await this.#fetch(url, {method: 'GET', signal: AbortSignal.timeout(this.#timeoutMs)});
    } catch (error) {
      throw new GenerationError('download_failed', `audio download failed (${error instanceof Error ? error.name : 'error'})`);
    }
    if (!response.ok) throw new GenerationError('download_failed', `audio download answered HTTP ${response.status}`);
    writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
  }
}
