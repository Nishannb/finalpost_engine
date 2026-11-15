/**
 * Footage kind: what the CALLER (the Kinmel app's upload pipeline) says the main video is. Approved after the Kinetic V2 visual sign-off: there is no reliable
 * signal inside the engine (no request field, the speaker vision call returns only a box, container tags such as the iOS `ReplayKitRecording` author tag are
 * lost on re-muxing), so the engine never infers it. Request contract (POST /v1/analyze and POST /v1/edits):
 *
 *   footageKind: 'camera' | 'screen_recording' | 'unknown'      (optional; absent = 'unknown')
 *
 * Kinetic V2 (the typography engine, POLISH_KINETIC_ENGINE) runs ONLY for explicit 'camera' footage. 'screen_recording' and 'unknown' (including an absent
 * field, an older app, or any caller that does not know) take the normal template path. Nothing else in the pipeline reads it, so with the engine flag off the
 * field changes nothing (and it never enters the cache key then).
 */
import {z} from 'zod';

export const FOOTAGE_KINDS = ['camera', 'screen_recording', 'unknown'] as const;
export type FootageKind = (typeof FOOTAGE_KINDS)[number];
export const footageKindSchema = z.enum(FOOTAGE_KINDS);

/** Absent / null -> 'unknown'. Never guesses 'camera'. */
export function resolveFootageKind(raw: FootageKind | null | undefined): FootageKind {
  return raw === 'camera' || raw === 'screen_recording' ? raw : 'unknown';
}

/** Only explicitly identified camera footage may enter Kinetic V2. */
export function kineticEngineAllowedFor(kind: FootageKind | null | undefined): boolean {
  return resolveFootageKind(kind) === 'camera';
}

/** Cache-key fragment: present only when the job's kinetic engine flag is on (the only case where the field can change the blueprint), so every other key is unchanged. */
export function footageFingerprintKey(input: {kineticEngine: boolean; footageKind?: FootageKind | null}): string | undefined {
  return input.kineticEngine ? `footage:${resolveFootageKind(input.footageKind)}` : undefined;
}
