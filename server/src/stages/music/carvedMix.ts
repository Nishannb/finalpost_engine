/**
 * Crossfade position between the full bed (0) and the VO-carved bed (1), from the stored duck envelope.
 * duckDb is the envelope at this instant. speechDb is full carve; pauseDb (else openDb) and above is none.
 * PARITY: remotion/src/components/MusicBedTrack.tsx carries an identical copy; keep them equal.
 */
export function carvedMix(duckDb: number, speechDb: number, openDb: number, pauseDb?: number): number {
  const ref = pauseDb ?? openDb;
  const span = ref - speechDb;
  if (!(span > 0)) return duckDb <= speechDb ? 1 : 0;
  return Math.min(1, Math.max(0, (ref - duckDb) / span));
}

/** Equal-power gains for the two elements. */
export function carvedGains(mix: number): {full: number; carved: number} {
  const m = Math.min(1, Math.max(0, mix));
  return {full: Math.cos((m * Math.PI) / 2), carved: Math.sin((m * Math.PI) / 2)};
}
