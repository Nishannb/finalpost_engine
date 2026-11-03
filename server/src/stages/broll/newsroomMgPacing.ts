/**
 * WP44: Skill D — NEWSROOM MG pacing (black / white / signal-red motion-graphics explainer).
 * Grammar: remotion/out/phase36-readiness/newsroom-mg-grammar.yaml
 * PURE. Distinct from Skill A (hyper-cut faceless) and Skill B (lime TH explainer).
 * Host ~13% as break-from-graphics; GFX/CARD dominate; opening is one continuous animated shot.
 */

export type NewsroomLayoutId = 'newsroom_gfx' | 'newsroom_card' | 'newsroom_host' | 'newsroom_expert';
export type NewsroomRole = 'hook_chart' | 'gfx' | 'card' | 'host' | 'expert' | 'recap';
export type NewsroomWord = {text: string; start: number; end: number};
export type NewsroomSegment = {start: number; end: number; layout: NewsroomLayoutId; role: NewsroomRole};

export const NEWSROOM_LAYOUT_IDS: readonly NewsroomLayoutId[] = [
  'newsroom_gfx',
  'newsroom_card',
  'newsroom_host',
  'newsroom_expert',
];

export const NEWSROOM_BOUNDS = {
  hook_chart: {lo: 5, hi: 8},
  gfx: {lo: 2, hi: 6},
  card: {lo: 1.5, hi: 5},
  host: {lo: 2.5, hi: 5},
  expert: {lo: 3, hi: 7},
  recap: {lo: 3, hi: 6},
} as const;

export const NEWSROOM_MIN_DURATION_SEC = 20;
export const NEWSROOM_HOST_SHARE_TARGET = 0.13;
export const NEWSROOM_MEDIAN_TARGET_SEC = 3.1;

export const LAYOUT_OF_NEWSROOM_ROLE: Readonly<Record<NewsroomRole, NewsroomLayoutId>> = {
  hook_chart: 'newsroom_gfx',
  gfx: 'newsroom_gfx',
  card: 'newsroom_card',
  host: 'newsroom_host',
  expert: 'newsroom_expert',
  recap: 'newsroom_gfx',
};

type Built = {start: number; end: number; role: NewsroomRole};

function push(out: Built[], start: number, end: number, role: NewsroomRole) {
  if (end - start < 0.5) return;
  out.push({start, end, role});
}

/**
 * Plan a hard-cut newsroom MG timeline.
 * Pattern: long GFX hook → GFX/CARD body with sparse HOST breaks → late EXPERT optional → HOST close → GFX recap bookend.
 */
export function planNewsroomMgPacing(input: {
  durationSec: number;
  words?: readonly NewsroomWord[];
}): {segments: NewsroomSegment[]; cuts: number[]; stats: {medianSec: number; meanSec: number; hostShare: number}; warnings: string[]} {
  const warnings: string[] = [];
  const durationSec = Math.max(0, input.durationSec);
  if (durationSec < NEWSROOM_MIN_DURATION_SEC) {
    warnings.push(`polish_pace:newsroom_short_clip:${durationSec.toFixed(1)}`);
    return {
      segments: [{start: 0, end: durationSec, layout: 'newsroom_gfx', role: 'gfx'}],
      cuts: [],
      stats: {medianSec: durationSec, meanSec: durationSec, hostShare: 0},
      warnings,
    };
  }

  const built: Built[] = [];
  const hookEnd = Math.min(NEWSROOM_BOUNDS.hook_chart.hi, Math.max(NEWSROOM_BOUNDS.hook_chart.lo, durationSec * 0.06));
  push(built, 0, hookEnd, 'hook_chart');

  const recapStart = Math.max(hookEnd + 8, durationSec - 5.5);
  const hostCloseStart = Math.max(hookEnd + 6, recapStart - 4.2);
  let t = hookEnd;
  let flip = 0;
  const bodyEnd = hostCloseStart;
  while (t < bodyEnd - 0.05) {
    const remaining = bodyEnd - t;
    // Insert host breaks ~ every 18–22 s of graphics (≈13% overall)
    const wantHost = built.filter(s => s.role === 'host').length < 3 && t > durationSec * 0.28 && (t - hookEnd) % 20 > 16 && remaining > 6;
    if (wantHost) {
      const hostLen = Math.min(NEWSROOM_BOUNDS.host.hi, Math.max(NEWSROOM_BOUNDS.host.lo, 3.5));
      push(built, t, Math.min(bodyEnd, t + hostLen), 'host');
      t = Math.min(bodyEnd, t + hostLen);
      continue;
    }
    const role: NewsroomRole = flip % 3 === 2 ? 'card' : 'gfx';
    const target = role === 'card' ? 3.0 : 3.4;
    const len = Math.min(remaining, Math.max(NEWSROOM_BOUNDS[role].lo, Math.min(NEWSROOM_BOUNDS[role].hi, target)));
    push(built, t, t + len, role);
    t += len;
    flip += 1;
  }

  // Optional expert in the final third before host close (if room)
  if (hostCloseStart - (built.at(-1)?.end ?? hookEnd) > 5 && durationSec > 60) {
    const last = built.at(-1);
    if (last && last.role !== 'host' && last.end - last.start > 4) {
      const split = last.end - 4;
      last.end = split;
      push(built, split, hostCloseStart, 'expert');
    }
  }

  push(built, hostCloseStart, recapStart, 'host');
  push(built, recapStart, durationSec, 'recap');

  // Snap lightly to word boundaries when available (idea / entity beats preferred later)
  void input.words;

  const segments: NewsroomSegment[] = built.map(s => ({
    start: s.start,
    end: s.end,
    layout: LAYOUT_OF_NEWSROOM_ROLE[s.role],
    role: s.role,
  }));
  // Ensure tiling
  for (let i = 1; i < segments.length; i++) {
    segments[i - 1]!.end = segments[i]!.start;
  }
  if (segments.length) {
    segments[0]!.start = 0;
    segments[segments.length - 1]!.end = durationSec;
  }

  const lengths = segments.map(s => s.end - s.start).sort((a, b) => a - b);
  const meanSec = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  const medianSec = lengths[Math.floor(lengths.length / 2)] ?? meanSec;
  const hostSec = segments.filter(s => s.layout === 'newsroom_host').reduce((a, s) => a + (s.end - s.start), 0);
  const hostShare = hostSec / Math.max(1e-6, durationSec);
  const cuts = segments.slice(1).map(s => s.start);
  warnings.push(`polish_pace:newsroom_cuts:${cuts.length}`);
  warnings.push(`polish_pace:newsroom_host_share:${(hostShare * 100).toFixed(0)}`);
  return {segments, cuts, stats: {medianSec, meanSec, hostShare}, warnings};
}
