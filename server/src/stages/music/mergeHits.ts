/**
 * Pure SFX hit merge. No I/O, no env. Not wired into analyze or the director.
 */

export type MergePriority = 'kinetic' | 'caption' | 'cut' | 'ambience';
export type MergeHit = {
  at: number; // seconds
  kind: 'whoosh' | 'hit' | 'pop';
  volume?: number;
  reason?: string;
  src?: string;
  priority: MergePriority;
};

const WORD_MASK_SEC = 0.12;
const DEDUPE_SEC = 0.25;
const SNAP_SEC = 0.06;
const MAX_HITS = 12;
const MAX_CAPTION_POPS = 24;
const EPS = 1e-9;

const RANK: Record<MergePriority, number> = {kinetic: 0, caption: 1, cut: 2, ambience: 3};

export function mergeHits(input: {
  hits: readonly MergeHit[];
  wordOnsetsSec: readonly number[];
  bpm?: number;
  downbeatsSec?: readonly number[];
}): MergeHit[] {
  const onsets = input.wordOnsetsSec.filter(Number.isFinite);

  // 1 + 2: validity and word-onset masking.
  const valid = input.hits.filter(hit => {
    if (!Number.isFinite(hit.at) || hit.at < 0) return false;
    return !onsets.some(onset => hit.at > onset + EPS && hit.at <= onset + WORD_MASK_SEC + EPS);
  });

  // 3: dedupe. Process best-first, accept if no kept hit is within the window.
  const order = valid
    .map((hit, index) => ({hit, index}))
    .sort((a, b) => RANK[a.hit.priority] - RANK[b.hit.priority] || a.hit.at - b.hit.at || a.index - b.index);
  const kept: MergeHit[] = [];
  for (const {hit} of order) {
    if (kept.some(other => Math.abs(other.at - hit.at) < DEDUPE_SEC - EPS)) continue;
    kept.push(hit);
  }
  kept.sort((a, b) => a.at - b.at);

  // 4: beat snap.
  const downbeats = (input.downbeatsSec ?? []).filter(Number.isFinite);
  const bpm = input.bpm;
  let out = kept.map(hit => ({...hit}));
  if (typeof bpm === 'number' && Number.isFinite(bpm) && bpm > 0 && downbeats.length >= 2) {
    const step = 60 / bpm;
    const first = Math.min(...downbeats);
    out = out.map(hit => {
      const k = Math.round((hit.at - first) / step);
      const grid = first + k * step;
      if (k >= 0 && Math.abs(grid - hit.at) <= SNAP_SEC + EPS) {
        return {...hit, at: Math.round(grid * 1000) / 1000};
      }
      return hit;
    });
    out.sort((a, b) => a.at - b.at);
  }

  // 5: cap in time order.
  return out.slice(0, MAX_HITS);
}

export function collectVisualCuts(input: {
  captionWords?: readonly {start: number}[];
  kineticPlates?: readonly {start: number}[];
  motionEntrances?: readonly {start: number}[];
  recipePeaks?: readonly {at: number}[];
  ambience?: readonly {at: number}[];
}): {at_ms: number; kind: string}[] {
  const out: {at_ms: number; kind: string}[] = [];
  const push = (sec: number, kind: string) => {
    if (Number.isFinite(sec)) out.push({at_ms: Math.round(sec * 1000), kind});
  };

  const words = input.captionWords ?? [];
  if (words.length <= MAX_CAPTION_POPS) {
    for (const word of words) push(word.start, 'caption_pop');
  } else {
    for (let i = 0; i < MAX_CAPTION_POPS; i += 1) {
      const index = Math.floor((i * words.length) / MAX_CAPTION_POPS);
      const picked = words[index];
      if (picked) push(picked.start, 'caption_pop');
    }
  }
  for (const plate of input.kineticPlates ?? []) push(plate.start, 'kinetic_plate');
  for (const entrance of input.motionEntrances ?? []) push(entrance.start, 'motion_entrance');
  for (const peak of input.recipePeaks ?? []) push(peak.at, 'recipe_peak');
  for (const item of input.ambience ?? []) push(item.at, 'ambience');
  return out;
}
