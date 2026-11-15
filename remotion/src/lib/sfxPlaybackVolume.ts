/**
 * Phase SFX-3D: channel-aware SFX playback volume. Pure (no Remotion import), so the server tests can import it.
 *
 * Remotion's audio preprocessing (@remotion/renderer preprocess-audio-track.js) converts every asset with `ffmpeg -ac 2`. For a MONO source,
 * ffmpeg's default upmix places the one channel in each stereo channel at -3.01 dB (center mix level 1/sqrt(2)), so a mono sound plays
 * 3.01 dB under the volume it was given. A stereo source is not rematrixed and plays at its volume.
 *
 * The correction is opt-in per hit: only a hit that declares `sourceChannels: 1` is compensated by sqrt(2), restoring the planned level exactly.
 * A hit without `sourceChannels` (every blueprint saved before SFX-3D) and a stereo hit (`sourceChannels: 2`) play at exactly their volume, as
 * before. The result never exceeds 1.
 */

/** The upmix loss ffmpeg applies to a mono source (1/sqrt(2)), and its exact inverse. */
export const MONO_UPMIX_COMPENSATION = Math.SQRT2;
/** The renderer's default when a hit has no volume (SfxTrack, unchanged). */
export const DEFAULT_HIT_VOLUME = 0.12;

export function sfxPlaybackVolume(hit: {volume?: number; sourceChannels?: number}): number {
  const volume = hit.volume ?? DEFAULT_HIT_VOLUME;
  if (hit.sourceChannels !== 1) return volume;
  return Math.min(1, volume * MONO_UPMIX_COMPENSATION);
}
