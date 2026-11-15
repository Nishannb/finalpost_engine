/**
 * MOTION-PLAYBOOK solver for the `type.words` preset. Pure + deterministic (seeded). The director only TAGS (style, word roles, zone / exit intent); everything below is decided here:
 * sizes, case, fonts, the zone (gutter first, behind is rare), the staggered stack, per-word frame keyframes (E1..E6), the block hold (push + sine drift + parallax) and the exit (X1..X6).
 * One RenderLine = one word. The compositor only interpolates the keyframes this file emits.
 */
import type {DecisionSink} from './diagnostics.ts';
import {shortsSafeRect} from '../broll/heroSweep.ts';
import type {CameraSample} from './camera.ts';
import type {DepthProvider} from './depth.ts';
import {interpolateKeyframes, marginInside, overlapFraction, restingMargin, restingRange, wordAabbAt, type Rect} from './geometry.ts';
import {lineFaceHitFrame, SAFE_TOLERANCE_PX, CONTRAST_MIN, FORCE_FRONT_ALPHA_AREA, HERO_OCC_PREF, SUPPORT_OCC_MAX, contrastStrokeColor, heroReadable, lineEdgeOcclusions, lineOcclusions, lumToHex, worstContrast} from './guardrails.ts';
import {CAMERA_BLEND, CASCADE_STAGGER_30, HERO_FLOOR_FRAC, HOLD, REST_GROWTH, SUPPORT_FLOOR_FRAC, Z_BY_ROLE, entryFrames, exitFrames, expoIn, expoOut, fpsScale} from './motion.ts';
import {HERO_ENTER_POOL, HERO_EXIT_POOL, IDENT, LEAD_ENTER_POOL, PUNCH_ENTER_POOL, WILD_ENTRIES, WORD_LEVEL_EXITS, entryPose, entryTotalFrames, wordExitPose, type PoseCtx} from './motionLibrary.ts';
import {nudgeForContrast, plateAccents, resolveAccent} from './accent.ts';
import type {KineticIdentity} from './presetIdentity.ts';
import {FONT_METRICS, textWidthEm} from './measure.ts';
import {chooseFitFace, faceCategory} from './fitFace.ts';
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
  /** V1: the user's caption identity (fonts / colours / case / outline / shadow). Absent = Kinetic's own look, byte-identical to before. */
  identity?: KineticIdentity | undefined;
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
  /** G2 / G6: receives a structured decision whenever the solver changes something the Director asked for. Never changes behaviour. */
  decide?: DecisionSink;
  /**
   * Bounded adaptation (Phase 4, default OFF = the solver exactly as before): when the Director asked for a specific zone and the block does not fit at the readability floor, the SAME zone is tried
   * once more at `ADAPT_FLOOR` of the floor (a small, recorded size reduction) BEFORE the block is moved to another zone. Never below ADAPT_FLOOR in the requested zone.
   */
  adapt?: boolean;
  /** Phase 4.2 (default OFF = the solver exactly as before): judge the face keep-out per frame like the verifier (zoom ramps) and, for a running block that no size clears, move it down before giving up. Set only by the production kinetic stage. */
  faceFrames?: boolean;
  /** Phase 4.8 (M4, default OFF; the production stage sets it): a hero / punch word that is wider than the usable safe width at its readability floor in the pair's face is set in the engine's condensed display face */
  fitHeroFace?: boolean;
  /** Phase 4.8 (M4, default OFF; the production stage sets it): the Phase 4.7 relocate-before-below-floor rung, independent of the adaptive mode */
  relocateBeforeFloor?: boolean;
  /**
   * Phase 5.15 (G3, default OFF = the motion choices exactly as before; the production Kinetic V2 stage sets it): keep valid Director motion choices and choose the remaining ones from context,
   * using the existing library only. A hero kept as a serif emphasis line keeps its entrance; a Director OUT-7 / OUT-5 is honoured where it means what it says (end of a thought / a hand-off);
   * running captions take their entry from the speech pace and their exit from the sentence boundary; editorial heroes take entry / exit from delivery and the sentence boundary; the resting
   * movement (hold) follows the block's role and never exceeds the previous one. No placement, size, face, readability, occupancy or occlusion rule changes.
   */
  motionVariety?: boolean;
};
/** the smallest share of the readability floor the adaptation rung may use (hero 7.5% of the frame height -> 6.4%: still large type) */
export const ADAPT_FLOOR = 0.85;
/** Display faces whose capitals fill the whole line box (no lowercase ascender / descender room to lean on). */
export const CAPS_FILL_FONTS: ReadonlySet<string> = new Set(['anton', 'archivoBlack', 'bebas']);
/** Minimum row-to-row lead next to a caps display row: the box height plus a ~6% gap, so rows never touch. */
export const CAPS_ROW_MIN_LEAD = 1.06;
export type PlaybookResult = {events: RenderEvent[]; notes: string[]; actions: Array<{action: string; detail?: string}>; dropped?: string};

// ---------------------------------------------------------------------------------------------------------------- words + roles

/**
 * Phase 5.15: resting-movement profiles (the block hold). `push` is the previous constant HOLD exactly (motion.ts) + its 8k / 6k drift; the others are calmer in EVERY component, so the
 * motion envelope (and every fit / face / safe-rect bound computed with REST_GROWTH) is never exceeded. Chosen by role: a hero lockup pushes, a support / emphasis block drifts, a running
 * caption settles (readability first: captions should barely move).
 */
export const HOLD_PROFILES = {
  push: {push: HOLD.push[1], rotY: HOLD.rotY, rotX: HOLD.rotX, periodSec: HOLD.periodSec, dx: 8, dy: 6},
  drift: {push: 1.025, rotY: 2, rotX: 1, periodSec: 6, dx: 6, dy: 4},
  settle: {push: 1.012, rotY: 0.8, rotX: 0.4, periodSec: 7, dx: 2, dy: 2},
} as const;
export type HoldProfileName = keyof typeof HOLD_PROFILES;
export function holdProfileFor(roles: ReadonlyArray<{role: Role; emphasis?: boolean}>, titleBlock: boolean): HoldProfileName {
  if (titleBlock || roles.some(l => l.role === 'hero' || l.role === 'punch')) return 'push';
  if (roles.every(l => l.role === 'running')) return 'settle';
  return 'drift';
}
/** Phase 5.15: the event's words end a thought (sentence punctuation, the end of the transcript, or a pause >= 0.45 s before the next word). */
export function endsThought(words: readonly KineticWord[], lastIdx: number, fps: number): boolean {
  const w = words[lastIdx], n = words[lastIdx + 1];
  if (!w || !n) return true;
  return /[.!?\u2026]["')\]]*$/.test(w.text) || n.startFrame - w.endFrame >= Math.round(0.45 * fps);
}

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
export function expandWords(ev: TextEvent, words: KineticWord[], decide?: DecisionSink): {pw: PW[]; notes: string[]} {
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
  if (pw.length > wordCap) { notes.push(`words ${pw.length} > ${wordCap}: clipped`); decide?.({eventId: ev.id, kind: 'trimmed', field: 'lines', requested: pw.map(w => w.text), produced: pw.slice(0, wordCap).map(w => w.text), code: 'trimmed.word_cap', reason: `a headline block holds at most ${wordCap} words; the last ${pw.length - wordCap} were cut`, constraint: 'discretionary'}); pw = pw.slice(0, wordCap); }
  for (let i = 1; i < pw.length; i += 1) { pw[i]!.start = Math.max(pw[i]!.start, pw[i - 1]!.start); pw[i]!.end = Math.max(pw[i]!.end, pw[i]!.start); }
  const headline = pw.some(w => w.role !== 'running');
  if (headline) {
    // running words inside a headline block read as connectors
    for (const w of pw) if (w.role === 'running') { w.role = 'connector'; decide?.({eventId: ev.id, kind: 'replaced', field: 'role', requested: {word: w.text, role: 'running'}, produced: {word: w.text, role: 'connector'}, code: 'replaced.running_in_headline', reason: 'a running word inside a headline block reads as a connector', constraint: 'discretionary'}); }
    const heroes = pw.filter(w => w.role === 'hero');
    for (const extra of heroes.slice(1)) { extra.role = 'support'; notes.push(`second hero "${extra.text}" demoted to support`); decide?.({eventId: ev.id, kind: 'demoted', field: 'role', requested: {word: extra.text, role: 'hero'}, produced: {word: extra.text, role: 'support'}, code: 'demoted.second_hero', reason: 'one hero per headline block (at most one hero on screen)', constraint: 'discretionary'}); }
    // a block of connectors only gets a hero; a support(+connector) tail block continues the previous headline and stays hero-less
    if (!pw.some(w => w.role === 'hero' || w.role === 'punch' || w.role === 'support')) {
      const pick = [...pw].sort((x, y) => y.text.length - x.text.length)[0]!;
      pick.role = 'hero';
      notes.push(`no hero tagged: "${pick.text}" promoted`);
      decide?.({eventId: ev.id, kind: 'promoted', field: 'role', requested: {word: pick.text, role: pick.role === 'hero' ? 'connector' : pick.role}, produced: {word: pick.text, role: 'hero'}, code: 'promoted.no_hero', reason: 'a block of connectors only gets a hero: the longest word was promoted', constraint: 'discretionary'});
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
export function wordStyle(style: StyleName, role: Role, pair?: FontPair, text = '', identity?: KineticIdentity): WS {
  const base = wordStyleBase(style, role, pair, text);
  if (!identity) return base;
  // the user's identity owns face, weight (poppins only) and case; size, tracking and opacity stay Kinetic's
  const weight = identity.weight !== null ? (role === 'connector' ? Math.min(identity.weight, 600) : identity.weight) : 400;
  return {...base, font: identity.font, weight, upper: identity.upper ?? base.upper, italic: false};
}

function wordStyleBase(style: StyleName, role: Role, pair?: FontPair, text = ''): WS {
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

type LW = {pw: PW; role: Role; ws: WS; px: number; w: number; h: number; dx: number; dy: number; row: number; anim: AnimName; /** Phase 4.9: an editorial-serif hero kept as an emphasis line at the support scale: it keeps the hero's accent colour */ emphasis?: boolean};
type Built = {lw: LW[]; block: {w: number; h: number}; title: boolean; /** Phase 4.8: words set in a fit face */ fitFace?: string[]; /** Phase 4.9: editorial-serif heroes kept in their face as an emphasis line at the support scale */ emphasis?: string[]};

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

export function buildBlock(pwIn: PW[], style: StyleName, width: number, safeW: number, opts: {heroShrink: number; title: boolean; /** row-to-row leading (default 0.88) */ lead?: number; /** Phase 4.8 (M4): enable the hero fit face; `height` = frame height (the floor is a share of it), `pad` = the solver's block padding */ fitFace?: {height: number; pad: number}; /** false = staggered rows (hero left, trailing rows right); default: one centred column */ centerRows?: boolean; fontPair?: FontPair | undefined; identity?: KineticIdentity | undefined}): Built {
  const k = width / 1080;
  const lowerCase = style !== 'cinematicClean';
  const pw = pwIn.map(w => ({...w, text: lowerCase || w.role === 'connector' || w.role === 'support' || w.role === 'running' ? w.text.toLowerCase() : w.text}));
  let title = opts.title && pw.length === 1 && pw[0]!.role === 'hero' && style === 'cinematicClean';
  const supportCount = { n: 0 };
  const peers = isPeerList(pw);
  const lw: LW[] = pw.map(w => {
    const ws = wordStyle(style, w.role, opts.fontPair, w.text, opts.identity);
    let px = ws.px1080 * k * (w.role === 'hero' ? opts.heroShrink : 1);
    if (peers && (w.role === 'hero' || w.role === 'support')) {
      // listed tools share one size and the hero face (After Effects = Premiere Pro = DaVinci Resolve)
      const heroWs = wordStyle(style, 'hero', opts.fontPair, w.text, opts.identity);
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
  // Phase 4.8 (M4) / 4.9: one hero / punch WORD wider than the usable safe width even at its readability floor in the pair's face. The size never changes. fitFace.ts picks a substitute only within the face's own design
  // language (bold display -> Anton / Bebas; modern sans -> Inter / Space Grotesk / Bebas / Anton; script -> Shrikhand). An EDITORIAL SERIF has no shipped condensed partner: its identity is kept and the COMPOSITION changes
  // instead (the word becomes an italic-serif emphasis line at the support scale: same face, still readable, hierarchy carried by face and colour). A word that fits keeps everything.
  const fitFace: string[] = [], emphasis: string[] = [];
  if (opts.fitFace && !title) {
    const usable = (safeW - 2 * opts.fitFace.pad) / REST_GROWTH, floorPx = FLOOR_TOLERANCE * HERO_FLOOR_FRAC * opts.fitFace.height;
    for (const l of lw) {
      if (l.role !== 'hero' && l.role !== 'punch') continue;
      const pick = chooseFitFace(l.pw.text, {font: l.ws.font, weight: l.ws.weight, upper: l.ws.upper, italic: l.ws.italic, ls: l.ws.ls}, floorPx, usable);
      if (pick.face) { l.ws = {...l.ws, font: pick.face.font, weight: pick.face.weight, italic: pick.face.italic, ls: pick.face.ls}; const m = measure(l.pw, l.ws, l.px); l.w = m.w; l.h = m.h; fitFace.push(l.pw.text); continue; }
      if (!pick.fits && faceCategory(l.ws.font) === 'editorialSerif') {
        const px = round2(SIZE.support * k), supFloor = FLOOR_TOLERANCE * SUPPORT_FLOOR_FRAC * opts.fitFace.height;
        if (measure(l.pw, l.ws, px).w * (supFloor / px) <= usable) { l.role = 'support'; l.pw = {...l.pw, role: 'support'}; l.px = px; l.emphasis = true; const m = measure(l.pw, l.ws, px); l.w = m.w; l.h = m.h; emphasis.push(l.pw.text); }
      }
    }
  }
  const isRunning = lw.every(l => l.role === 'running');
  if (isRunning) {
    const bw = Math.max(...lw.map(l => l.w)), bh = Math.max(...lw.map(l => l.h));
    for (const l of lw) { l.dx = round2((bw - l.w) / 2); l.dy = round2((bh - l.h) / 2); }
    return {lw, block: {w: round2(bw), h: round2(bh)}, title, ...(fitFace.length ? {fitFace} : {}), ...(emphasis.length ? {emphasis} : {})};
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
  // Post-integration fix: capitals in a display face fill their whole line box, so a pitch below the box height makes consecutive rows touch or overlap (2.mp4: the stacked
  // AFTER EFFECTS / PREMIERE PRO / DAVINCI RESOLVE list drew at 0.836 em). Between a caps display row and its neighbour the pitch is at least the box height plus a gap.
  const capsDisplayRow = rows.map(r => r.every(l => l.ws.upper && CAPS_FILL_FONTS.has(l.ws.font)));
  const pairLead = (i: number) => (capsDisplayRow[i - 1] || capsDisplayRow[i] ? Math.max(lead, CAPS_ROW_MIN_LEAD) : lead);
  const centre: number[] = [];
  rows.forEach((_, i) => centre.push(i === 0 ? rowH[0]! / 2 : centre[i - 1]! + (pairLead(i) * (rowH[i - 1]! + rowH[i]!)) / 2));
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
  return {lw, block: {w: round2(Math.max(bw, ...lw.map(l => l.dx + l.w))), h: round2(bh)}, title, ...(fitFace.length ? {fitFace} : {}), ...(emphasis.length ? {emphasis} : {})};
}

// ---------------------------------------------------------------------------------------------------------------- zones

type Cluster = {lw: LW[]; built: Built; suffix: string; cx: number; cy: number; s: number; /** smallest scale this cluster may shrink to (its readability floor for the pass that found it) */ minS: number; layering: 'front' | 'behind'; /** per word: which side of the subject foreground it draws on (stackOverCutout) */ layers?: Array<'front' | 'behind'>};
type RectPx = Rect;
const rw = (r: Rect) => r.right - r.left;
const rh = (r: Rect) => r.bottom - r.top;

/**
 * Ordered zone candidates: explicit intent first, then the rules (subject left -> type right, subject right -> type left, free space above -> upper, last resort the chest line).
 * `flank` (a left cluster + a right cluster) is only for a truly centred subject AND a phrase that is not one sentence: one phrase is one reading block, never split across the frame.
 * An `estimated` box (no matte: a centred default, not a measurement) never earns a gutter OR the upper zone: nothing is parked beside or ABOVE a guess (the same rule the Director
 * contract states in affordances.ts). Post-integration fix: the default box puts the head top at 0.30 of the frame; on a tighter real framing the "upper" zone above that guess lands
 * on the speaker's head (2.mp4: heroes drawn over the cap). Without a measurement the hero stays on the chest line.
 */
export function zoneCandidates(hint: TextEvent['regionHint'], box: {x: number; y: number; w: number; h: number}, allRunning: boolean, title: boolean, opts: {onePhrase?: boolean; estimated?: boolean} = {}): ZoneName[] {
  if (allRunning || title) return ['running'];
  const onePhrase = opts.onePhrase ?? true;
  const cx = box.x + box.w / 2;
  const auto: ZoneName[] = [];
  if (opts.estimated) {
    // no auto zone above or beside a guess: only the running (chest) line below
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
  return [...new Set([...explicit, ...auto])].filter(z => !(z === 'flank' && onePhrase) && !(opts.estimated && (z === 'besideLeft' || z === 'besideRight' || z === 'flank' || z === 'upper')));
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

/** The three free regions around the speaker (px): the SAME geometry the solver places type in, exported so the Director contract (affordances.ts) reads exactly what the solver will use. */
export function zoneRegions(sb: Rect, safeR: Rect, width: number): {besideRight: Rect; besideLeft: Rect; upper: Rect} {
  const gapPx = 0.03 * width;
  return {
    besideRight: {left: sb.right + gapPx, right: safeR.right, top: safeR.top, bottom: safeR.bottom},
    besideLeft: {left: safeR.left, right: sb.left - gapPx, top: safeR.top, bottom: safeR.bottom},
    // Phase 4.5: never below the safe rect (a zoom can push the whole face below it; the region above the head then ends at the safe bottom, not at a face top that is off screen)
    upper: {left: safeR.left, right: safeR.right, top: safeR.top, bottom: Math.min(sb.top - gapPx, safeR.bottom)},
  };
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

/** V1: the user's outline / shadow colour on top of Kinetic's own shadow block (blur, offset and the contrast-driven stroke stay Kinetic's; an identity outline only ever adds stroke) */
function identityShadow<T extends {color: string; strokePx: number; strokeColor?: string}>(identity: KineticIdentity | undefined, k: number, base: T): T {
  if (!identity) return base;
  const out = {...base};
  if (identity.shadowColor) out.color = identity.shadowColor;
  if (identity.outline) { out.strokePx = round2(Math.max(base.strokePx, identity.outline.strokePxAt1920 * k * 0.6)); out.strokeColor = identity.outline.color; }
  return out;
}

function eventAccent(ev: TextEvent, scene: ShotScene, state: PlaybookState, notes: string[], decide?: DecisionSink, identity?: KineticIdentity): string {
  const bg = lumToHex(scene.luminance);
  // V1: the user's highlight colour replaces both the Director's hue and the plate-derived pool (brightness may still be nudged for contrast)
  let hex = identity ? identity.accent : resolveAccent(ev.accent);
  // precedence: a Director hue never replaces the user's highlight colour; the refusal is recorded, not silent
  if (identity && ev.accent && resolveAccent(ev.accent)?.toUpperCase() !== identity.accent.toUpperCase()) {
    decide?.({eventId: ev.id, kind: 'refused', field: 'accent', requested: ev.accent, produced: identity.accent, code: 'refused.accent_identity', reason: "the creator's selected caption style owns the highlight colour", constraint: 'hard'});
  }
  if (!hex) {
    const pool = plateAccents(scene.plateColor, bg);
    hex = pool[state.accentRot % pool.length]!;
    state.accentRot += 1;
    notes.push(`accent ${hex} derived from the plate (${scene.plateColor ?? 'luminance only'})`);
  }
  const n = nudgeForContrast(hex, bg);
  if (n.nudged) {
    notes.push(`accent ${hex} -> ${n.hex}: brightness nudged for contrast on the plate (hue kept)`);
    if (ev.accent) decide?.({eventId: ev.id, kind: 'adjusted', field: 'accent', requested: ev.accent, produced: n.hex, code: 'adjusted.accent_contrast', reason: 'brightness nudged for contrast on the plate (hue kept)', constraint: 'hard'});
  }
  return n.hex;
}

type Motion = {exit: ExitName; heroEnter: AnimName | null; pair: string | null};

/**
 * Tag -> frames: pick the entry of every word and the exit of the lockup from the library. The director's tags win; otherwise the style pools rotate.
 * The same entry+exit pair is never used on two consecutive lockups (the solver changes the exit, then the entry, when a tag repeats).
 */
function pickMotion(a: PlaybookArgs, ev: TextEvent, lw: LW[], flags: {isLast: boolean; endsOnCut: boolean; titleBlock: boolean; running: boolean}): Motion {
  const {style, state, fps} = a;
  const variety = Boolean(a.motionVariety);
  let heroAt = lw.findIndex(l => l.role === 'hero' || l.role === 'punch');
  // Phase 5.15 (A): a hero kept as a serif emphasis line at the support scale is still the block's payoff word: its entrance (Director tag or pool) is kept, subject to the same legality
  if (heroAt < 0 && variety && !flags.running) heroAt = lw.findIndex(l => l.emphasis);
  const thoughtEnds = endsThought(a.words, ev.wordRange[1], fps);
  const editorial = variety && style === 'editorialLuxury';
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
  let exitCause: {code: string; reason: string; constraint: 'hard' | 'discretionary'} | null = null;
  if (flags.titleBlock) { exit = 'OUT-4'; exitCause = {code: 'title_block', reason: 'a title moment always exits through OUT-4 (ghost dissolve)', constraint: 'discretionary'}; }
  else if (legacyWant) { exit = (legacyWant === 'X6' && state.x6Used) || (legacyWant === 'X2') ? exitPool[0]! : legacyWant === 'X5' && !flags.isLast ? 'X3' : legacyWant; exitCause = {code: 'legacy_alias', reason: `legacy exit ${legacyWant} is limited (X6 once per plan, X2 only for running words, X5 only for the last block)`, constraint: 'discretionary'}; }
  else if (flags.running && variety && !thoughtEnds) { exit = 'X2'; exitCause = {code: 'running_handoff', reason: 'a running caption in the middle of a sentence hands off with the same word swap (X2) as its other words', constraint: 'discretionary'}; }
  else if (flags.running) { exit = 'OUT-4'; exitCause = {code: 'running_line', reason: variety ? 'a running caption that ends a thought exits through OUT-4' : 'running (caption) lines always exit through OUT-4', constraint: 'discretionary'}; }
  else if (flags.isLast) { exit = 'OUT-7'; exitCause = {code: 'last_event', reason: 'the last lockup of the plan fades out (OUT-7)', constraint: 'discretionary'}; }
  else if (flags.endsOnCut) { exit = 'OUT-5'; exitCause = {code: 'ends_on_cut', reason: 'the shot ends within 6 frames: the type cuts with the shot (OUT-5)', constraint: 'hard'}; }
  else if (want && want !== 'OUT-7' && want !== 'OUT-6' && want !== 'OUT-5') exit = want;
  // Phase 5.15 (B): the two reserved exits are honoured where the Director's choice means what it says: OUT-7 (fade out) on a lockup that ends a thought, OUT-5 (hard out) on a hand-off into continuing speech
  else if (variety && want === 'OUT-7' && thoughtEnds) exit = want;
  else if (variety && want === 'OUT-5' && !thoughtEnds) exit = want;
  // Phase 5.15 (E): an untagged editorial hero ends a thought with OUT-7 (dim out) and otherwise defocuses (OUT-4)
  else if (editorial && heroAt >= 0) { exit = thoughtEnds ? 'OUT-7' : 'OUT-4'; exitCause = {code: 'editorial_context', reason: thoughtEnds ? 'an editorial hero that ends a thought dims out (OUT-7)' : 'an editorial hero inside a sentence defocuses (OUT-4)', constraint: 'discretionary'}; }
  else { exitPool.length ? (exit = exitPool[state.rot % exitPool.length]!) : (exit = 'OUT-2'); exitCause = {code: 'not_allowed', reason: want ? `${want} is reserved (OUT-5 only on a cut, OUT-6 only for gap captions, OUT-7 only for the last lockup)` : 'no exit tagged', constraint: 'discretionary'}; }
  if (exit === 'X6') state.x6Used = true;

  // ---- entries: the lead-ins alternate IN-1 / IN-3 unless tagged; the hero / punch word rotates through the pool unless tagged
  const wantedHero = ev.enter && legalHeroEnter(ev.enter) ? ev.enter : null;
  let enterCause: {code: string; reason: string; constraint: 'hard' | 'discretionary'} | null = ev.enter && !wantedHero ? {code: 'not_legal', reason: `${ev.enter} is not legal for this word (IN-8 needs a script hero of <= ${SCRIPT_MAX_LETTERS} letters, IN-7 needs 4-12 letters and no script, IN-11 is for gap captions)`, constraint: 'hard'} : null;
  let heroEnter: AnimName | null = null;
  const rot = state.rot;
  if (heroLine) {
    // Phase 5.15 (E): an untagged editorial hero rises with its glint (IN-10) when the speaker dwells on the word (>= 0.45 s), else a focus pull (IN-1)
    const dwell = heroLine.pw.end - heroLine.pw.start >= Math.round(0.45 * fps);
    heroEnter = wantedHero ?? (editorial && pool.includes('IN-10') && pool.includes('IN-1') ? (dwell ? 'IN-10' : 'IN-1') : pool[rot % pool.length]!);
    const heroDriven = !flags.titleBlock && !flags.running;
    if (heroDriven) {
      const pairOf = (e: AnimName, x: ExitName) => `${e}|${x}`;
      if (pairOf(heroEnter, exit) === state.lastPair) {
        // same pair as the previous lockup: change the exit when the library offers another, then the entry
        const exits = editorial ? (['OUT-4', ...(thoughtEnds ? ['OUT-7' as ExitName] : [])] as ExitName[]) : [...new Set([...exitPool, 'OUT-2', 'OUT-1', 'OUT-4'] as ExitName[])].filter(x => x !== 'OUT-7' && x !== 'OUT-5' || x === exit);
        const alt = (!flags.isLast && !flags.endsOnCut && !legacyWant ? exits : []).find(x => pairOf(heroEnter!, x) !== state.lastPair);
        if (alt) { exit = alt; exitCause = {code: 'repeat_pair', reason: 'the same entry + exit pair is never used on two lockups in a row: the exit was changed', constraint: 'discretionary'}; }
        else {
          const e2 = [...pool, ...HERO_ENTER_POOL.cinematicClean.filter(legalHeroEnter)].find(e => pairOf(e, exit) !== state.lastPair);
          if (e2) { heroEnter = e2; enterCause = {code: 'repeat_pair', reason: 'the same entry + exit pair is never used on two lockups in a row: the entry was changed', constraint: 'discretionary'}; }
        }
      }
      state.lastPair = pairOf(heroEnter, exit);
    }
    state.rot += 1;
  } else if (ev.enter) a.decide?.({eventId: ev.id, kind: 'refused', field: 'enter', requested: ev.enter, produced: null, code: 'refused.enter_no_hero', reason: 'event.enter tags the hero / punch word entry; this block has none (tag the lines instead)', constraint: 'discretionary'});
  if (heroLine && ev.enter && heroEnter !== ev.enter && enterCause) a.decide?.({eventId: ev.id, kind: 'replaced', field: 'enter', requested: ev.enter, produced: heroEnter, code: `replaced.enter_${enterCause.code}`, reason: enterCause.reason, constraint: enterCause.constraint});
  if (ev.exit && exit !== ev.exit && exitCause) a.decide?.({eventId: ev.id, kind: 'replaced', field: 'exit', requested: ev.exit, produced: exit, code: `replaced.exit_${exitCause.code}`, reason: exitCause.reason, constraint: exitCause.constraint});
  const runningFast = flags.running && lw.length > 0 && lw.reduce((t, l) => t + (l.pw.end - l.pw.start), 0) / lw.length < 0.22 * fps;
  lw.forEach((l, i) => {
    if (i === heroAt) { l.anim = heroEnter!; return; }
    if (flags.titleBlock) { l.anim = 'E6'; return; }
    const tagged = l.pw.enter && l.pw.enter !== 'IN-8' && l.pw.enter !== 'IN-7' ? l.pw.enter : null;
    if (l.pw.enter && !tagged) a.decide?.({eventId: ev.id, kind: 'replaced', field: 'enter', requested: {word: l.pw.text, enter: l.pw.enter}, produced: null, code: 'replaced.lead_enter_not_legal', reason: `${l.pw.enter} is for the hero word only; this lead-in rotates through IN-1 / IN-3`, constraint: 'hard'});
    // Phase 5.15 (D): running captions take the entry from the speech pace: fast speech (words < 0.22 s) ticks in (IN-11, 3 frames) because IN-1's 8-frame focus pull never settles before the next word swaps in
    if (flags.running) { l.anim = tagged ?? (variety && runningFast ? 'IN-11' : 'IN-1'); return; }
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
  const {pw, notes: wn} = expandWords(ev, words, a.decide);
  notes.push(...wn);
  if (pw.length === 0) return {events: [], notes, actions, dropped: 'no words'};
  const allRunning = pw.every(w => w.role === 'running');
  const inFrame0 = win.inFrame;
  const sb = subjectPx(scene, win.inFrame, win.outFrame, width, height);
  const box = boxSpan(scene, win.inFrame, win.outFrame);
  const perspectivePx = Math.max(900, width * 1.4);
  const onePhrase = isOnePhrase(ev, words, fps);
  // G1: a measured speaker box (vision, no matte) is a real box: gutters and flank are legal. Everything else without a matte is still an estimate (unchanged).
  const estimated = scene.estimated || (scene.noMatte && scene.boxSource !== 'measured');
  if (estimated) notes.push('subject box is an estimate (no matte): no gutter / flank placement');
  else if (scene.noMatte) notes.push('subject box is a measured speaker box (no matte): gutter / flank / above placement legal; behind-the-head and stack-over-cutout refused');
  void inFrame0;

  // ---- title moment (cinematicClean, rare)
  const titleRequested = Boolean(ev.title) && style === 'cinematicClean' && pw.length === 1 && pw[0]!.role === 'hero';
  const titleOk = titleRequested && state.titleFrames.every(f => Math.abs(win.inFrame - f) >= TITLE_WINDOW_SEC * fps);
  if (ev.title && !titleOk) a.decide?.({eventId: ev.id, kind: 'refused', field: 'title', requested: true, produced: false, code: 'refused.title', reason: !titleRequested ? 'a title moment needs cinematicClean and a lone hero word' : `at most one title moment per ${TITLE_WINDOW_SEC} s`, constraint: 'discretionary'});

  const keepBottom = sb.top + FACE_FRACTION * (sb.bottom - sb.top) + 0.015 * height;
  const pad = 14 * k;
  const regions = zoneRegions(sb, safeR, width);
  const headY = sb.top + 0.3 * (sb.bottom - sb.top);

  // ---- behind-the-head signature / stack over the cutout: legal whenever a matte exists (RVM ran), rare by cap
  const behindFree = !scene.noMatte && scene.alphaAreaFrac <= FORCE_FRONT_ALPHA_AREA && win.inFrame - state.lastBehindFrame >= BEHIND_WINDOW_SEC * fps;
  const stackFree = !scene.noMatte && scene.alphaAreaFrac <= FORCE_FRONT_ALPHA_AREA && win.inFrame - state.lastStackFrame >= BEHIND_WINDOW_SEC * fps;
  const candidates = zoneCandidates(ev.regionHint, box, allRunning, titleOk, {onePhrase, estimated});
  for (const [hint, free] of [['stackOverCutout', stackFree], ['behindSignature', behindFree]] as const) {
    if (ev.regionHint === hint && !free) a.decide?.({eventId: ev.id, kind: 'refused', field: 'regionHint', requested: hint, produced: 'normal zones', code: scene.noMatte ? 'refused.no_matte' : scene.alphaAreaFrac > FORCE_FRONT_ALPHA_AREA ? 'refused.alpha_area' : 'refused.behind_cap', reason: scene.noMatte ? `${hint} needs a person matte and there is none` : scene.alphaAreaFrac > FORCE_FRONT_ALPHA_AREA ? 'the speaker fills most of the frame' : `at most one behind-the-head / stack event per ${BEHIND_WINDOW_SEC} s`, constraint: scene.noMatte || scene.alphaAreaFrac > FORCE_FRONT_ALPHA_AREA ? 'hard' : 'discretionary'});
  }
  if (ev.regionHint === 'stackOverCutout' && !stackFree) notes.push(scene.noMatte ? 'stackOverCutout refused: no matte (RVM did not return one)' : 'stackOverCutout refused (cap / alpha area): normal zones');
  if (ev.regionHint === 'behindSignature' && !behindFree) notes.push(scene.noMatte ? 'behindSignature refused: no matte (RVM did not return one)' : 'behindSignature refused (cap / alpha area): in front, in a gutter');

  type Plan = {zone: ZoneName; clusters: Cluster[]; heroShrink: number};
  /** minFactor scales the readability floor: 1 = the floor itself, < 1 = the soft passes that only run when nothing fits at the floor */
  const fitOpt = a.fitHeroFace ? {fitFace: {height, pad}} : {};
  const mk = (pws: PW[], heroShrink: number, title = false): Built => buildBlock(pws, style, width, rw(safeR), {heroShrink, title, fontPair: a.fontPair, identity: a.identity, ...fitOpt});
  const minSOf = (built: Built, minFactor: number): number => Math.max(minFactor >= 1 ? 0 : MIN_SCALE, minFactor * floorScaleOf(built.lw, height));
  /** stackOverCutout: row 0 (connectors / a short lead) rests just above the subject box (front); the hero row and everything after it steps down over the head / shoulders (behind the matte). */
  const solveStack = (minFactor: number): Plan | null => {
    const gap = 0.012 * height;
    const sbNow = subjectPx(scene, win.inFrame, win.inFrame, width, height);
    const subjCx = (sbNow.left + sbNow.right) / 2;
    let best: {c: Cluster; cost: number} | null = null;
    for (const lead of [0.9, 0.85, 0.95]) {
      const built = buildBlock(pw, style, width, rw(safeR), {heroShrink: 1, title: false, lead, centerRows: true, fontPair: a.fontPair, identity: a.identity, ...fitOpt});
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
      // Phase 4.8 (M2): SOFT crown protection. Prefer to rest a further `crownSoft` (scaled by the window's zoom) clear of the head; fall back to the hard limit only when the block is not readable there. Never below the floor.
      const crownPx = (scene.crownSoft ?? 0) * height * Math.max(1, box.h / Math.max(1e-6, scene.subjectBox.h));
      const soft = crownPx > 0 ? placeIn(built.block, {...R, bottom: R.bottom - crownPx}, pad, R.bottom - crownPx, minS) : null;
      const p = soft ?? placeIn(built.block, R, pad, R.bottom, minS);
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

  /** zones a block may be moved to instead of being refused or shrunk below the floor: the engine's own candidates for this box, plus (Phase 4.8, relocateBeforeFloor) the area above the head even when the box starts high:
   *  tryZone('upper') still requires 10% of the frame height of real room there and applies the same face keep-out, per-frame face test and floor. */
  const relocationZones = (): ZoneName[] => { const z = zoneCandidates(ev.regionHint, box, false, false, {onePhrase, estimated}).filter(x => x !== 'running' && x !== 'behindSignature' && x !== 'stackOverCutout'); return a.relocateBeforeFloor && !estimated && !z.includes('upper') ? [...z, 'upper'] : z; };
  let plan: Plan | null = null;
  const order: ZoneName[] = ev.regionHint === 'behindSignature' && behindFree ? ['behindSignature', ...candidates.filter(z => z !== 'behindSignature')] : candidates.filter(z => z !== 'behindSignature');
  // Readability first: pass 1 keeps every line at its floor (hero / punch >= 7.5% of the frame height, connectors / support >= 3.5%) and MOVES zones instead of shrinking.
  // Pass 2 (only when no zone holds the floor, e.g. a very long word) lets the block give up to 30% of the floor, widest zone first.
  for (const [pass, minFactor] of [[1, 1], [2, 0.7]] as const) {
    // Phase 4.7 (adaptive mode only, default OFF): before a block is accepted BELOW the readability floor (pass 2), the zones the engine offers for this speaker box that pass 1 never tried (a running-only block offers only the
    // running zone) are tried at the FULL floor. Reached only by blocks that would otherwise go below the floor; nothing that fitted at the floor changes. Same face keep-out, per-frame face test and safe-rect fit as every zone.
    if (pass === 2 && !plan && (a.adapt || a.relocateBeforeFloor)) {
      for (const z of relocationZones().filter(x => !order.includes(x))) {
        const p = tryZone(z, 1, 1);
        if (p) { plan = p; notes.push(`running zone would be below the readability floor: placed in ${z} at the floor`); a.decide?.({eventId: ev.id, kind: 'replaced', field: 'regionHint', requested: ev.regionHint === 'auto' ? 'running' : ev.regionHint, produced: z, code: 'replaced.below_floor_avoided', reason: `the only legal zone holds this block only below the readability floor; ${z} holds it at the floor, clear of the face`, constraint: 'hard'}); break; }
      }
      if (plan) break;
    }
    const zs = pass === 1 ? order : ['running' as ZoneName, ...order.filter(z => z !== 'running')];
    for (const z of zs) {
      plan = tryZone(z, 1, minFactor);
      if (!plan && a.adapt && pass === 1 && z === ev.regionHint && (z === 'besideLeft' || z === 'besideRight' || z === 'upper')) {
        plan = tryZone(z, 1, ADAPT_FLOOR);
        if (plan) { notes.push(`${z}: block fits only at ${Math.round(ADAPT_FLOOR * 100)}% of the readability floor`); a.decide?.({eventId: ev.id, kind: 'adjusted', field: 'size', requested: 'readability floor', produced: `${Math.round(ADAPT_FLOOR * 100)}% of the floor, in the requested zone ${z}`, code: 'adjusted.size_in_requested_zone', reason: `${z} holds this block only slightly below the readability floor; kept in the requested zone instead of moving it`, constraint: 'discretionary'}); }
      }
      if (plan) break;
    }
    if (plan) { if (pass === 2) { notes.push('hero below the readability floor (word too long for any zone at the floor)'); a.decide?.({eventId: ev.id, kind: 'adjusted', field: 'size', requested: 'readability floor', produced: 'up to 30% below the floor', code: 'adjusted.below_floor', reason: 'the word is too long for any zone at the readability floor', constraint: 'hard'}); } break; }
  }
  if (!plan) {
    let lastResort = tryZone('running', 0.8, 0);
    // Phase 4.5: a running-only block (a coverage-fill line, or a hero demoted to a running line) offers only the running zone, BELOW the face. Under a punch-in the zoomed face can reach the Shorts safe bottom, so that
    // zone has no room at any size while the space above the head (or a gutter) is free. Before refusing, the zones the engine already offers for this speaker box (zoneCandidates without the running-only restriction:
    // upper / gutters / flank) are tried at the FULL readability floor (pass 1 floor, no shrink), with the same face keep-out, per-frame face test and safe-rect fit as every other zone. Reached only by a block that
    // previously threw, so no composition that was produced before changes.
    let relocated: ZoneName | null = null;
    if (!lastResort) {
      for (const z of relocationZones()) {
        const p = tryZone(z, 1, 1);
        if (p) { lastResort = p; relocated = z; break; }
      }
    }
    // Phase 4.2.1: no zone can hold the block at any size (the running zone is exhausted below the face keep-out). That used to be a null dereference below; it is an EXPLICIT failure now, so the stage reports why and
    // the production fallback (template path, which keeps every word) runs.
    if (!lastResort) throw new Error(`no_safe_placement: event "${ev.id}" cannot be placed clear of the face keep-out in any zone at any size`);
    plan = lastResort;
    if (relocated) {
      notes.push(`running zone has no room below the face: placed in ${relocated} at the readability floor`);
      if (ev.regionHint !== 'running') a.decide?.({eventId: ev.id, kind: 'replaced', field: 'regionHint', requested: ev.regionHint === 'auto' ? 'running' : ev.regionHint, produced: relocated, code: 'replaced.running_no_room', reason: `the running zone (below the face) has no room under the current zoom: placed in ${relocated} at the readability floor, clear of the face`, constraint: 'hard'});
    } else { notes.push('no zone fits: running height, hero shrunk below the floor'); a.decide?.({eventId: ev.id, kind: 'adjusted', field: 'size', requested: 'readability floor', produced: 'hero shrunk 20% below the floor', code: 'adjusted.no_zone_fits', reason: 'no zone fits this block at any floor: running height with a shrunk hero', constraint: 'hard'}); } }
  {
    const hint = ev.regionHint;
    const ZONES: readonly string[] = ['besideLeft', 'besideRight', 'flank', 'running', 'upper'];
    if (ZONES.includes(hint) && hint !== plan.zone) {
      const gutterSwap = (hint === 'besideLeft' && plan.zone === 'besideRight') || (hint === 'besideRight' && plan.zone === 'besideLeft');
      const gutterHint = hint === 'besideLeft' || hint === 'besideRight' || hint === 'flank';
      const [kind, code, reason, constraint] = gutterSwap ? ['adjusted', 'zone_other_side', 'the requested side has no room at the readability floor: the other gutter was used', 'hard'] as const
        : gutterHint && estimated ? ['replaced', 'zone_unmeasured_box', 'the speaker position is not measured, so no gutter / flank placement is offered', 'hard'] as const
        : hint === 'flank' && onePhrase ? ['replaced', 'zone_one_phrase', 'one phrase is one reading block: it is never split left / right', 'discretionary'] as const
        : ['replaced', 'zone_no_room', `${hint} has no room for this block at the readability floor`, 'hard'] as const;
      a.decide?.({eventId: ev.id, kind, field: 'regionHint', requested: hint, produced: plan.zone, code: `${kind}.${code}`, reason, constraint});
    }
    if (ev.layering === 'behind' && plan.zone !== 'behindSignature' && plan.zone !== 'stackOverCutout' && hint !== 'behindSignature' && hint !== 'stackOverCutout') {
      a.decide?.({eventId: ev.id, kind: 'replaced', field: 'layering', requested: 'behind', produced: 'front', code: scene.noMatte ? 'replaced.no_matte_front' : 'replaced.layering_follows_zone', reason: scene.noMatte ? 'type behind the speaker needs a person matte and there is none' : 'for type.words the zone decides what sits behind the head: ask for regionHint behindSignature / stackOverCutout', constraint: scene.noMatte ? 'hard' : 'discretionary'});
    }
  }
  {
    const fitted = [...new Set(plan.clusters.flatMap(c => c.built.fitFace ?? []))], emph = [...new Set(plan.clusters.flatMap(c => c.built.emphasis ?? []))];
    const faces = [...new Set(plan.clusters.flatMap(c => c.lw.filter(l => fitted.includes(l.pw.text)).map(l => l.ws.font)))];
    if (fitted.length) { notes.push(`hero fit face: ${fitted.join(', ')} -> ${faces.join('/')}`); a.decide?.({eventId: ev.id, kind: 'replaced', field: 'font', requested: 'the font pair\'s hero face', produced: faces.join('/'), code: 'replaced.hero_face_fit', reason: `"${fitted.join('", "')}" is wider than the safe width at the readability floor in the pair's hero face; set in a compatible face of the same design language at the same size`, constraint: 'hard'}); }
    if (emph.length) { notes.push(`editorial emphasis line: ${emph.join(', ')}`); a.decide?.({eventId: ev.id, kind: 'replaced', field: 'role', requested: 'hero', produced: 'support-scale emphasis in the hero\'s serif face', code: 'replaced.hero_serif_emphasis', reason: `"${emph.join('", "')}" does not fit the safe width at the hero floor and no condensed serif ships: the serif is kept and the word becomes an emphasis line at the support scale (readable, never below a floor)`, constraint: 'hard'}); }
  }
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
  // Phase 4.9: an editorial emphasis line (the hero kept in its serif at the support scale) still carries the accent: the hierarchy comes from face and colour
  const accentTarget = hasHero || plan.clusters.some(c => c.lw.some(l => l.emphasis));
  if (ev.accent && !accentTarget) a.decide?.({eventId: ev.id, kind: 'refused', field: 'accent', requested: ev.accent, produced: null, code: 'refused.accent_no_hero', reason: 'an accent colours the hero word; this block has none', constraint: 'discretionary'});
  const accent = accentTarget && (a.identity || style === 'retroNeon' || ev.accent) ? eventAccent(ev, scene, state, notes, a.decide, a.identity) : null;
  const title = plan.clusters[0]!.built.title;
  if (title) state.titleFrames.push(win.inFrame);
  if (a.fontPair) notes.push(`fontPair ${a.fontPair}`);

  // ---- motion tags -> library (one pick per lockup; flank clusters share it)
  const allLw = plan.clusters.flatMap(c => c.lw);
  const outGuess = Math.min(a.limitOut, win.outFrame);
  const motion = pickMotion(a, ev, allLw, {isLast: a.isLast, endsOnCut: !a.isLast && outGuess >= shot.endFrame - fpsScale(6, fps) && !ev.persistAcrossCut, titleBlock: title, running: allRunning});
  notes.push(`motion ${motion.pair ?? allLw.map(l => l.anim).join('/') + '|' + motion.exit}`);

  const solveAll = (p: Plan, ps: PoseName, px: number): RenderEvent[] => p.clusters.flatMap((c, ci) => solveCluster(c, a, p.zone, accent, px, safeR, k, win, ci === p.clusters.length - 1, title, motion.exit, ps));
  let built = solveAll(plan, pose, posedPx);
  // Phase 4.8 (M4): the fit loop (solveCluster) may shrink a block below its readability floor when its entry / pre-join poses do not fit where the zone test placed it (the zone test sizes the resting pose only).
  // That used to happen SILENTLY. With relocateBeforeFloor the other zones the engine offers are tried at the floor (same face keep-out, per-frame test and safe rect); the first readable result wins. If none is readable the
  // original stays and the shrink is RECORDED (adjusted.below_floor_fit). Never below the floor to win a placement; never a silent sub-floor line.
  if (a.relocateBeforeFloor && belowFloor(built, height)) {
    let fixed = false;
    for (const z of (['running', ...relocationZones()] as ZoneName[]).filter((z, i, arr) => z !== plan!.zone && arr.indexOf(z) === i)) {
      const alt = tryZone(z, 1, 1); if (!alt) continue;
      const altBuilt = solveAll(alt, 'flat', perspectivePx);
      if (!belowFloor(altBuilt, height)) { notes.push(`${plan.zone} would end below the readability floor after the entry fit: placed in ${z} at the floor`); a.decide?.({eventId: ev.id, kind: 'replaced', field: 'regionHint', requested: plan.zone, produced: z, code: 'replaced.zone_floor_fit', reason: `in ${plan.zone} the entry / pre-join poses only fit below the readability floor; ${z} holds the block at the floor`, constraint: 'hard'}); built = altBuilt; fixed = true; break; }
    }
    if (!fixed) a.decide?.({eventId: ev.id, kind: 'adjusted', field: 'size', requested: 'readability floor', produced: 'below the floor after the entry fit', code: 'adjusted.below_floor_fit', reason: 'the entry / pre-join poses fit only below the readability floor and no other zone holds the block at the floor', constraint: 'hard'});
  }
  events.push(...built);
  return {events, notes, actions};
}

/** true when any line of the events rests below FLOOR_TOLERANCE of its readability floor (hero / punch 7.5%, others 3.5% of the frame height) */
function belowFloor(events: RenderEvent[], height: number): boolean {
  for (const e of events) for (const l of e.lines) { const [f] = restingRange(e, l); const px = l.fontPx * interpolateKeyframes(e.keyframes, f).scale; const floor = (l.role === 'hero' || l.role === 'punch' ? HERO_FLOOR_FRAC : SUPPORT_FLOOR_FRAC) * height; if (px < FLOOR_TOLERANCE * floor - 0.5) return true; }
  return false;
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
  const heroAt = lw.findIndex(l => l.role === 'hero') >= 0 ? lw.findIndex(l => l.role === 'hero') : lw.findIndex(l => l.role === 'punch') >= 0 ? lw.findIndex(l => l.role === 'punch') : lw.findIndex(l => l.emphasis);
  const peers = isPeerList(lw.map(l => ({text: l.pw.text, role: l.role})));
  const plain = a.identity?.text ?? '#FFFFFF'; // V1: the user's text colour for every non-highlighted word
  const colors = lw.map((l, i) => (accent && (i === heroAt || (peers && (l.role === 'hero' || l.role === 'support'))) ? accent : plain));
  const glows = lw.map((_, i) => (colors[i] !== plain ? {color: colors[i]!, radiusPx: round2(14 * k), opacity: 0.55} : null));

  // ---- rows that join a block already on screen (E4)
  const rowFirstEnter = new Map<number, number>();
  lw.forEach((l, i) => { if (!rowFirstEnter.has(l.row)) rowFirstEnter.set(l.row, enterAbs[i]!); });
  const joins = running ? [] : [...rowFirstEnter.entries()].filter(([r]) => r > 0).map(([, f]) => f).filter(f => f > inFrame + 2 && f < exitStart).sort((x, y) => x - y);
  const E4N = entryFrames('E4', fps);

  const phase = hash01(`${a.seed}:${ev.id}`) * Math.PI * 2;
  const cam0 = a.cameraAt(inFrame);
  // Phase 5.15 (D): a running caption that hands off mid-sentence (exit X2) swaps its LAST word out the same way as the others, at the exit start
  // Post-integration fix: a running word's X2 swap-out (exitFrames('X2') frames, opacity 0 at its end) used to start 1 frame before the next word entered, so for 2-3 frames both
  // words were drawn in the same spot (2.mp4: "wtont", "tfwas"). The swap-out now ENDS on the frame the next word enters: no double exposure.
  const swapOutN = exitFrames('X2', fps);
  const exitWordFrame: Array<number | null> = lw.map((_, i) => (running && i < lw.length - 1 ? Math.max(enterAbs[i]!, enterAbs[i + 1]! - swapOutN) : running && a.motionVariety && exit === 'X2' && exitN > 0 ? Math.max(enterAbs[i]!, exitStart) : null));
  // Phase 5.15 (C): the resting movement follows the block's role (default OFF: the previous constant hold, i.e. `push`)
  const H = HOLD_PROFILES[a.motionVariety ? holdProfileFor(lw.map(l => ({role: l.role, ...(l.emphasis ? {emphasis: true} : {})})), titleBlock) : 'push'];

  /** Phase 4.2: a downward shift (px) of the whole block, set only by the per-frame face-keep-out retry below */
  let cyShift = 0;
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
      const ang = (2 * Math.PI * (f - inFrame)) / (H.periodSec * fps) + phase;
      // hold: the scale eases 1.00 -> ~1.04 over the life of the lockup (never a static hold)
      const pp = Math.min(1, Math.max(0, (f - inFrame) / life));
      const push = 1 + (H.push - 1) * (0.5 - 0.5 * Math.cos(Math.PI * pp));
      const cam = a.cameraAt(f);
      const mm = nJoin ? mult(f) : {m: 1, y: 0};
      let x = c.cx + H.dx * k * Math.sin(ang + 1) + CAMERA_BLEND * (cam.tx - cam0.tx);
      const y = c.cy + cyShift + H.dy * k * Math.sin(ang + 2.2) + CAMERA_BLEND * (cam.ty - cam0.ty) + mm.y;
      let scale = s * push * mm.m * (1 + CAMERA_BLEND * (cam.scale / (cam0.scale || 1) - 1));
      const rest = poseRest(pose, c.cx, width);
      let rotateY = rest.ry + H.rotY * Math.sin(ang), blurPx = 0, z = 0, opacity = 1;
      const rotateX = rest.rx + H.rotX * Math.sin(ang + 0.9);
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
      shadow: identityShadow(a.identity, k, {color: 'rgba(0,0,0,0.35)', blurPx: round2(shadowPx), offsetY: round2(2 * k), strokePx: low ? round2(Math.max(1.5, 3 * k)) : 0, ...(low ? {strokeColor: contrastStrokeColor(scene.luminance)} : {}), glowPx: 0}),
      depthBlurPx: 0, tint: null, occlusionFraction: {mean: 0, max: 0}, safeProof: {ok: true, sampledKeyframes: kfs.length, minMarginPx: 0},
      wordRange: ev.wordRange, persistAcrossCut: Boolean(ev.persistAcrossCut), notes: [],
      style, zone, exit, ...(pose !== 'flat' ? {pose} : {}), hold: {push: [HOLD.push[0], H.push], rotY: H.rotY, rotX: H.rotX, periodSec: H.periodSec},
      flash: titleBlock ? {startFrame: enterAbs[0]! + 1, color: a.identity ? a.identity.accent : LEAK, opacities: Array.from({length: fpsScale(8, fps)}, (_, i) => round2(0.65 * (1 - expoOut(i / fpsScale(8, fps))) ))} : null,
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
  const faceZone = zone === 'running' || zone === 'upper' || zone === 'behindSignature' || zone === 'stackOverCutout';
  const avoid: Rect = faceZone ? {...sbNow, bottom: sbNow.top + FACE_FRACTION * (sbNow.bottom - sbNow.top)} : sbNow;
  // Phase 4.2: the verifier reads the face box PER FRAME, the union `avoid` above does not (over a zoom ramp the union keep-out can sit above a single frame's). The same per-frame test is applied here, on the
  // frames each word is at rest, so the fit loop shrinks a block the verifier would reject instead of emitting it. Same measure and threshold as the verifier: a block it accepts is never changed by this.
  const faceHitPerFrame = (e: RenderEvent, line: RenderLine): boolean => {
    if (!faceZone || !a.faceFrames) return false;
    return lineFaceHitFrame(e, line, (f: number) => { const fb = boxAt(scene, f); return {left: fb.x * width, right: (fb.x + fb.w) * width, top: fb.y * height, bottom: (fb.y + FACE_FRACTION * fb.h) * height}; }) !== null;
  };
  const layerOf = (e: RenderEvent, line: RenderLine): 'front' | 'behind' => line.layer ?? c.layering;
  const clearOfSubject = (e: RenderEvent, r: Rect): boolean => e.lines.every(line => layerOf(e, line) === 'behind' || (() => {
    const [f0, f1] = restingRange(e, line);
    for (let f = f0; f <= f1; f += 2) if (overlapFraction(wordAabbAt(e, line, f), r) > 0.01) return false;
    return true;
  })());
  const perFrameClear = (e: RenderEvent): boolean => e.lines.every(line => layerOf(e, line) === 'behind' || !faceHitPerFrame(e, line));

  // ---- fit loop: shrink the block until every resting pose (and every E4 pre-join pose) is inside the safe rect; never below the readability floor of this pass
  let s = c.s;
  let result: RenderEvent | null = null;
  const As = joins.length ? [1.1765, 1.15, 1.12, 1.09, 1.06, 1.03, 1] : [1];
  for (let attempt = 0; attempt < 80 && !result; attempt += 1) {
    let perFrameOnly = false;
    for (const A of As) {
      const e = make(s, A);
      if (restingMargin(e, safeR) >= -SAFE_TOLERANCE_PX && clearOfSubject(e, avoid)) {
        if (perFrameClear(e)) { result = e; break; }
        perFrameOnly = true; // clear of the union keep-out, but the verifier's per-frame face box (zoom ramp) would reject it
      }
    }
    // Phase 4.2: before giving up size, move the running block DOWN (bounded: 24 px steps, at most 12% of the frame, never out of the safe rect) until the per-frame check clears. Reached only when the
    // per-frame test is the one rejecting, so every block the old rules accepted and the verifier accepts is untouched.
    if (!result && perFrameOnly && zone === 'running') {
      for (let sh = 24 * k; sh <= 0.12 * height && !result; sh += 24 * k) {
        cyShift = sh;
        for (const A of As) {
          const e = make(s, A);
          if (restingMargin(e, safeR) >= -SAFE_TOLERANCE_PX && clearOfSubject(e, avoid) && perFrameClear(e)) { result = e; break; }
        }
      }
      if (!result) cyShift = 0;
    }
    if (!result) { s = s * 0.985 >= c.minS ? s * 0.985 : s > c.minS + 1e-9 ? c.minS : s * 0.985; if (s < MIN_SCALE) break; }
  }
  // Phase 4.2: a running block that no size could clear (the union keep-out under-reports the zoomed face, the shrink loop ran out): before declaring it unresolved, move it DOWN in 24 px steps (at most 12% of
  // the frame, inside the safe rect), first at its requested size, then at the size the loop ended on. Reached only by blocks that were previously unresolved, so nothing that fitted changes.
  if (a.faceFrames && !result && zone === 'running') {
    for (const sTry of [c.s, s]) {
      for (let sh = 24 * k; sh <= 0.12 * height && !result; sh += 24 * k) {
        cyShift = sh;
        for (const A of As) {
          const e = make(sTry, A);
          if (restingMargin(e, safeR) >= -SAFE_TOLERANCE_PX && clearOfSubject(e, avoid) && perFrameClear(e)) { result = e; s = sTry; break; }
        }
      }
      if (result) break;
    }
    if (!result) cyShift = 0;
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
