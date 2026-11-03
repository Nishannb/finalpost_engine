/**
 * WP3E: the WP2 render-integrity judge for the Remotion Lambda path. Pure: the download, the inspection and the temporary workspace are injected, so nothing here imports the
 * logger, an SDK, FFmpeg or a network client. `lib/renderIntegrity.ts` holds the one set of thresholds and decisions (the local render uses the same function); this file adds no
 * threshold of its own.
 *
 * Contract: `verifyLambdaOutput` returns the output URL ONLY after the file behind it was downloaded, inspected and judged valid. Every other outcome throws:
 *   - a non-public URL (loopback, link-local/metadata, private, internal host) is refused by the address guard before anything is fetched;
 *   - a failed download propagates the downloader's own typed error (`source_unreachable`, `source_too_large`, `upstream_timeout`);
 *   - a failing inspection throws `render_failed` naming every failed check.
 * The temporary workspace is removed in every case. The remote object is never touched: no delete, no overwrite, no copy.
 */
import type {OutputFacts} from '../pipeline/experimentVerdict.ts';
import {assertPublicHttpUrl, type HostResolver} from './addressGuard.ts';
import {EngineError} from './errors.ts';
import {assertRenderOutputValid, type RenderExpectation} from './renderIntegrity.ts';

export type LambdaVerifyDeps = {
  /** Streams the remote file to `destination`. The real one is `downloadToFile`, which re-checks the address of every redirect hop. */
  download: (url: string, destination: string) => Promise<unknown>;
  /** Measures the local file (the real one is `inspectOutput`: stat, ffprobe, full decode). */
  inspect: (path: string) => Promise<OutputFacts>;
  /** A scratch directory owned by this check. `cleanup` removes it. */
  workspace: {file: (name: string) => string; cleanup: () => Promise<void>};
  /** For the explicit address check (tests inject a resolver; production uses DNS). */
  resolve?: HostResolver;
  allowHosts?: readonly string[];
};

export async function verifyLambdaOutput(input: {outputUrl: string; expected: RenderExpectation}, deps: LambdaVerifyDeps): Promise<string> {
  try {
    // Defence in depth: the downloader checks the address too, but a swapped or mocked downloader must never turn a private URL into a successful render.
    await assertPublicHttpUrl(input.outputUrl, {resolve: deps.resolve, allowHosts: deps.allowHosts});
    const local = deps.workspace.file('lambda-output.mp4');
    await deps.download(input.outputUrl, local);
    const facts = await deps.inspect(local);
    assertRenderOutputValid(facts, input.expected); // throws render_failed naming the checks
    return input.outputUrl;
  } finally {
    try {
      await deps.workspace.cleanup();
    } catch {
      // a scratch-directory failure must not change the verdict
    }
  }
}

/** The job fields for a failed verification: the typed error as is; anything else becomes a generic render_failed (no internals). */
export function describeVerificationFailure(error: unknown): {code: EngineError['code']; message: string} {
  if (error instanceof EngineError) return {code: error.code, message: error.message};
  return {code: 'render_failed', message: 'The render finished but its output could not be verified.'};
}

/** Marks a render job as "being verified" so that concurrent polls start only one download. */
export function createInFlight() {
  const active = new Set<string>();
  return {
    tryStart(key: string): boolean {
      if (active.has(key)) return false;
      active.add(key);
      return true;
    },
    end(key: string): void {
      active.delete(key);
    },
    has: (key: string) => active.has(key),
  };
}

/**
 * WP3F: what the judge may assume about audio, from the ingest probe saved on the blueprint (`sourceHasAudio`, the `hasAudio` of the probe `analyzeVideo` took before anything
 * else). A saved true/false is passed on as `expectAudio` (true makes a silent output fail with `audio_missing`); anything else is NOT guessed: `expectAudio` stays unset and the
 * job records the warning `render_audio_unchecked`. A missing probe never fails a job by itself.
 */
export const AUDIO_UNCHECKED_WARNING = 'render_audio_unchecked';

export function audioExpectationFor(sourceHasAudio: unknown): {expectAudio: boolean | undefined; warnings: string[]} {
  if (typeof sourceHasAudio === 'boolean') return {expectAudio: sourceHasAudio, warnings: []};
  return {expectAudio: undefined, warnings: [AUDIO_UNCHECKED_WARNING]};
}
