/**
 * Generated-BGM level policy (LU of the bed relative to the measured voice, per duck state). Pure.
 *
 *   v1_talking      -18 / -9 / -4   the original voice-first offsets (duckEnvelope.ts TALKING_OFFSETS_LU, unchanged). Kept for stored blueprints,
 *                                   the AudioDirector listening tools and as the explicit fallback `MUSIC_BED_POLICY=v1`.
 *   voice_first_v2  -24 / -15 / -10 the production default for NEW generated beds. The same shape 6 dB lower.
 *
 * Why v2 (measured, SFX-3C, real 2.mp4 speech under the real generated bed; docs/ai-music-director/PHASE_SFX_3C_AUDIO_CALIBRATION_REPORT.md):
 *   - listeners heard the v1 bed as too prominent although it passed the -18 LU integrated rule by 0.2 LU;
 *   - under v1, 11.6 % of 400 ms speech windows had the bed within 12 LU of the voice (worst -5.6 LU), voice dips median -10.4 LU, and the bed's
 *     100-500 Hz energy sat only ~16.5 dB under the voice's;
 *   - 6 dB lower: 0.5 % of windows within 12 LU (worst -11.6 LU), voice dips -16.4 LU, 100-500 Hz ~22.5 dB under; 9 dB lower was also measured.
 * The pause and open states move by the same 6 dB, so the music still rises 9 dB in genuine pauses (the same ramps, no new jumps).
 * Human approval of the v2 levels is still pending (listening files in the production readiness report).
 */

export const BGM_POLICIES = Object.freeze({
  v1_talking: Object.freeze({speech: -18, pause: -9, open: -4}),
  voice_first_v2: Object.freeze({speech: -24, pause: -15, open: -10}),
});
export type BgmPolicyName = keyof typeof BGM_POLICIES;
export type BgmOffsets = {speech: number; pause: number; open: number};

export const DEFAULT_GENERATED_BGM_POLICY: BgmPolicyName = 'voice_first_v2';

/** `MUSIC_BED_POLICY=v1` (or `v1_talking`) restores the original offsets; anything else, or unset, is the default. */
export function resolveBgmPolicy(env: NodeJS.ProcessEnv = process.env): BgmPolicyName {
  const raw = (env.MUSIC_BED_POLICY ?? '').trim().toLowerCase();
  if (raw === 'v1' || raw === 'v1_talking') return 'v1_talking';
  if (raw === 'voice_first_v2' || raw === 'v2') return 'voice_first_v2';
  return DEFAULT_GENERATED_BGM_POLICY;
}

export const bgmOffsets = (policy: BgmPolicyName): BgmOffsets => BGM_POLICIES[policy];
