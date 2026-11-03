/**
 * WP7A: background-noise reduction filter for the cuts-first profile. PURE: no env, no logger, no I/O; callers pass values in and run the filter themselves (media/ffmpeg.ts).
 *
 * Filter chain (FFmpeg audio filtergraph, all built into libavfilter, no extra native dependency or model file):
 *   highpass=f=<hz>                      removes rumble, desk thumps and mains hum below speech (default 80 Hz, speech energy starts above ~85 Hz).
 *   afftdn=nr=<dB>:nf=<floor>:tn=1       FFT denoiser. `nr` is the reduction in dB (default 12, deliberately gentle), `nf` the assumed noise floor (-35 dB), and `tn=1` makes it
 *                                        track the noise as it changes (fans, traffic), so it also follows a room that is not constant.
 * Why afftdn and not the alternatives: `anlmdn` (non-local means) is far slower than real time on a long clip; `arnndn` needs an RNN model file that is not shipped; a low-pass filter
 * dulls consonants and does not remove broadband noise. afftdn is fast, deterministic and part of every normal FFmpeg build.
 * LIMITS: it reduces steady background noise (hiss, fans, hum, room tone), not other voices, music or sudden sounds, and a high `nr` leaves speech sounding watery.
 */

export type DenoiseOptions = {
  /** Noise reduction in dB, clamped to MIN_REDUCTION_DB..MAX_REDUCTION_DB. */
  reductionDb?: number;
  /** High-pass cutoff in Hz, clamped to MIN_HIGHPASS_HZ..MAX_HIGHPASS_HZ. */
  highPassHz?: number;
};

export const DEFAULT_REDUCTION_DB = 12;
export const DEFAULT_HIGHPASS_HZ = 80;
export const MIN_REDUCTION_DB = 4;
export const MAX_REDUCTION_DB = 30;
export const MIN_HIGHPASS_HZ = 40;
export const MAX_HIGHPASS_HZ = 200;
export const NOISE_FLOOR_DB = -35;

/** Warning pushed when the denoised audio is the audio of the edit. */
export const DENOISE_APPLIED_WARNING = 'cuts_denoise_applied';
/** Warning pushed when the denoise failed and the original audio is kept. */
export const DENOISE_FAILED_WARNING = 'cuts_denoise_failed';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const finiteOr = (value: number | undefined, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const fmt = (value: number): string => String(Math.round(value * 100) / 100);

/** The `-af` filter string. Always the same text for the same (clamped) options. */
export function buildDenoiseFilter(options: DenoiseOptions = {}): string {
  const reduction = clamp(finiteOr(options.reductionDb, DEFAULT_REDUCTION_DB), MIN_REDUCTION_DB, MAX_REDUCTION_DB);
  const highPass = clamp(finiteOr(options.highPassHz, DEFAULT_HIGHPASS_HZ), MIN_HIGHPASS_HZ, MAX_HIGHPASS_HZ);
  return `highpass=f=${fmt(highPass)},afftdn=nr=${fmt(reduction)}:nf=${NOISE_FLOOR_DB}:tn=1`;
}

/** Did this run's warnings say the denoised audio is the edit's audio? (a local-file render must then not swap the original back in) */
export function denoiseWasApplied(warnings: readonly string[]): boolean {
  return warnings.includes(DENOISE_APPLIED_WARNING);
}
