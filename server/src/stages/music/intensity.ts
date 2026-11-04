/**
 * Video intensity curve: a per-second 0..1 score of how busy the edit is. Pure.
 *
 * Each visual event adds a small triangular bump (full weight in its own second, half weight in the seconds either side):
 * a cut 0.30, a kinetic plate 0.30, a zoom 0.25, a caption pop 0.15. Speech pace adds up to 0.40 (words per second over a 3 s window,
 * 3 words/s = 180 wpm = full). The sum is clamped to 1. Placement correlates this with the bed's energy map.
 * It only ever picks WHERE the music starts. It never touches a level.
 */

export const INTENSITY_WEIGHTS = {cut: 0.3, plate: 0.3, zoom: 0.25, pop: 0.15, speech: 0.4} as const;
const FULL_PACE_WORDS_PER_SEC = 3;

export type IntensityInput = {
  durationSec: number;
  words?: ReadonlyArray<{start: number; end: number}>;
  cutTimesSec?: ReadonlyArray<number>;
  zoomTimesSec?: ReadonlyArray<number>;
  plateTimesSec?: ReadonlyArray<number>;
  popTimesSec?: ReadonlyArray<number>;
};

export function buildIntensityCurve(input: IntensityInput): number[] {
  const seconds = Math.max(1, Math.ceil(input.durationSec));
  const curve = new Array<number>(seconds).fill(0);
  const bump = (times: ReadonlyArray<number> | undefined, weight: number) => {
    for (const time of times ?? []) {
      if (!Number.isFinite(time) || time < 0) continue;
      const s = Math.floor(time);
      for (const [index, factor] of [[s - 1, 0.5], [s, 1], [s + 1, 0.5]] as const) {
        if (index >= 0 && index < seconds) curve[index] = curve[index]! + weight * factor;
      }
    }
  };
  bump(input.cutTimesSec, INTENSITY_WEIGHTS.cut);
  bump(input.plateTimesSec, INTENSITY_WEIGHTS.plate);
  bump(input.zoomTimesSec, INTENSITY_WEIGHTS.zoom);
  bump(input.popTimesSec, INTENSITY_WEIGHTS.pop);
  const starts = (input.words ?? []).map(word => word.start).filter(Number.isFinite);
  for (let s = 0; s < seconds; s += 1) {
    const inWindow = starts.filter(start => start >= s - 1 && start < s + 2).length; // a 3 s window centred on this second
    curve[s] = Math.min(1, curve[s]! + INTENSITY_WEIGHTS.speech * Math.min(1, inWindow / 3 / FULL_PACE_WORDS_PER_SEC));
  }
  return curve.map(value => Math.round(Math.min(1, value) * 1000) / 1000);
}
