/**
 * MOTION-PLAYBOOK solver for the `type.words` preset. Pure + deterministic (seeded). The director only TAGS (style, word roles, zone / exit intent); everything below is decided here:
 * sizes, case, fonts, the zone (gutter first, behind is rare), the staggered stack, per-word frame keyframes (E1..E6), the block hold (push + sine drift + parallax) and the exit (X1..X6).
 * One RenderLine = one word. The compositor only interpolates the keyframes this file emits.
 */
import {shortsSafeRect} from '../broll/heroSweep.ts';
import type {CameraSample} from './camera.ts';
import type {DepthProvider} from './depth.ts';
import {marginInside, overlapFraction, restingMargin, restingRange, wordAabbAt, type Rect} from './geometry.ts';
import {SAFE_TOLERANCE_PX, CONTRAST_MIN, FORCE_FRONT_ALPHA_AREA, HERO_OCC_PREF, SUPPORT_OCC_MAX, contrastStrokeColor, heroReadable, lineEdgeOcclusions, lineOcclusions, lumToHex, worstContrast} from './guardrails.ts';
import {CAMERA_BLEND, CASCADE_STAGGER_30, HERO_FLOOR_FRAC, HOLD, REST_GROWTH, SUPPORT_FLOOR_FRAC, Z_BY_ROLE, entryFrames, exitFrames, expoIn, expoOut, fpsScale} from './motion.ts';
import {HERO_ENTER_POOL, HERO_EXIT_POOL, IDENT, LEAD_ENTER_POOL, PUNCH_ENTER_POOL, WILD_ENTRIES, WORD_LEVEL_EXITS, entryPose, entryTotalFrames, wordExitPose, type PoseCtx} from './motionLibrary.ts';
import {nudgeForContrast, plateAccents, resolveAccent} from './accent.ts';
import {FONT_METRICS, textWidthEm} from './measure.ts';
import {FACE_FRACTION, boxAt, boxSpan, type ShotScene} from './scene.ts';
import type {AnimName, ExitName, FontKey, FontPair, Keyframe, KineticShot, KineticWord, LineRole, PoseName, RenderEvent, RenderLine, StyleName, TextEvent, WordKeyframe, ZoneName} from './schema.ts';
import {normToken} from './transcript.ts';
import {BRAND_PHRASES, MAX_PEER_UNITS, isPeerList} from './words.ts';

type Role = 'hero' | 'support' | 'connector' | 'running' | 'punch';
export const MAX_BLOCK_WORDS = 6;
export const MAX_BLOCK_ROWS = 4;
export const TITLE_WINDOW_SEC = 15;
export const BEHIND_WINDOW_SEC = 8;
const LEAK = '#FF8A3D';
const MIN_SCALE = 0.4;

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export type PlaybookState = {
  lastBehindFrame: number; lastStackFrame: number; titleFrames: number[]; x6Used: boolean;
  /** `${hero entry}|${exit}` of the previous lockup: the solver never repeats the same pair twice in a row */
  lastPair: string | null;
  /** rotation counters (entry / exit pools, accent alternation, lead-in alternation) */
  rot: number; leadRot: number; accentRot: number; poseRot: number;
};
export const newPlaybookState = (): PlaybookState => ({lastBehindFrame: -1e9, lastStackFrame: -1e9, titleFrames: [], x6Used: false, lastPair: null, rot: 0, leadRot: 0, accentRot: 0, poseRot: 0});

export type PlaybookArgs = {
  ev: TextEvent;
  style: StyleName;
  /** the plan's font pairing (absent = the style's legacy fonts) */
  fontPair?: FontPair | undefined;
  words: KineticWord[];
  shot: KineticShot;
  scene: ShotScene;
  width: number;
  height: number;
  fps: number;
  seed: number;
  depth: DepthProvider;
  cameraAt: (frame: number) => CameraSample;
  /** latest frame this event may occupy (next unrelated event minus its gap) */
  limitOut: number;
  isLast: boolean;
  state: PlaybookState;
  phase: number;
  /** production plans cycle recede / isometric / trapezoid / slant on front heroes. Sheets and unit fixtures stay flat unless the event tags a pose. */
  varyPose?: boolean;
};
export type PlaybookResult = {events: RenderEvent[]; notes: string[]; actions: Array<{action: string; detail?: string}>; dropped?: string};

// ---------------------------------------------------------------------------------------------------------------- words + roles

type PW = {text: string; role: Role; start: number; end: number; /** the director's entry tag for this word's line */ enter?: AnimName};

const normRole = (r: LineRole): Role => (r === 'caption' ? 'running' : r);

/** Glue consecutive tokens that form a brand/tool name into one PW ("After Effects"). */
export function glueBrandPhrases(pw: PW[]): PW[] {
  const out: PW[] = [];
  for (let i = 0; i < pw.length; ) {
    const hit = BRAND_PHRASES.find(p => i + p.length <= pw.length && p.every((t, k) => normToken(pw[i + k]!.text) === t));
    if (hit) {
      const slice = pw.slice(i, i + hit.length);
      const role = slice.some(w => w.role === 'hero' || w.role === 'punch') ? slice.find(w => w.role === 'hero' || w.role === 'punch')!.role : slice[0]!.role;
      out.push({text: slice.map(w => w.text).join(' '), role, start: slice[0]!.start, end: slice[slice.length - 1]!.end, ...(slice[0]!.enter ? {enter: slice[0]!.enter} : {})});
      i += hit.length;
    } else { out.push(pw[i]!); i += 1; }
  }
  return out;
}

/** Plan lines -> single words with roles and transcript timing (in order). Enforces: exactly one hero per headline block, <= MAX_BLOCK_WORDS. */
export function expandWords(ev: TextEvent, words: KineticWord[]): {pw: PW[]; notes: string[]} {
  const notes: string[] = [];
  const [a, b] = ev.wordRange;
  let cursor = a;
  const out: PW[] = [];
  for (const line of ev.lines) {
    for (const tok of line.text.split(/\s+/).filter(Boolean)) {
      let idx = -1;
      for (let k = cursor; k <= b; k += 1) if (normToken(words[k]!.text) === normToken(tok)) { idx = k; break; }
      if (idx < 0) idx = Math.min(cursor, b); else cursor = idx + 1;
      const w = words[idx]!;
      out.push({text: tok.replace(/[.,;:!?]+$/, ''), role: normRole(line.role), start: w.startFrame, end: w.endFrame, ...(line.enter ? {enter: line.enter} : {})});
    }
  }
  let pw = glueBrandPhrases(out);
  const wordCap = isPeerList(pw) ? MAX_PEER_UNITS : MAX_BLOCK_WORDS;
  if (pw.length > wordCap) { notes.push(`words ${pw.length} > ${wordCap}: clipped`); pw = pw.slice(0, wordCap); }
  for (let i = 1; i < pw.length; i += 1) { pw[i]!.start = Math.max(pw[i]!.start, pw[i - 1]!.start); pw[i]!.end = Math.max(pw[i]!.end, pw[i]!.start); }
  const headline = pw.some(w => w.role !== 'running');
  if (headline) {
    // running words inside a headline block read as connectors
    for (const w of pw) if (w.role === 'running') w.role = 'connector';
    const heroes = pw.filter(w => w.role === 'hero');
    for (const extra of heroes.slice(1)) { extra.role = 'support'; notes.push(`second hero "${extra.text}" demoted to support`); }
    // a block of connectors only gets a hero; a support(+connector) tail block continues the previous headline and stays hero-less
    if (!pw.some(w => w.role === 'hero' || w.role === 'punch' || w.role === 'support')) {
      const pick = [...pw].sort((x, y) => y.text.length - x.text.length)[0]!;
      pick.role = 'hero';
      notes.push(`no hero tagged: "${pick.text}" promoted`);
    }
  }
  return {pw, notes};
}

// ---------------------------------------------------------------------------------------------------------------- style tables

type WS = {font: FontKey; weight: number; upper: boolean; italic: boolean; ls: number; px1080: number; opacity: number};
/** px at 1080 wide. hero / punch >= 7.5% of a 1920 frame after fit, connectors / support >= 3.5% (motion.ts HERO_FLOOR_FRAC / SUPPORT_FLOOR_FRAC). */
const SIZE: Record<Role, number> = {hero: 164, support: 104, connector: 76, running: 76, punch: 160};
const SCRIPT_MAX_LETTERS = 8;

/** The pairing's hero / support faces for the block-level (legacy) presets, which otherwise take brand.fonts: the per-video pairing wins over the brand sheet. */
export function pairFonts(pair: FontPair, heroText = '', upper = false): {hero: FontKey; support: FontKey; caption: FontKey} {
  if (pair === 'street') return {hero: 'anton', support: 'archivoBlack', caption: 'poppins'};
  if (pair === 'editorial') return {hero: 'playfairItalic', support: 'poppins', caption: 'playfair'};
  return {hero: !upper && Array.from(heroText.replace(/[^a-z]/gi, '')).length <= SCRIPT_MAX_LETTERS ? 'pacifico' : 'poppins', support: 'poppins', caption: 'poppins'};
}

/** Fonts per role. With a plan `fontPair` the fonts come from the director's pairing; without one the style's legacy look is kept (old plans / fixtures). */
export function wordStyle(style: StyleName, role: Role, pair?: FontPair, text = ''): WS {
  const px1080 = SIZE[role];
  const opacity = role === 'connector' ? 0.9 : 1;
  const sans = (weight: number, upper = false, ls = 0): WS => ({font: 'poppins', weight, upper, italic: false, ls, px1080, opacity});
  const heroish = role === 'hero' || role === 'punch';
  if (pair === 'street') {
    // heavy grotesk lead-ins + condensed display caps
    if (heroish) return {font: 'anton', weight: 400, upper: true, italic: false, ls: 0.01, px1080, opacity};
    return {font: 'archivoBlack', weight: 400, upper: role === 'support', italic: false, ls: 0, px1080, opacity};
  }
  if (pair === 'editorial') {
    // sans lead-in + serif-italic hero
    if (heroish) return {font: 'playfairItalic', weight: 400, upper: false, italic: true, ls: 0, px1080, opacity};
    return sans(role === 'support' ? 600 : 500);
  }
  if (pair === 'neon') {
    // sans + one script / accent hero (a long word would not fit in a script face at hero size: it takes the heavy sans instead)
    if (heroish) return Array.from(text.replace(/[^a-z]/gi, '')).length <= SCRIPT_MAX_LETTERS ? {font: 'pacifico', weight: 400, upper: false, italic: false, ls: 0, px1080, opacity} : sans(900, true, -0.02);
    return sans(role === 'support' ? 700 : 600);
  }
  if (style === 'cinematicClean') {
    if (heroish) return sans(900, true, -0.02);
    if (role === 'support') return sans(700);
    if (role === 'connector') return sans(300);
    return sans(500);
  }
  if (style === 'editorialLuxury') {
    if (heroish) return {font: 'playfairItalic', weight: 400, upper: false, italic: true, ls: 0, px1080, opacity};
    if (role === 'support') return sans(600);
    return sans(500);
  }
  if (heroish) return {font: 'shrikhand', weight: 400, upper: false, italic: false, ls: 0, px1080, opacity};
  return sans(800);
}

// ---------------------------------------------------------------------------------------------------------------- block layout (one reading block)

type LW = {pw: PW; role: Role; ws: WS; px: number; w: number; h: number; dx: number; dy: number; row: number; anim: AnimName};
type Built = {lw: LW[]; block: {w: number; h: number}; title: boolean};

function measure(pw: PW, ws: WS, px: number): {w: number; h: number} {
  const text = ws.upper ? pw.text.toUpperCase() : pw.text;
  return {w: round2(textWidthEm(text, ws.font, ws.weight, ws.upper, ws.ls) * px), h: round2(px * FONT_METRICS[ws.font].lineEm)};
}

/** the floor is '~8%': a line may land this fraction under it after the fit */
const FLOOR_TOLERANCE = 0.96;
/** Smallest event scale at which every line of the block still meets its floor (hero / punch 7.5% of the frame height, the rest 3.5%). */
export function floorScaleOf(lw: Array<{role: Role; px: number}>, height: number): number {
  let s = 0;
  for (const l of lw) {
    const floor = (l.role === 'hero' || l.role === 'punch' ? HERO_FLOOR_FRAC : SUPPORT_FLOOR_FRAC) * height;
    s = Math.max(s, (FLOOR_TOLERANCE * floor) / Math.max(1, l.px));
  }
  return Math.min(1, s);
}

export function buildBlock(pwIn: PW[], style: StyleName, width: number, safeW: number, opts: {heroShrink: number; title: boolean; /** row-to-row leading (default 0.88) */ lead?: number; /** false = staggered rows (hero left, trailing rows right); default: one centred column */ centerRows?: boolean; fontPair?: FontPair | undefined}): Built {
  const k = width / 1080;
  const lowerCase = style !== 'cinematicClean';
  const pw = pwIn.map(w => ({...w, text: lowerCase || w.role === 'connector' || w.role === 'support' || w.role === 'running' ? w.text.toLowerCase() : w.text}));
  let title = opts.title && pw.length === 1 && pw[0]!.role === 'hero' && style === 'cinematicClean';
  const supportCount = { n: 0 };
  const peers = isPeerList(pw);
  const lw: LW[] = pw.map(w => {
    const ws = wordStyle(style, w.role, opts.fontPair, w.text);
    let px = ws.px1080 * k * (w.role === 'hero' ? opts.heroShrink : 1);
    if (peers && (w.role === 'hero' || w.role === 'support')) {
      // listed tools share one size and the hero face (After Effects = Premiere Pro = DaVinci Resolve)
      const heroWs = wordStyle(style, 'hero', opts.fontPair, w.text);
      px = heroWs.px1080 * k * opts.heroShrink;
      return {pw: w, role: w.role, ws: {...heroWs, px1080: heroWs.px1080}, px: round2(px), w: 0, h: 0, dx: 0, dy: 0, row: 0, anim: 'IN-1'};
    }
    if (w.role === 'support') { px = Math.max(SIZE.connector * k, px * 0.92 ** supportCount.n); supportCount.n += 1; }
    return {pw: w, role: w.role, ws, px: round2(px), w: 0, h: 0, dx: 0, dy: 0, row: 0, anim: 'IN-1'};
  });
  if (title) {
    const t = lw[0]!;
    const wEm = textWidthEm(t.pw.text, t.ws.font, t.ws.weight, t.ws.upper, t.ws.ls);
    const px = Math.min(300 * k, (0.88 * safeW) / (wEm * 1));
    if (px >= 240 * k) { t.px = round2(px); t.anim = 'E6'; } else title = false;
  }
  for (const l of lw) { const m = measure(l.pw, l.ws, l.px); l.w = m.w; l.h = m.h; }

  const isRunning = lw.every(l => l.role === 'running');
  if (isRunning) {
    const bw = Math.max(...lw.map(l => l.w)), bh = Math.max(...lw.map(l => l.h));
    for (const l of lw) { l.dx = round2((bw - l.w) / 2); l.dy = round2((bh - l.h) / 2); }
    return {lw, block: {w: round2(bw), h: round2(bh)}, title};
  }
  // rows. A punch / CTA phrase is wrapped into balanced centred lines (never one word per row, never words pushed to opposite edges);
  // otherwise consecutive leading connectors share a row and everything else gets its own row; <= MAX_BLOCK_ROWS (a punch phrase may use one more)
  const rows: LW[][] = [];
  const allPunch = lw.every(l => l.role === 'punch');
  const gapOf = (l: LW) => 0.28 * l.px;
  if (allPunch) {
    const limit = 0.94 * safeW / REST_GROWTH;
    let cur: LW[] = [];
    let curW = 0;
    for (const l of lw) {
      const add = cur.length ? gapOf(l) + l.w : l.w;
      if (cur.length && curW + add > limit) { rows.push(cur); cur = [l]; curW = l.w; } else { cur.push(l); curW += add; }
    }
    if (cur.length) rows.push(cur);
    // balance: move the last word of a long row down when the final row is a lone short word
    while (rows.length > MAX_BLOCK_ROWS + 1) { const tail = rows.pop()!; rows[rows.length - 1]!.push(...tail); }
  } else {
    for (const l of lw) {
      const last = rows[rows.length - 1];
      if (last && l.role === 'connector' && last.every(x => x.role === 'connector') && last.length < 3) last.push(l); else rows.push([l]);
    }
    while (rows.length > MAX_BLOCK_ROWS) { const tail = rows.pop()!; rows[rows.length - 1]!.push(...tail); }
  }
  const heroRow = rows.findIndex(r => r.some(l => l.role === 'hero' || l.role === 'punch'));
  const rowW = rows.map(r => r.reduce((s, l, i) => s + l.w + (i ? gapOf(l) : 0), 0));
  const rowH = rows.map(r => Math.max(...r.map(l => l.h)));
  const lead = opts.lead ?? 0.88; // tight leading
  const centre: number[] = [];
  rows.forEach((_, i) => centre.push(i === 0 ? rowH[0]! / 2 : centre[i - 1]! + (lead * (rowH[i - 1]! + rowH[i]!)) / 2));
  const top = rows.map((_, i) => centre[i]! - rowH[i]! / 2);
  const minTop = Math.min(...top);
  const bw = Math.max(...rowW);
  rows.forEach((r, i) => {
    let x = opts.centerRows === false ? (i > heroRow && heroRow >= 0 ? bw - rowW[i]! : 0) : (bw - rowW[i]!) / 2;
    for (const l of r) {
      l.row = i;
      l.dx = round2(x);
      l.dy = round2(top[i]! - minTop + rowH[i]! - l.h);
      x += l.w + gapOf(l);
    }
  });
  const minDy = Math.min(...lw.map(l => l.dy));
  if (minDy < 0) for (const l of lw) l.dy = round2(l.dy - minDy);
  const bh = Math.max(...lw.map(l => l.dy + l.h));
  return {lw, block: {w: round2(Math.max(bw, ...lw.map(l => l.dx + l.w))), h: round2(bh)}, title};
}

// ---------------------------------------------------------------------------------------------------------------- zones

type Cluster = {lw: LW[]; built: Built; suffix: string; cx: number; cy: number; s: number; /** smallest scale this cluster may shrink to (its readability floor for the pass that found it) */ minS: number; layering: 'front' | 'behind'; /** per word: which side of the subject foreground it draws on (stackOverCutout) */ layers?: Array<'front' | 'behind'>};
type RectPx = Rect;
const rw = (r: Rect) => r.right - r.left;
const rh = (r: Rect) => r.bottom - r.top;

/**
 * Ordered zone candidates: explicit intent first, then the rules (subject left -> type right, subject right -> type left, free space above -> upper, last resort the chest line).
 * `flank` (a left cluster + a right cluster) is only for a truly centred subject AND a phrase that is not one sentence: one phrase is one reading block, never split across the frame.
 * An `estimated` box (no matte: a centred default, not a measurement) never earns a gutter: nothing is parked beside a guess.
 */
export function zoneCandidates(hint: TextEvent['regionHint'], box: {x: number; y: number; w: number; h: number}, allRunning: boolean, title: boolean, opts: {onePhrase?: boolean; estimated?: boolean} = {}): ZoneName[] {
  if (allRunning || title) return ['running'];
  const onePhrase = opts.onePhrase ?? true;
  const cx = box.x + box.w / 2;
  const auto: ZoneName[] = [];
  if (opts.estimated) {
    if (box.y >= 0.2) auto.push('upper');
  } else {
    if (cx < 0.42) auto.push('besideRight');
    else if (cx > 0.58) auto.push('besideLeft');
    else if (box.w < 0.62 && !onePhrase) auto.push('flank', 'besideRight', 'besideLeft');
    else if (box.w < 0.62) auto.push(cx <= 0.5 ? 'besideRight' : 'besideLeft', cx <= 0.5 ? 'besideLeft' : 'besideRight');
    else auto.push('besideRight', 'besideLeft');
    if (box.y >= 0.34) auto.push('upper');
  }
  auto.push('running');
  const explicit: ZoneName[] = hint === 'besideLeft' || hint === 'besideRight' || hint === 'flank' || hint === 'upper' || hint === 'running' || hint === 'behindSignature' || hint === 'stackOverCutout' ? [hint] : [];
  return [...new Set([...explicit, ...auto])].filter(z => !(z === 'flank' && onePhrase) && !(opts.estimated && (z === 'besideLeft' || z === 'besideRight' || z === 'flank')));
}

/** True when the event's words read as one sentence (no inner sentence end, no long pause): such a lockup is ONE block. */
export function isOnePhrase(ev: TextEvent, words: KineticWord[], fps: number): boolean {
  const [a, b] = ev.wordRange;
  for (let i = a; i < b; i += 1) {
    const w = words[i], n = words[i + 1];
    if (!w || !n) continue;
    if (/[.!?]$/.test(w.text) || (n.startFrame - w.endFrame) / fps > 0.6) return false;
  }
  return true;
}

function subjectPx(scene: ShotScene, f0: number, f1: number, width: number, height: number): Rect {
  const b = boxSpan(scene, f0, f1);
  return {left: b.x * width, right: (b.x + b.w) * width, top: b.y * height, bottom: (b.y + b.h) * height};
}

function fit(block: {w: number; h: number}, R: Rect, pad: number): number {
  return Math.min(1, (rw(R) - 2 * pad) / (block.w * REST_GROWTH), (rh(R) - 2 * pad) / (block.h * REST_GROWTH));
}

function placeIn(block: {w: number; h: number}, R: Rect, pad: number, anchorY: number, minS = MIN_SCALE): {cx: number; cy: number; s: number} | null {
  const s = fit(block, R, pad);
  if (s < minS) return null;
  const hw = (block.w * s * REST_GROWTH) / 2 + pad, hh = (block.h * s * REST_GROWTH) / 2 + pad;
  return {s, cx: clamp((R.left + R.right) / 2, R.left + hw, R.right - hw), cy: clamp(anchorY, R.top + hh, R.bottom - hh)};
}

// ---------------------------------------------------------------------------------------------------------------- keyframes

export {entryPose};

type WordKeyArgs = {anim: AnimName; enterAbs: number; fps: number; bw: number; k: number; t: number; exitAbs: number | null; width: number; dir: number; wordW: number; /** block-wide word-level exit (OUT-2/3/4/7), absent for the others */ blockExit?: {exit: ExitName; start: number; /** frames the exit lasts (<= the library duration when the lockup is short) */ n: number} | null};

function wordKeys(a: WordKeyArgs): WordKeyframe[] {
  const n = entryFrames(a.anim, a.fps);
  const byFrame = new Map<number, WordKeyframe>();
  if (a.enterAbs > 0) byFrame.set(a.enterAbs - 1, {...IDENT(a.enterAbs - 1), opacity: 0, mask: 0});
  // Never sample entrance / settle past the swap-exit start — a settle IDENT after X2 was resurrecting
  // opacity to 1 and stacking the previous word on top of the next (unreadable pile-ups on fast speech).
  const hardEnd = a.exitAbs !== null ? a.exitAbs : Number.POSITIVE_INFINITY;
  const ctx: PoseCtx = {fps: a.fps, bw: a.bw, k: a.k, t: a.t, width: a.width, dir: a.dir, wordW: a.wordW};
  for (let i = 0; i < n; i += 1) {
    const f = a.enterAbs + i;
    if (f >= hardEnd) break;
    byFrame.set(f, {...entryPose(a.anim, i, ctx), frame: f});
  }
  const settle = a.enterAbs + n;
  if (settle < hardEnd) byFrame.set(settle, IDENT(settle));
  if (a.exitAbs !== null) {
    const m = exitFrames('X2', a.fps);
    for (let i = 0; i <= m; i += 1) {
      const f = a.exitAbs + i;
      const ex = expoIn(i / m);
      const cur = byFrame.get(f) ?? IDENT(f);
      byFrame.set(f, {...cur, frame: f, opacity: cur.opacity * (1 - ex), blurPx: cur.blurPx + 6 * ex, y: cur.y + 8 * a.k * ex});
    }
    const exitEnd = a.exitAbs + m;
    for (const f of [...byFrame.keys()]) if (f > exitEnd) byFrame.delete(f);
  } else if (a.blockExit) {
    // word-level exit of the whole lockup (OUT-2 / OUT-3 smear, OUT-4 defocus, OUT-7 ghost dim): sampled densely, identity at the first frame so the hold stays clean
    const m = Math.max(1, a.blockExit.n);
    for (let i = 0; i <= m; i += 1) {
      const f = a.blockExit.start + i;
      const pose = wordExitPose(a.blockExit.exit, i / m);
      const cur = byFrame.get(f) ?? IDENT(f);
      byFrame.set(f, {...cur, frame: f, opacity: cur.opacity * (pose.opacity ?? 1), blurPx: cur.blurPx + (pose.blurPx ?? 0), scale: cur.scale * (pose.scale ?? 1), scaleX: cur.scaleX * (pose.scaleX ?? 1)});
    }
    for (const f of [...byFrame.keys()]) if (f > a.blockExit.start + m) byFrame.delete(f);
  }
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  return [...byFrame.values()].sort((x, y) => x.frame - y.frame).map(kf => ({...kf, x: round2(kf.x), y: round2(kf.y), scale: r4(kf.scale), scaleX: r4(kf.scaleX), opacity: r4(kf.opacity), blurPx: round2(kf.blurPx), z: round2(kf.z), rotateX: round2(kf.rotateX), rotateY: round2(kf.rotateY), split: round2(kf.split), ghost: r4(kf.ghost), trackingEm: Math.round(kf.trackingEm * 1000) / 1000, mask: Math.round(kf.mask * 1000) / 1000, glowK: Math.round(kf.glowK * 1000) / 1000}));
}

// ---------------------------------------------------------------------------------------------------------------- window

const HOLD_AFTER_30 = {hero: 18, punch: 18, support: 12, connector: 8, running: 4} as const;
export function playbookWindow(ev: TextEvent, words: KineticWord[], shot: KineticShot, fps: number): {inFrame: number; outFrame: number} {
  const [a, b] = ev.wordRange;
  const lead = ev.lines.some(l => l.role === 'hero' || l.role === 'punch') ? 2 : 1;
  let inFrame = Math.max(0, words[a]!.startFrame - lead);
  const dom = ev.lines.some(l => l.role === 'hero') ? 'hero' : ev.lines.some(l => l.role === 'punch') ? 'punch' : ev.lines.some(l => l.role === 'support') ? 'support' : ev.lines.every(l => l.role === 'caption' || l.role === 'running') ? 'running' : 'connector';
  let outFrame = words[b]!.endFrame + fpsScale(HOLD_AFTER_30[dom], fps);
  if (!ev.persistAcrossCut) { inFrame = Math.max(inFrame, shot.startFrame); outFrame = Math.min(outFrame, shot.endFrame); }
  return {inFrame, outFrame};
}

// ---------------------------------------------------------------------------------------------------------------- the solver

const hash01 = (s: string): number => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };

/** Front-hero cycle. Flat stays in the rotation so a video is not only angled type. */
export const POSE_CYCLE: PoseName[] = ['recede', 'isometric', 'trapezoid', 'slant', 'flat'];

export function resolvePose(ev: TextEvent, zone: ZoneName, hasHero: boolean, vary: boolean, state: PlaybookState): PoseName {
  if (ev.pose) return ev.pose;
  if (!vary || !hasHero || zone === 'behindSignature' || zone === 'stackOverCutout') return 'flat';
  const pose = POSE_CYCLE[state.poseRot % POSE_CYCLE.length]!;
  state.poseRot += 1;
  return pose;
}

/** Resting camera. Left-side type recedes toward the left edge (the side nearer the subject stays larger). */
export function poseRest(pose: PoseName, cx: number, width: number): {rx: number; ry: number} {
  const towardSubject = cx < width / 2 ? -1 : 1;
  if (pose === 'recede') return {rx: 7, ry: towardSubject * 34};
  if (pose === 'isometric') return {rx: -28, ry: 38};
  if (pose === 'trapezoid') return {rx: 26, ry: towardSubject * 6};
  if (pose === 'slant') return {rx: 3, ry: towardSubject * 10};
  return {rx: 0, ry: 0};
}

function eventAccent(ev: TextEvent, scene: ShotScene, state: PlaybookState, notes: string[]): string {
  const bg = lumToHex(scene.luminance);
  let hex = resolveAccent(ev.accent);
  if (!hex) {
    const pool = plateAccents(scene.plateColor, bg);
    hex = pool[state.accentRot % pool.length]!;
    state.accentRot += 1;
    notes.push(`accent ${hex} derived from the plate (${scene.plateColor ?? 'luminance only'})`);
  }
  const n = nudgeForContrast(hex, bg);
  if (n.nudged) notes.push(`accent ${hex} -> ${n.hex}: brightness nudged for contrast on the plate (hue kept)`);
  return n.hex;
}

type Motion = {exit: ExitName; heroEnter: AnimName | null; pair: string | null};

/**
 * Tag -> frames: pick the entry of every word and the exit of the lockup from the library. The director's tags win; otherwise the style pools rotate.
 * The same entry+exit pair is never used on two consecutive lockups (the solver changes the exit, then the entry, when a tag repeats).
 */
function pickMotion(a: PlaybookArgs, ev: TextEvent, lw: LW[], flags: {isLast: boolean; endsOnCut: boolean; titleBlock: boolean; running: boolean}): Motion {
  const {style, state, fps} = a;
  const heroAt = lw.findIndex(l => l.role === 'hero' || l.role === 'punch');
  const heroLine = heroAt >= 0 ? lw[heroAt]! : null;
  const letters = heroLine ? Array.from(heroLine.pw.text.replace(/[^a-z0-9]/gi, '')).length : 0;
  const isScript = heroLine?.ws.font === 'pacifico';
  const legalHeroEnter = (e: AnimName): boolean => (e === 'IN-8' ? isScript : e === 'IN-7' ? !isScript && letters >= 4 && letters <= 12 : e.startsWith('IN-') && e !== 'IN-11');
  let pool: AnimName[] = heroLine ? [...(heroLine.role === 'punch' ? PUNCH_ENTER_POOL : HERO_ENTER_POOL[style])] : [];
  pool = pool.filter(legalHeroEnter);
  if (isScript) pool = ['IN-8', ...pool];
  if (pool.length === 0) pool = ['IN-2'];
  const exitPool: ExitName[] = [...HERO_EXIT_POOL[style]];

  // ---- exit
  const want = ev.exit;
  const legacyWant = want && /^X\d$/.test(want) ? want : null;
  let exit: ExitName;
  if (flags.titleBlock) exit = 'OUT-4';
  else if (legacyWant) exit = (legacyWant === 'X6' && state.x6Used) || (legacyWant === 'X2') ? exitPool[0]! : legacyWant === 'X5' && !flags.isLast ? 'X3' : legacyWant;
  else if (flags.running) exit = 'OUT-4';
  else if (flags.isLast) exit = 'OUT-7';
  else if (flags.endsOnCut) exit = 'OUT-5';
  else if (want && want !== 'OUT-7' && want !== 'OUT-6' && want !== 'OUT-5') exit = want;
  else exitPool.length ? (exit = exitPool[state.rot % exitPool.length]!) : (exit = 'OUT-2');
  if (exit === 'X6') state.x6Used = true;

  // ---- entries: the lead-ins alternate IN-1 / IN-3 unless tagged; the hero / punch word rotates through the pool unless tagged
  const wantedHero = ev.enter && legalHeroEnter(ev.enter) ? ev.enter : null;
  let heroEnter: AnimName | null = null;
  const rot = state.rot;
  if (heroLine) {
    heroEnter = wantedHero ?? pool[rot % pool.length]!;
    const heroDriven = !flags.titleBlock && !flags.running;
    if (heroDriven) {
      const pairOf = (e: AnimName, x: ExitName) => `${e}|${x}`;
      if (pairOf(heroEnter, exit) === state.lastPair) {
        // same pair as the previous lockup: change the exit when the library offers another, then the entry
        const exits = [...new Set([...exitPool, 'OUT-2', 'OUT-1', 'OUT-4'] as ExitName[])].filter(x => x !== 'OUT-7' && x !== 'OUT-5' || x === exit);
        const alt = (!flags.isLast && !flags.endsOnCut && !legacyWant ? exits : []).find(x => pairOf(heroEnter!, x) !== state.lastPair);
        if (alt) exit = alt;
        else {
          const e2 = [...pool, ...HERO_ENTER_POOL.cinematicClean.filter(legalHeroEnter)].find(e => pairOf(e, exit) !== state.lastPair);
          if (e2) heroEnter = e2;
        }
      }
      state.lastPair = pairOf(heroEnter, exit);
    }
    state.rot += 1;
  }
  lw.forEach((l, i) => {
    if (i === heroAt) { l.anim = heroEnter!; return; }
    if (flags.titleBlock) { l.anim = 'E6'; return; }
    const tagged = l.pw.enter && l.pw.enter !== 'IN-8' && l.pw.enter !== 'IN-7' ? l.pw.enter : null;
    if (flags.running) { l.anim = tagged ?? 'IN-1'; return; }
    l.anim = tagged ?? LEAD_ENTER_POOL[state.leadRot++ % LEAD_ENTER_POOL.length]!;
  });
  void fps;
  return {exit, heroEnter, pair: heroEnter ? `${heroEnter}|${exit}` : null};
}

/** Legacy block-level presets (3D / behind stacks) take the library entries and exits whose pose stays inside the safe rect (the block is one element: no per-word scaleX / whip). */
export const LEGACY_ENTERS: AnimName[] = ['IN-2', 'IN-5', 'IN-1', 'IN-10', 'IN-4'];
export const LEGACY_EXITS: ExitName[] = ['OUT-4', 'OUT-2'];
export function pickLegacyMotion(state: PlaybookState, ev: TextEvent, isLast: boolean): {enter: AnimName; exit: ExitName} {
  let enter: AnimName = ev.enter && LEGACY_ENTERS.includes(ev.enter) ? ev.enter : LEGACY_ENTERS[state.rot % LEGACY_ENTERS.length]!;
  let exit: ExitName = isLast ? 'OUT-7' : ev.exit && (ev.exit === 'OUT-2' || ev.exit === 'OUT-3' || ev.exit === 'OUT-4') ? ev.exit : LEGACY_EXITS[state.rot % LEGACY_EXITS.length]!;
  if (`${enter}|${exit}` === state.lastPair) {
    const alt = LEGACY_EXITS.find(x => !isLast && `${enter}|${x}` !== state.lastPair);
    if (alt) exit = alt; else enter = LEGACY_ENTERS.find(e => `${e}|${exit}` !== state.lastPair) ?? enter;
  }
  state.rot += 1;
  state.lastPair = `${enter}|${exit}`;
  return {enter, exit};
}

export function solvePlaybookEvent(a: PlaybookArgs): PlaybookResult {
  const {ev, style, words, shot, scene, width, height, fps, state} = a;
  const k = width / 1080;
  const safe = shortsSafeRect(width, height);
  const safeR: Rect = {left: safe.left, right: safe.right, top: safe.top, bottom: safe.bottom};
  const notes: string[] = [];
  const actions: PlaybookResult['actions'] = [];
  const win = playbookWindow(ev, words, shot, fps);
  const {pw, notes: wn} = expandWords(ev, words);
  notes.push(...wn);
  if (pw.length === 0) return {events: [], notes, actions, dropped: 'no words'};
  const allRunning = pw.every(w => w.role === 'running');
  const inFrame0 = win.inFrame;
  const sb = subjectPx(scene, win.inFrame, win.outFrame, width, height);
  const box = boxSpan(scene, win.inFrame, win.outFrame);
  const perspectivePx = Math.max(900, width * 1.4);
  const onePhrase = isOnePhrase(ev, words, fps);
  const estimated = scene.estimated || scene.noMatte;
  if (estimated) notes.push('subject box is an estimate (no matte): no gutter / flank placement');
  void inFrame0;

  // ---- title moment (cinematicClean, rare)
  const titleRequested = Boolean(ev.title) && style === 'cinematicClean' && pw.length === 1 && pw[0]!.role === 'hero';
  const titleOk = titleRequested && state.titleFrames.every(f => Math.abs(win.inFrame - f) >= TITLE_WINDOW_SEC * fps);

  const keepBottom = sb.top + FACE_FRACTION * (sb.bottom - sb.top) + 0.015 * height;
  const pad = 14 * k;
  const gapPx = 0.03 * width;
  const regions = {
    besideRight: {left: sb.right + gapPx, right: safeR.right, top: safeR.top, bottom: safeR.bottom} as RectPx,
    besideLeft: {left: safeR.left, right: sb.left - gapPx, top: safeR.top, bottom: safeR.bottom} as RectPx,
    upper: {left: safeR.left, right: safeR.right, top: safeR.top, bottom: sb.top - gapPx} as RectPx,
  };
  const headY = sb.top + 0.3 * (sb.bottom - sb.top);

  // ---- behind-the-head signature / stack over the cutout: legal whenever a matte exists (RVM ran), rare by cap
  const behindFree = !scene.noMatte && scene.alphaAreaFrac <= FORCE_FRONT_ALPHA_AREA && win.inFrame - state.lastBehindFrame >= BEHIND_WINDOW_SEC * fps;
  const stackFree = !scene.noMatte && scene.alphaAreaFrac <= FORCE_FRONT_ALPHA_AREA && win.inFrame - state.lastStackFrame >= BEHIND_WINDOW_SEC * fps;
  const candidates = zoneCandidates(ev.regionHint, box, allRunning, titleOk, {onePhrase, estimated});
  if (ev.regionHint === 'stackOverCutout' && !stackFree) notes.push(scene.noMatte ? 'stackOverCutout refused: no matte (RVM did not return one)' : 'stackOverCutout refused (cap / alpha area): normal zones');
  if (ev.regionHint === 'behindSignature' && !behindFree) notes.push(scene.noMatte ? 'behindSignature refused: no matte (RVM did not return one)' : 'behindSignature refused (cap / alpha area): in front, in a gutter');

  type Plan = {zone: ZoneName; clusters: Cluster[]; heroShrink: number};
  /** minFactor scales the readability floor: 1 = the floor itself, < 1 = the soft passes that only run when nothing fits at the floor */
  const mk = (pws: PW[], heroShrink: number, title = false): Built => buildBlock(pws, style, width, rw(safeR), {heroShrink, title, fontPair: a.fontPair});
  const minSOf = (built: Built, minFactor: number): number => Math.max(minFactor >= 1 ? 0 : MIN_SCALE, minFactor * floorScaleOf(built.lw, height));
  /** stackOverCutout: row 0 (connectors / a short lead) rests just above the subject box (front); the hero row and everything after it steps down over the head / shoulders (behind the matte). */
  const solveStack = (minFactor: number): Plan | null => {
    const gap = 0.012 * height;
    const sbNow = subjectPx(scene, win.inFrame, win.inFrame, width, height);
    const subjCx = (sbNow.left + sbNow.right) / 2;
    let best: {c: Cluster; cost: number} | null = null;
    for (const lead of [0.9, 0.85, 0.95]) {
      const built = buildBlock(pw, style, width, rw(safeR), {heroShrink: 1, title: false, lead, centerRows: true, fontPair: a.fontPair});
      const maxRow = Math.max(...built.lw.map(l => l.row));
      const row0 = built.lw.filter(l => l.row === 0);
      if (maxRow < 1 || row0.some(l => l.role === 'hero' || l.role === 'punch') || !built.lw.some(l => l.role === 'hero' || l.role === 'punch')) continue;
      const bottom0 = Math.max(...row0.map(l => l.dy + l.h));
      const layers = built.lw.map(l => (l.row === 0 ? 'front' : 'behind')) as Array<'front' | 'behind'>;
      const minS = minSOf(built, minFactor);
      for (const s0 of [1, 0.92, 0.85, 0.78, 0.7, 0.62]) {
        const s = Math.min(s0, fit(built.block, safeR, pad));
        if (s < Math.max(MIN_SCALE, minS)) continue;
        const off = bottom0 - built.block.h / 2;
        const cy = sbNow.top - gap - off * s * (off > 0 ? REST_GROWTH : 1);
        const hw = (built.block.w * s * REST_GROWTH) / 2 + pad, hh = (built.block.h * s * REST_GROWTH) / 2 + pad;
        if (cy - hh < safeR.top || cy + hh > safeR.bottom) continue;
        const cx = clamp(subjCx, safeR.left + hw, safeR.right - hw);
        const c: Cluster = {lw: built.lw, built, suffix: '', cx, cy, s, minS, layering: 'behind', layers};
        const probe = probeEvent(c, a, perspectivePx, k);
        const occ = lineOcclusions(probe, scene, a.depth, width, height);
        const edges = lineEdgeOcclusions(probe, scene, a.depth, width, height);
        let ok = true, heroMean = 0;
        built.lw.forEach((l, i) => {
          if (layers[i] === 'front') { if (occ[i]!.max > 0.02) ok = false; return; }
          if (l.role === 'hero' || l.role === 'punch') {
            heroMean = occ[i]!.mean;
            if (!heroReadable(occ[i]!, edges[i]!)) ok = false;
          } else if (occ[i]!.mean > 0.5) ok = false; // a following line must stay readable
        });
        const cost = Math.abs(heroMean - HERO_OCC_PREF) + (1 - s) * 0.6 + Math.abs(lead - 0.9) * 0.2;
        if (ok && (!best || cost < best.cost)) best = {c, cost};
      }
    }
    return best ? {zone: 'stackOverCutout', clusters: [best.c], heroShrink: 1} : null;
  };
  const tryZone = (zone: ZoneName, heroShrink: number, minFactor: number): Plan | null => {
    if (zone === 'behindSignature') {
      if (!behindFree || ev.regionHint !== 'behindSignature') return null;
      const built = mk(pw, heroShrink);
      if (!built.lw.some(l => l.role === 'hero' || l.role === 'punch')) return null;
      const minS = minSOf(built, minFactor);
      let best: {c: Cluster; cost: number} | null = null;
      for (const s0 of [1, 0.92, 0.85]) {
        const s = Math.min(s0, fit(built.block, safeR, pad));
        if (s < Math.max(MIN_SCALE, minS)) continue;
        const prefY = sb.top - 0.02 * height; // rest just above the cap so the last letters peek, not sit through the face
        for (let cy = safeR.top + (built.block.h * s * REST_GROWTH) / 2 + pad; cy <= safeR.bottom - (built.block.h * s * REST_GROWTH) / 2 - pad; cy += 0.02 * height) {
          for (const ox of [0, -0.08, 0.08, -0.14, 0.14].map(f => f * width)) {
            const cx = clamp(width / 2 + ox, safeR.left + (built.block.w * s * REST_GROWTH) / 2 + pad, safeR.right - (built.block.w * s * REST_GROWTH) / 2 - pad);
            const c: Cluster = {lw: built.lw, built, suffix: '', cx, cy, s, minS, layering: 'behind'};
            const probe = probeEvent(c, a, perspectivePx, k);
            const occ = lineOcclusions(probe, scene, a.depth, width, height);
            const edges = lineEdgeOcclusions(probe, scene, a.depth, width, height);
            let ok = true, heroMean = 0, edgeCost = 0;
            built.lw.forEach((l, i) => {
              if (l.role === 'hero' || l.role === 'punch') {
                heroMean = occ[i]!.mean;
                edgeCost = edges[i]!.left + edges[i]!.right;
                if (!heroReadable(occ[i]!, edges[i]!)) ok = false;
              } else if (occ[i]!.max > SUPPORT_OCC_MAX) ok = false;
            });
            const cost = Math.abs(cy - prefY) / height + Math.abs(heroMean - HERO_OCC_PREF) + edgeCost * 0.8 + Math.abs(ox) / width * 0.15;
            if (ok && (!best || cost < best.cost)) best = {c, cost};
          }
        }
      }
      return best ? {zone, clusters: [best.c], heroShrink} : null;
    }
    if (zone === 'stackOverCutout') {
      if (!stackFree || ev.regionHint !== 'stackOverCutout') return null;
      return solveStack(minFactor);
    }
    if (zone === 'running') {
      // the chest block: the hero keeps its full size (the readability floor, not a -20% shrink) and the block is one centred column
      const built = mk(pw, heroShrink, titleOk);
      const minS = minFactor >= 1 ? minSOf(built, minFactor) : Math.min(minSOf(built, minFactor), MIN_SCALE);
      let s = Math.min(1, (rw(safeR) - 2 * pad) / (built.block.w * REST_GROWTH));
      for (let i = 0; i < 60; i += 1) {
        const hh = (built.block.h * s * REST_GROWTH) / 2;
        if (keepBottom + pad + hh <= safeR.bottom - pad - hh || s <= MIN_SCALE) break;
        s *= 0.97;
      }
      if (s < minS) return null;
      const hh = (built.block.h * s * REST_GROWTH) / 2;
      const lo = keepBottom + pad + hh, hi = safeR.bottom - pad - hh;
      const cy = hi >= lo ? clamp(0.66 * height, lo, hi) : hi;
      return {zone, clusters: [{lw: built.lw, built, suffix: '', cx: width / 2, cy, s, minS, layering: 'front'}], heroShrink};
    }
    if (zone === 'upper') {
      if (rh(regions.upper) < 0.1 * height) return null;
      const built = mk(pw, heroShrink);
      // slack for the pre-join pose (block up to 1.18x and 40px lower until the next row joins): the first rows must not dip into the face keep-out meanwhile
      const R = {...regions.upper, bottom: regions.upper.bottom - (40 * k + 0.1 * built.block.h)};
      const minS = minSOf(built, minFactor);
      const p = placeIn(built.block, R, pad, R.bottom, minS);
      return p ? {zone, heroShrink, clusters: [{lw: built.lw, built, suffix: '', cx: p.cx, cy: p.cy, s: p.s, minS, layering: 'front'}]} : null;
    }
    if (zone === 'besideLeft' || zone === 'besideRight') {
      const R = regions[zone];
      if (rw(R) < 0.14 * width) return null;
      const built = mk(pw, heroShrink);
      const minS = minSOf(built, minFactor);
      const p = placeIn(built.block, R, pad, headY, minS);
      return p ? {zone, heroShrink, clusters: [{lw: built.lw, built, suffix: '', cx: p.cx, cy: p.cy, s: p.s, minS, layering: 'front'}]} : null;
    }
    // flank (only reachable for a centred subject AND a multi-sentence event): a left cluster and a right cluster, the face column stays empty
    const heroIdx = pw.findIndex(w => w.role === 'hero' || w.role === 'punch');
    const cut = heroIdx > 0 ? heroIdx : 1;
    if (pw.length < 2) {
      const wider: ZoneName = rw(regions.besideLeft) >= rw(regions.besideRight) ? 'besideLeft' : 'besideRight';
      return tryZone(wider, heroShrink, minFactor);
    }
    const left = mk(pw.slice(0, cut), heroShrink), right = mk(pw.slice(cut), heroShrink);
    const mL = minSOf(left, minFactor), mR = minSOf(right, minFactor);
    const pl = placeIn(left.block, regions.besideLeft, pad, headY, mL), pr = placeIn(right.block, regions.besideRight, pad, headY, mR);
    if (!pl || !pr || rw(regions.besideLeft) < 0.1 * width || rw(regions.besideRight) < 0.1 * width) return null;
    return {zone, heroShrink, clusters: [
      {lw: left.lw, built: left, suffix: '.a', cx: pl.cx, cy: pl.cy, s: pl.s, minS: mL, layering: 'front'},
      {lw: right.lw, built: right, suffix: '.b', cx: pr.cx, cy: pr.cy, s: pr.s, minS: mR, layering: 'front'},
    ]};
  };

  let plan: Plan | null = null;
  const order: ZoneName[] = ev.regionHint === 'behindSignature' && behindFree ? ['behindSignature', ...candidates.filter(z => z !== 'behindSignature')] : candidates.filter(z => z !== 'behindSignature');
  // Readability first: pass 1 keeps every line at its floor (hero / punch >= 7.5% of the frame height, connectors / support >= 3.5%) and MOVES zones instead of shrinking.
  // Pass 2 (only when no zone holds the floor, e.g. a very long word) lets the block give up to 30% of the floor, widest zone first.
  for (const [pass, minFactor] of [[1, 1], [2, 0.7]] as const) {
    const zs = pass === 1 ? order : ['running' as ZoneName, ...order.filter(z => z !== 'running')];
    for (const z of zs) { plan = tryZone(z, 1, minFactor); if (plan) break; }
    if (plan) { if (pass === 2) notes.push('hero below the readability floor (word too long for any zone at the floor)'); break; }
  }
  if (!plan) { plan = tryZone('running', 0.8, 0)!; notes.push('no zone fits: running height, hero shrunk below the floor'); }
  if (plan.zone === 'stackOverCutout') { state.lastStackFrame = win.inFrame; actions.push({action: 'stack-over-cutout'}); }
  else if (ev.regionHint === 'stackOverCutout') actions.push({action: 'stack-refused'});
  if (plan.zone === 'behindSignature') { state.lastBehindFrame = win.inFrame; actions.push({action: 'behind-signature'}); }
  else if (ev.regionHint === 'behindSignature') actions.push({action: 'behind-refused'});

  // ---- accent (the director's hue for THIS plate; brightness only is nudged), font pair
  const events: RenderEvent[] = [];
  const hasHero = plan.clusters.some(c => c.lw.some(l => l.role === 'hero' || l.role === 'punch'));
  const pose = resolvePose(ev, plan.zone, hasHero, Boolean(a.varyPose), state);
  const posedPx = pose === 'recede' ? Math.max(640, width * 0.78) : pose === 'isometric' ? Math.max(780, width * 1.05) : perspectivePx;
  if (pose !== 'flat') notes.push(`pose ${pose}`);
  const accent = hasHero && (style === 'retroNeon' || ev.accent) ? eventAccent(ev, scene, state, notes) : null;
  const title = plan.clusters[0]!.built.title;
  if (title) state.titleFrames.push(win.inFrame);
  if (a.fontPair) notes.push(`fontPair ${a.fontPair}`);

  // ---- motion tags -> library (one pick per lockup; flank clusters share it)
  const allLw = plan.clusters.flatMap(c => c.lw);
  const outGuess = Math.min(a.limitOut, win.outFrame);
  const motion = pickMotion(a, ev, allLw, {isLast: a.isLast, endsOnCut: !a.isLast && outGuess >= shot.endFrame - fpsScale(6, fps) && !ev.persistAcrossCut, titleBlock: title, running: allRunning});
  notes.push(`motion ${motion.pair ?? allLw.map(l => l.anim).join('/') + '|' + motion.exit}`);

  for (const [ci, c] of plan.clusters.entries()) {
    const built = solveCluster(c, a, plan.zone, accent, posedPx, safeR, k, win, ci === plan.clusters.length - 1, title, motion.exit, pose);
    events.push(...built);
  }
  return {events, notes, actions};
}

/** A throw-away event for occlusion probing (hold pose only). */
function probeEvent(c: Cluster, a: PlaybookArgs, perspectivePx: number, k: number): Pick<RenderEvent, 'lines' | 'block' | 'keyframes' | 'perspectivePx'> {
  void k;
  const kf: Keyframe = {frame: 0, x: c.cx, y: c.cy, scale: c.s, opacity: 1, rotateX: 0, rotateY: 0, blurPx: 0, z: 0};
  return {block: c.built.block, perspectivePx, keyframes: [kf, {...kf, frame: 10}], lines: c.lw.map(l => toLine(l, 0, 0, -1, [], '#FFFFFF', null))};
}

function toLine(l: LW, startRel: number, enterRel: number, exitRel: number, kfs: WordKeyframe[], color: string, glow: RenderLine['glow'], layer?: 'front' | 'behind'): RenderLine {
  return {
    text: l.ws.upper ? l.pw.text.toUpperCase() : l.pw.text,
    role: l.role,
    font: l.ws.font,
    fontPx: l.px,
    italic: l.ws.italic,
    weight: l.ws.weight,
    letterSpacingEm: l.ws.ls,
    uppercase: l.ws.upper,
    dx: l.dx, dy: l.dy, w: l.w, h: l.h,
    fill: {kind: 'solid', colors: [color], angleDeg: 90},
    revealFrames: [], swapWords: [], swapFrames: [], wordFills: [],
    anim: l.anim,
    startFrame: startRel,
    enterFrame: enterRel,
    color,
    glow,
    textOpacity: l.ws.opacity,
    zPx: Z_BY_ROLE[l.role],
    exitFrame: exitRel < 0 ? null : exitRel,
    wordKeyframes: kfs,
    ...(layer ? {layer} : {}),
  };
}

function solveCluster(c: Cluster, a: PlaybookArgs, zone: ZoneName, accent: string | null, perspectivePx: number, safeR: Rect, k: number, win: {inFrame: number; outFrame: number}, lastCluster: boolean, titleBlock: boolean, exit: ExitName, pose: PoseName = 'flat'): RenderEvent[] {
  void lastCluster;
  const {ev, style, words, shot, scene, fps, width, height} = a;
  const id = ev.id + c.suffix;
  const lw = c.lw;
  // ---- per-word timing: lands with the sound (1-2 frames early), never faster than speech
  const enterAbs: number[] = [];
  lw.forEach((l, i) => {
    const lead = l.role === 'hero' || l.role === 'punch' ? 2 : 1;
    let e = Math.max(0, l.pw.start - lead, i ? enterAbs[i - 1]! : 0);
    if (!ev.persistAcrossCut) e = Math.max(e, shot.startFrame);
    enterAbs.push(e);
  });
  const inFrame = Math.min(win.inFrame, enterAbs[0]!);
  const running = lw.every(l => l.role === 'running');
  const lastL = lw[lw.length - 1]!;
  const lastChars = Array.from(lastL.pw.text).length;
  let outFrame = Math.min(a.limitOut, Math.max(win.outFrame, enterAbs[enterAbs.length - 1]! + entryTotalFrames(lastL.anim, fps, lastChars) + 2));
  if (!ev.persistAcrossCut) outFrame = Math.min(outFrame, shot.endFrame);
  outFrame = Math.max(outFrame, Math.min(inFrame + 6, shot.endFrame));
  const life = Math.max(1, outFrame - inFrame);

  // ---- exit (chosen by pickMotion: library OUT-* or a legacy X tag)
  // the exit never starts before the last word has finished entering; a lockup too short for a real exit hard-cuts
  const lastSettle = enterAbs[enterAbs.length - 1]! + entryTotalFrames(lastL.anim, fps, lastChars);
  let exitN = Math.max(0, Math.min(exitFrames(exit, fps) + (exit === 'X4' ? fpsScale(4, fps) : 0), Math.floor(life / 2), outFrame - lastSettle));
  if (exitN < 2 && exit !== 'X1' && exitFrames(exit, fps) > 0) exitN = 0;
  const exitStart = outFrame - exitN;
  const wordLevelExit = WORD_LEVEL_EXITS.has(exit) && exitN > 0;
  const flyDir = c.cx < width / 2 ? -1 : 1;

  // ---- colour / glow per word (a listed-tools peer block shares the accent so none of them looks like a leftover caption)
  const heroAt = lw.findIndex(l => l.role === 'hero') >= 0 ? lw.findIndex(l => l.role === 'hero') : lw.findIndex(l => l.role === 'punch');
  const peers = isPeerList(lw.map(l => ({text: l.pw.text, role: l.role})));
  const colors = lw.map((l, i) => (accent && (i === heroAt || (peers && (l.role === 'hero' || l.role === 'support'))) ? accent : '#FFFFFF'));
  const glows = lw.map((_, i) => (colors[i] !== '#FFFFFF' ? {color: colors[i]!, radiusPx: round2(14 * k), opacity: 0.55} : null));

  // ---- rows that join a block already on screen (E4)
  const rowFirstEnter = new Map<number, number>();
  lw.forEach((l, i) => { if (!rowFirstEnter.has(l.row)) rowFirstEnter.set(l.row, enterAbs[i]!); });
  const joins = running ? [] : [...rowFirstEnter.entries()].filter(([r]) => r > 0).map(([, f]) => f).filter(f => f > inFrame + 2 && f < exitStart).sort((x, y) => x - y);
  const E4N = entryFrames('E4', fps);

  const phase = hash01(`${a.seed}:${ev.id}`) * Math.PI * 2;
  const cam0 = a.cameraAt(inFrame);
  const exitWordFrame: Array<number | null> = lw.map((_, i) => (running && i < lw.length - 1 ? Math.max(enterAbs[i]!, enterAbs[i + 1]! - 1) : null));

  const make = (s: number, A: number): RenderEvent => {
    const nJoin = joins.length;
    const mult = (f: number) => {
      let m = 1, y = 0;
      joins.forEach(tj => {
        const e = f < tj ? 0 : expoOut((f - tj) / E4N);
        m *= A + (1 - A) * e;
        y += 40 * k * (A === 1 ? 0 : (A - 1) / 0.176) * (1 - e);
      });
      return {m, y};
    };
    const frames = new Set<number>([inFrame, outFrame, Math.max(inFrame, outFrame - 1)]);
    for (let f = inFrame; f < outFrame; f += 3) frames.add(f);
    for (let f = exitStart; f <= outFrame; f += 1) frames.add(f);
    for (const tj of joins) for (let f = tj; f <= Math.min(outFrame, tj + E4N); f += 1) frames.add(f);
    const kfs: Keyframe[] = [...frames].filter(f => f >= inFrame && f <= outFrame).sort((x, y) => x - y).map(f => {
      const ang = (2 * Math.PI * (f - inFrame)) / (HOLD.periodSec * fps) + phase;
      // hold: the scale eases 1.00 -> ~1.04 over the life of the lockup (never a static hold)
      const pp = Math.min(1, Math.max(0, (f - inFrame) / life));
      const push = 1 + (HOLD.push[1] - 1) * (0.5 - 0.5 * Math.cos(Math.PI * pp));
      const cam = a.cameraAt(f);
      const mm = nJoin ? mult(f) : {m: 1, y: 0};
      let x = c.cx + 8 * k * Math.sin(ang + 1) + CAMERA_BLEND * (cam.tx - cam0.tx);
      const y = c.cy + 6 * k * Math.sin(ang + 2.2) + CAMERA_BLEND * (cam.ty - cam0.ty) + mm.y;
      let scale = s * push * mm.m * (1 + CAMERA_BLEND * (cam.scale / (cam0.scale || 1) - 1));
      const rest = poseRest(pose, c.cx, width);
      let rotateY = rest.ry + HOLD.rotY * Math.sin(ang), blurPx = 0, z = 0, opacity = 1;
      const rotateX = rest.rx + HOLD.rotX * Math.sin(ang + 0.9);
      const hardCut = exit === 'X1' || exit === 'OUT-5' || exit === 'OUT-6';
      if (f >= exitStart && exitN > 0) {
        const p = Math.min(1, (f - exitStart) / exitN);
        if (hardCut) opacity = f >= outFrame ? 0 : 1;
        else if (exit === 'X3') { const ex = expoIn(p); opacity = 1 - ex; blurPx = 16 * ex; scale *= 1 + 0.06 * ex; z = 150 * ex; }
        else if (exit === 'X4') { const ex = expoIn(Math.min(1, (f - exitStart) / Math.max(1, exitFrames('X4', fps)))); opacity = 1 - 0.7 * ex; }
        else if (exit === 'X5') { const ex = expoIn(p); opacity = 1 - 0.75 * ex; blurPx = 2 * ex; }
        else if (exit === 'X6') { const ex = expoIn(p); x += 1.1 * width * ex; rotateY += -20 * ex; blurPx = 24 * ex; }
        else if (exit === 'OUT-1') {
          // fly-away: rotateY 0 -> 85 and x off-frame, the opacity dies in the last 2 frames
          const ex = expoIn(p);
          x += flyDir * (0.65 * width + (c.built.block.w * c.s) / 2) * ex;
          rotateY += flyDir * -85 * ex;
          blurPx = 14 * ex;
          opacity = f >= outFrame - 2 ? Math.max(0, (outFrame - f) / 2) : 1;
        }
        // OUT-2 / OUT-3 / OUT-4 / OUT-7 live on the words (scaleX / blur / opacity keyframes)
      } else if (hardCut && f >= outFrame) opacity = 0;
      return {frame: f, x: round2(x), y: round2(y), scale: Math.round(scale * 10000) / 10000, opacity: Math.round(opacity * 10000) / 10000, rotateX: round2(rotateX), rotateY: round2(rotateY), blurPx: round2(blurPx), z: round2(z)};
    });
    const baseLines: RenderLine[] = lw.map((l, i) => toLine(l, l.pw.start - inFrame, enterAbs[i]! - inFrame, exitWordFrame[i] === null ? -1 : exitWordFrame[i]! - inFrame, [], colors[i]!, glows[i]!, c.layers?.[i]));
    const shadowPx = 14 * k;
    const bg = lumToHex(scene.luminance);
    const worst = Math.min(...baseLines.map(l => worstContrast(l.fill.colors, bg)));
    const low = worst < CONTRAST_MIN;
    const ev0: RenderEvent = {
      id, shotId: shot.id, preset: ev.preset, presetResolved: 'type.words', inFrame, outFrame, fps,
      layering: c.layering, anchor: 'screen', material: 'flat', perspectivePx, block: c.built.block, lines: baseLines, keyframes: kfs,
      shadow: {color: 'rgba(0,0,0,0.35)', blurPx: round2(shadowPx), offsetY: round2(2 * k), strokePx: low ? round2(Math.max(1.5, 3 * k)) : 0, ...(low ? {strokeColor: contrastStrokeColor(scene.luminance)} : {}), glowPx: 0},
      depthBlurPx: 0, tint: null, occlusionFraction: {mean: 0, max: 0}, safeProof: {ok: true, sampledKeyframes: kfs.length, minMarginPx: 0},
      wordRange: ev.wordRange, persistAcrossCut: Boolean(ev.persistAcrossCut), notes: [],
      style, zone, exit, ...(pose !== 'flat' ? {pose} : {}), hold: {push: [HOLD.push[0], HOLD.push[1]], rotY: HOLD.rotY, rotX: HOLD.rotX, periodSec: HOLD.periodSec},
      flash: titleBlock ? {startFrame: enterAbs[0]! + 1, color: LEAK, opacities: Array.from({length: fpsScale(8, fps)}, (_, i) => round2(0.65 * (1 - expoOut(i / fpsScale(8, fps))) ))} : null,
    };
    // ---- per-word entrance (a library entry; shortened where its travel would leave the safe rect, except the wild ones), the IN-7 cascade split into characters
    const out: RenderLine[] = [];
    lw.forEach((l, i) => {
      const line = baseLines[i]!;
      const exitAbs = exitWordFrame[i] ?? null;
      const dir = (c.cx > width / 2 ? 1 : -1) * (i % 2 === 0 ? 1 : -1);
      const blockExit = wordLevelExit && exitAbs === null ? {exit, start: exitStart, n: exitN} : null;
      const baseArgs = {fps, bw: c.built.block.w, k, width, dir, wordW: l.w, exitAbs, blockExit};
      if (l.anim === 'IN-7' && l.pw.text.replace(/\s/g, '').length > 1) {
        // character cascade: one RenderLine per glyph, ~1 frame apart (grouped so the whole word lands in <= ~12 frames)
        const chars = Array.from(line.text);
        const visible = chars.filter(ch => ch.trim()).length;
        const group = Math.max(1, Math.ceil(Math.max(0, visible - 1) / 6));
        const stagger = Math.max(1, fpsScale(CASCADE_STAGGER_30, fps));
        let left = 0, vi = 0;
        for (const ch of chars) {
          const wCh = round2(textWidthEm(ch, l.ws.font, l.ws.weight, l.ws.upper, l.ws.ls) * l.px);
          if (ch.trim()) {
            const enter = enterAbs[i]! + Math.floor(vi / group) * stagger;
            vi += 1;
            const wk = wordKeys({...baseArgs, anim: 'IN-7', enterAbs: enter, t: 1});
            out.push({...line, text: ch, dx: round2(line.dx + left), w: wCh, startFrame: line.startFrame, enterFrame: enter - inFrame, wordKeyframes: wk});
          }
          left += wCh;
        }
        return;
      }
      for (const t of [1, 0.75, 0.5, 0.3, 0.15, 0]) {
        const wk = wordKeys({...baseArgs, anim: l.anim, enterAbs: enterAbs[i]!, t});
        const probe = {...ev0, lines: [{...line, wordKeyframes: wk}]};
        const n = entryFrames(l.anim, fps);
        let ok = true;
        if (!WILD_ENTRIES.has(l.anim)) {
          for (let f = enterAbs[i]!; f <= enterAbs[i]! + n && ok; f += 1) ok = marginInside(wordAabbAt(probe, probe.lines[0]!, f), safeR) >= -SAFE_TOLERANCE_PX;
        }
        if (ok || t === 0) { out.push({...line, wordKeyframes: wk}); return; }
      }
    });
    ev0.lines = out;
    return ev0;
  };

  // gutter / flank clusters must never touch the subject box (E4 pre-join poses are larger); running / upper stay off the face keep-out
  const sbNow = subjectPx(scene, inFrame, outFrame, width, height);
  const avoid: Rect = zone === 'running' || zone === 'upper' || zone === 'behindSignature' || zone === 'stackOverCutout' ? {...sbNow, bottom: sbNow.top + FACE_FRACTION * (sbNow.bottom - sbNow.top)} : sbNow;
  const layerOf = (e: RenderEvent, line: RenderLine): 'front' | 'behind' => line.layer ?? c.layering;
  const clearOfSubject = (e: RenderEvent, r: Rect): boolean => e.lines.every(line => layerOf(e, line) === 'behind' || (() => {
    const [f0, f1] = restingRange(e, line);
    for (let f = f0; f <= f1; f += 2) if (overlapFraction(wordAabbAt(e, line, f), r) > 0.01) return false;
    return true;
  })());

  // ---- fit loop: shrink the block until every resting pose (and every E4 pre-join pose) is inside the safe rect; never below the readability floor of this pass
  let s = c.s;
  let result: RenderEvent | null = null;
  const As = joins.length ? [1.1765, 1.15, 1.12, 1.09, 1.06, 1.03, 1] : [1];
  for (let attempt = 0; attempt < 80 && !result; attempt += 1) {
    for (const A of As) {
      const e = make(s, A);
      if (restingMargin(e, safeR) >= -SAFE_TOLERANCE_PX && clearOfSubject(e, avoid)) { result = e; break; }
    }
    if (!result) { s = s * 0.985 >= c.minS ? s * 0.985 : s > c.minS + 1e-9 ? c.minS : s * 0.985; if (s < MIN_SCALE) break; }
  }
  if (!result) { result = make(s, 1); result.notes.push('unresolved: resting ink leaves the safe rect'); }
  const rm = restingMargin(result, safeR);
  result.safeProof = {ok: rm >= -SAFE_TOLERANCE_PX - 1e-6, sampledKeyframes: result.keyframes.length, minMarginPx: round2(rm)};
  // ---- behind: measured occlusion of the hero
  if (c.layering === 'behind') {
    const occ = lineOcclusions(result, scene, a.depth, width, height);
    const hero = occ.filter((_, i) => result!.lines[i]!.role === 'hero' || result!.lines[i]!.role === 'punch');
    result.occlusionFraction = {mean: round2(hero.reduce((x, y) => x + y.mean, 0) / Math.max(1, hero.length)), max: round2(Math.max(0, ...hero.map(o => o.max)))};
  }
  void height;
  return [result];
}
