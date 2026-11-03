/**
 * L1: the layout solver. Pure + deterministic (seeded): KineticPlan + words + shots + scene + camera + depth -> RenderSpec.
 * Measures with the heroSweep advance tables (Bebas + Inter, scaled for the other faces), places inside the Shorts safe rect (REUSES shortsSafeRect), and enforces the guardrails:
 * occlusion (move -> shrink <= 15% -> flip to front), forced front (alpha area / bbox overlap / no matte), face keep-out, contrast, jitter downgrade, cuts, density.
 * No Date, no Math.random, no I/O.
 */
import {createHash} from 'node:crypto';

import {shortsSafeRect} from '../broll/heroSweep.ts';
import {cameraJitter, cameraSampleAt, type CameraTrack} from './camera.ts';
import type {DepthProvider} from './depth.ts';
import {MIN_GAP_FRAMES, shotOfFrame} from './fallback.ts';
import {acceptMatchCuts, solveMatchCutEvent} from './matchCut.ts';
import {
  aabbOf, interpolateKeyframes, marginInside, overlapFraction, projectBlockAabb, projectLineAabb, rectArea, intersect, type Rect,
} from './geometry.ts';
import {
  ANCHOR_DOWNGRADE, ANCHOR_FACTOR, CONTRAST_MIN, FORCE_FRONT_ALPHA_AREA, FORCE_FRONT_BOX_OVERLAP, HERO_OCC_PREF, JITTER_MAX, MAX_SHRINK,
  SAFE_TOLERANCE_PX, SUPPORT_OCC_MAX, contrastStrokeColor, heroReadable, lineEdgeOcclusions, lineOcclusions, lumToHex, parentId, verifyRenderSpec, worstContrast, type Violation,
} from './guardrails.ts';
import {PRESETS, closestPreset, type LineStyle} from './presets.ts';
import {newPlaybookState, pairFonts, pickLegacyMotion, playbookWindow, solvePlaybookEvent} from './playbook.ts';
import {entryPose} from './motionLibrary.ts';
import {buildGapCaptions} from './gapCaptions.ts';
import {nudgeForContrast, plateAccents, resolveAccent} from './accent.ts';
import {HERO_FLOOR_FRAC, entryFrames, exitFrames, expoIn} from './motion.ts';
import {isCaptionLike} from './guardrails.ts';
import type {Box, ShotScene} from './scene.ts';
import {boxAt} from './scene.ts';
import {planStyle} from './schema.ts';
import type {AnimName, BrandConfig, ExitName, FontKey, FontPair, Keyframe, KineticPlan, KineticShot, KineticWord, LineRole, PresetName, RegionHint, RenderEvent, RenderLine, RenderSpec, TextEvent} from './schema.ts';

/** defaults for the playbook-only RenderLine fields on legacy lines */
const LEGACY_WORD = {anim: 'E1' as const, startFrame: 0, enterFrame: 0, color: '#FFFFFF', glow: null, textOpacity: 1, zPx: 0, exitFrame: null, wordKeyframes: []};
import {normToken} from './transcript.ts';

export {FONT_METRICS, textWidthEm} from './measure.ts';
import {FONT_METRICS, textWidthEm} from './measure.ts';

// ---------------------------------------------------------------------------------------------------------------- seeded noise

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const seedFor = (seed: number, id: string): number => parseInt(createHash('sha256').update(`${seed}:${id}`).digest('hex').slice(0, 8), 16);

// ---------------------------------------------------------------------------------------------------------------- types

export type SolveInput = {
  plan: KineticPlan;
  words: KineticWord[];
  shots: KineticShot[];
  scenes: Record<string, ShotScene>;
  cameras?: Record<string, CameraTrack>;
  depth: DepthProvider;
  brand: BrandConfig;
  width: number;
  height: number;
  fps: number;
  seed: number;
  planSource: string;
  /** event id -> preset chosen by the worker gate (custom treatment fell back to this) */
  presetOverrides?: Record<string, PresetName>;
};
export type SolveAction = {eventId: string; action: string; detail?: string};
export type SolveReport = {actions: SolveAction[]; dropped: Array<{eventId: string; reason: string}>; violations: Violation[]; anchorDowngrades: SolveAction[]};

const ENTRANCE_FRAMES = 10;
const EXIT_FRAMES = 4;
const HOLD = {hero: 18, punch: 18, support: 12, connector: 8, running: 4, caption: 4} as const;
const GOLD = ['#FFF1B0', '#F5C000', '#B8860B'];
const CHROME = ['#FFFFFF', '#9FB0C8', '#EAF0FA'];
const SEQ_GRADIENTS = [['#FF512F', '#F09819'], ['#00C6FF', '#7F00FF'], ['#11998E', '#B8F94F'], ['#FF0080', '#FFD200'], ['#4776E6', '#8E54E4']];

const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;
const easeOutBack = (u: number) => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------------------------- line building

type Built = {lines: RenderLine[]; block: {w: number; h: number}};

function resolveFont(style: LineStyle, brand: BrandConfig, override?: FontKey, pair?: FontPair, text = '', role?: LineRole): FontKey {
  if (override && (style.font === 'brandHero' || style.font === 'brandSerif')) return override;
  if (pair) {
    // the per-video pairing replaces the brand sheet fonts of the block-level presets
    const f = pairFonts(pair, text, Boolean(style.uppercase));
    const brandToken = style.font === 'brandHero' || style.font === 'brandSupport' || style.font === 'brandCaption' || style.font === 'brandSerif';
    if (brandToken && (role === 'hero' || role === 'punch')) return f.hero; // the hero of a block is always the pairing's display face
    if (style.font === 'brandHero') return f.hero;
    if (style.font === 'brandSupport') return f.support;
    if (style.font === 'brandCaption') return f.caption;
    if (style.font === 'brandSerif') return pair === 'editorial' ? 'playfairItalic' : f.hero;
  }
  switch (style.font) {
    case 'brandHero': return brand.fonts.hero;
    case 'brandSupport': return brand.fonts.support;
    case 'brandCaption': return brand.fonts.caption;
    case 'brandSerif': return brand.fonts.serifItalic ?? 'playfairItalic';
    default: return style.font;
  }
}
const toneColor = (brand: BrandConfig, tone: LineStyle['tone']) => ({ink: brand.palette.ink, paper: brand.palette.paper, accent: brand.palette.accent, accent2: brand.palette.accent2})[tone];

function fillFor(style: LineStyle, brand: BrandConfig, gradientName?: string, accent?: string | null): RenderLine['fill'] {
  const tone = style.tone === 'accent' && accent ? accent : toneColor(brand, style.tone);
  if (style.fill === 'gold') return {kind: 'gold', colors: GOLD, angleDeg: 180};
  if (style.fill === 'chrome') {
    // director / plate accent is the albedo — never a sheet gradient and never unlit grey chrome
    const hue = accent ?? CHROME[0]!;
    return {kind: 'chrome', colors: [hue, hue, '#FFFFFF'], angleDeg: 180};
  }
  if (style.fill === 'gradient') {
    const named = gradientName ? brand.palette.gradients[gradientName] : undefined;
    return {kind: 'gradient', colors: named ?? [tone, style.tone === 'accent2' ? brand.palette.accent : brand.palette.accent2], angleDeg: 100};
  }
  return {kind: 'solid', colors: [tone], angleDeg: 90};
}

function wrapCaption(text: string, font: FontKey, weight: number, px: number, maxW: number): string[] {
  const toks = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const t of toks) {
    const next = cur ? `${cur} ${t}` : t;
    if (cur && textWidthEm(next, font, weight, false, 0) * px > maxW) { lines.push(cur); cur = t; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function buildBlock(args: {
  lines: TextEvent['lines'];
  preset: PresetName;
  ev: TextEvent;
  brand: BrandConfig;
  width: number;
  height: number;
  words: KineticWord[];
  inFrame: number;
  fps: number;
  /** side-gutter width (px) when the region is besideLeft / besideRight: the block is sized to fit it */
  maxW?: number;
  /** the director's accent for this event's hero (contrast-checked hex) */
  accent?: string | null;
  /** the plan's font pairing (replaces the brand fonts) */
  fontPair?: FontPair | undefined;
}): Built {
  const {preset, ev, brand, width, height, words, inFrame} = args;
  const def = PRESETS[preset];
  const safe = shortsSafeRect(width, height);
  const maxScale = 1.06;
  const styleOf = (role: LineRole): LineStyle => def.styles[role] ?? def.styles.hero ?? def.styles.support ?? def.styles.caption!;
  let items = args.lines.map(l => {
    const style = styleOf(l.role);
    const font = resolveFont(style, brand, l.role === 'hero' ? ev.styleOverrides?.font : undefined, args.fontPair, l.text, l.role);
    const swapWords = (l.swapSlot?.wordIdxSequence ?? []).map(k => words[k]?.text.replace(/[.,;:!?]+$/, '') ?? '');
    return {l, style, font, swapWords};
  });
  const capPx = (role: LineRole, font: FontKey) => (role === 'hero' ? (font === 'bebas' ? 0.3 : 0.2) * height : role === 'support' ? 0.075 * height : 0.036 * height);
  // unit U: hero px for ratio 1. Only the hero / punch lines set U (a connector must never drag the hero down to caption size: the old 55px "viral" bug);
  // every other line is capped on its own (role cap + the width it needs).
  const heroish = (r: LineRole) => r === 'hero' || r === 'punch';
  const wide0 = (it: (typeof items)[number]) => Math.max(...[it.l.text].map(t => textWidthEm(t, it.font, it.style.weight, Boolean(it.style.uppercase), it.style.letterSpacingEm ?? 0)));
  // a multi-word hero that cannot hold the readability floor on ONE line is stacked word by word (hero.extrudedStack-style), instead of shrinking to caption size
  const floorPx = HERO_FLOOR_FRAC * height;
  items = items.flatMap(it => {
    const toks = it.l.text.split(/\s+/).filter(Boolean);
    if (!heroish(it.l.role) || toks.length < 2 || it.swapWords.length || args.preset === 'hero.gradientWord.sequence') return [it];
    const oneLine = Math.min(capPx(it.l.role, it.font), ((args.maxW ?? safe.w) * 0.96) / (maxScale * wide0(it)));
    if (oneLine >= floorPx * 1.04) return [it];
    return toks.map(t => ({...it, l: {...it.l, text: t}}));
  });
  const wide = (it: (typeof items)[number]) => {
    // the slot word is measured at the widest candidate
    const toks = it.l.text.split(/\s+/);
    const slot = it.swapWords.length ? it.swapWords : null;
    const base = slot ? toks.slice(0, -1).join(' ') : it.l.text;
    const candidates = slot ? slot.map(w => `${base} ${w}`.trim()) : [it.l.text];
    // sequence: one word at a time -> the widest single word
    const seq = preset === 'hero.gradientWord.sequence' ? it.l.text.split(/\s+/) : candidates;
    return Math.max(...seq.map(t => textWidthEm(t, it.font, it.style.weight, Boolean(it.style.uppercase), it.style.letterSpacingEm ?? 0)));
  };
  const widthU = (it: (typeof items)[number]) => ((args.maxW ?? safe.w) * 0.96) / (maxScale * wide(it) * it.style.sizeRatio);
  let U = Infinity;
  const hero = items.filter(it => heroish(it.l.role));
  for (const it of hero) U = Math.min(U, capPx(it.l.role, it.font) / it.style.sizeRatio, widthU(it));
  if (!Number.isFinite(U)) {
    // no hero line (caption-only presets): the old rule, every line limits U
    for (const it of items) U = Math.min(U, capPx(it.l.role, it.font) / it.style.sizeRatio);
    for (const it of items) if (it.l.role !== 'caption') U = Math.min(U, widthU(it));
  }
  if (!Number.isFinite(U)) U = 0.036 * height;
  const pxOf = (it: (typeof items)[number]): number => {
    let px = U * it.style.sizeRatio;
    if (hero.length && !heroish(it.l.role)) {
      px = Math.min(px, capPx(it.l.role, it.font));
      if (it.l.role !== 'caption') px = Math.min(px, widthU(it) * it.style.sizeRatio);
    }
    return Math.max(10, round2(px));
  };
  const out: RenderLine[] = [];
  let y = 0;
  const seqWords = args.lines.length ? args.lines : [];
  for (const it of items) {
    const px = pxOf(it);
    const m = FONT_METRICS[it.font];
    const upper = Boolean(it.style.uppercase);
    const texts = it.l.role === 'caption' ? wrapCaption(it.l.text, it.font, it.style.weight, px, safe.w * 0.9 / maxScale) : [it.l.text];
    for (const [ti, text] of texts.entries()) {
      const wEm = ti === 0 && (it.swapWords.length || preset === 'hero.gradientWord.sequence') ? wide(it) : textWidthEm(text, it.font, it.style.weight, upper, it.style.letterSpacingEm ?? 0);
      const w = round2(wEm * px);
      const h = round2(px * m.lineEm);
      if (out.length) y += round2(px * 0.08);
      const reveal: number[] = [];
      let swapFrames: number[] = [];
      let wordFills: RenderLine['wordFills'] = [];
      if (preset === 'hero.perLetter.behind') {
        const n = Array.from(text).length;
        const step = Math.max(1, Math.min(3, Math.floor(16 / Math.max(1, n))));
        for (let i = 0; i < n; i += 1) reveal.push(i * step);
      } else if (preset === 'hero.gradientWord.sequence') {
        const toks = text.split(/\s+/);
        const inRange = words.slice(ev.wordRange[0], ev.wordRange[1] + 1);
        let cursor = 0;
        toks.forEach((t, i) => {
          const at = inRange.findIndex((w2, k) => k >= cursor && normToken(w2.text) === normToken(t));
          if (at >= 0) cursor = at + 1;
          reveal.push(at >= 0 ? Math.max(0, inRange[at]!.startFrame - inFrame) : i * 6);
          const named = Object.values(brand.palette.gradients)[i % Math.max(1, Object.keys(brand.palette.gradients).length)];
          wordFills.push({kind: 'gradient', colors: named ?? SEQ_GRADIENTS[i % SEQ_GRADIENTS.length]!, angleDeg: 100});
        });
      }
      if (ti === 0 && it.swapWords.length) {
        swapFrames = (it.l.swapSlot?.wordIdxSequence ?? []).map((k, i) => (i === 0 ? 0 : Math.max(0, (words[k]?.startFrame ?? inFrame) - inFrame)));
      }
      out.push({
        text,
        role: it.l.role,
        font: it.font,
        fontPx: px,
        italic: Boolean(it.style.italic) || it.font === 'playfairItalic',
        weight: SINGLE_WEIGHT.has(it.font) ? 400 : it.style.weight,
        letterSpacingEm: it.style.letterSpacingEm ?? 0,
        uppercase: upper,
        dx: 0,
        dy: round2(y),
        w,
        h,
        fill: fillFor(it.style, brand, ev.styleOverrides?.gradient, args.accent),
        revealFrames: reveal,
        swapWords: ti === 0 ? it.swapWords : [],
        swapFrames,
        wordFills,
        ...LEGACY_WORD,
      });
      y += h;
    }
  }
  void seqWords;
  const bw = Math.max(...out.map(l => l.w));
  const block = {w: round2(bw), h: round2(y)};
  for (const l of out) l.dx = round2((bw - l.w) / 2);
  return {lines: out, block};
}

// ---------------------------------------------------------------------------------------------------------------- keyframes

type Base = {cx: number; cy: number; scale: number; rotateX: number; rotateY: number};

function buildKeyframes(args: {
  inFrame: number; outFrame: number; entrance: (typeof PRESETS)[PresetName]['entrance']; base: Base; anchor: keyof typeof ANCHOR_FACTOR;
  cameraAt: (frame: number) => {scale: number; tx: number; ty: number}; block: {w: number; h: number}; perspectivePx: number; safe: Rect; width: number; height: number;
  /** library entry / exit of this lockup (block-level; absent = the preset's own entrance) */
  enter?: AnimName; exit?: ExitName; fps?: number;
}): Keyframe[] {
  const {inFrame, outFrame, entrance, base, anchor} = args;
  const dur = Math.max(2, outFrame - inFrame);
  const fps = args.fps ?? 30;
  const E = Math.min(args.enter ? entryFrames(args.enter, fps) : ENTRANCE_FRAMES, Math.floor(dur / 2));
  const X = Math.min(args.exit ? Math.max(2, exitFrames(args.exit, fps)) : EXIT_FRAMES, Math.floor(dur / 3));
  const set = new Set<number>([inFrame, outFrame]);
  for (const o of [1, 2, 3, 4, 6, 8, E]) if (o <= E) set.add(inFrame + o);
  for (let f = inFrame + E; f < outFrame - X; f += 6) set.add(f);
  for (let o = X; o >= 0; o -= 2) set.add(outFrame - o);
  set.add(outFrame - X);
  const frames = [...set].filter(f => f >= inFrame && f <= outFrame).sort((a, b) => a - b);
  const f0 = ANCHOR_FACTOR[anchor];
  const cam0 = args.cameraAt(inFrame);
  return frames.map(f => {
    const u = easeOutCubic(Math.min(1, (f - inFrame) / Math.max(1, E)));
    const v = f >= outFrame - X ? (f - (outFrame - X)) / Math.max(1, X) : 0;
    let dx = 0, dy = 0, sc = 1, op = 1, blur = 0, rx = 0, ry = 0;
    if (args.enter) {
      // library entry (IN-*): sampled pose offsets on the block
      const p = entryPose(args.enter, Math.min(E, f - inFrame), {fps, bw: args.block.w, k: args.width / 1080, t: 0.5, width: args.width, dir: 1, wordW: args.block.w});
      if (f - inFrame < E) { op = p.opacity; blur = p.blurPx; sc = p.scale; dx = p.x; dy = p.y; rx = p.rotateX; ry = p.rotateY; }
    } else switch (entrance) {
      case 'blurFade': op = u; blur = 14 * (1 - u); sc = 1 + 0.04 * (1 - u); break;
      case 'slide': op = u; dy = 0.035 * args.height * (1 - u); break;
      case 'rise': op = Math.min(1, u * 2); dy = 0.1 * args.height * (1 - u); sc = 0.94 + 0.06 * u; break;
      case 'streak': op = u; dx = -0.08 * args.width * (1 - u); blur = 8 * (1 - u); break;
      case 'pop': { const t = Math.min(1, (f - inFrame) / Math.max(1, E)); sc = 0.88 + 0.12 * easeOutBack(t); op = Math.min(1, t * 3); break; }
      case 'perLetter': case 'none': default: op = entrance === 'none' ? 1 : Math.min(1, u * 3); break;
    }
    if (args.exit && v > 0) {
      const ex = expoIn(Math.min(1, v));
      if (args.exit === 'OUT-4') { op *= 1 - ex; blur += 20 * ex; sc *= 1 + 0.06 * ex; }
      else if (args.exit === 'OUT-2' || args.exit === 'OUT-3') { op *= 1 - ex; blur += 60 * ex; sc *= 1 + 0.25 * ex; }
      else if (args.exit === 'OUT-7') op *= 1 - 0.7 * ex;
      else { op *= 1 - v; blur += 6 * v; }
    } else { op *= 1 - v; blur += 6 * v; }
    // hold: the scale eases 1.00 -> ~1.04 while visible (never a static hold)
    sc *= 1 + 0.04 * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, (f - inFrame) / dur)));
    const cam = args.cameraAt(f);
    const camScale = 1 + f0 * (cam.scale / (cam0.scale || 1) - 1);
    return {
      frame: f,
      x: round2(base.cx + dx + f0 * (cam.tx - cam0.tx)),
      y: round2(base.cy + dy + f0 * (cam.ty - cam0.ty)),
      scale: Math.round(base.scale * sc * camScale * 10000) / 10000,
      opacity: round2(op),
      rotateX: base.rotateX + rx,
      rotateY: base.rotateY + ry,
      blurPx: round2(blur),
      z: 0,
    };
  });
}

/** Per keyframe: scale down until the projected AABB fits, then shift inside the safe rect. Guarantees `safe` containment. */
export function clampKeyframesToSafe(kfs: Keyframe[], block: {w: number; h: number}, perspectivePx: number, safe: Rect): Keyframe[] {
  const inner: Rect = {left: safe.left + SAFE_TOLERANCE_PX, right: safe.right - SAFE_TOLERANCE_PX, top: safe.top + SAFE_TOLERANCE_PX, bottom: safe.bottom - SAFE_TOLERANCE_PX};
  return kfs.map(k0 => {
    let k = {...k0};
    for (let i = 0; i < 40; i += 1) {
      const r = projectBlockAabb(block, k, perspectivePx);
      const w = r.right - r.left, h = r.bottom - r.top;
      const iw = inner.right - inner.left, ih = inner.bottom - inner.top;
      if (w > iw || h > ih) { k = {...k, scale: k.scale * Math.max(0.9, Math.min(iw / w, ih / h) * 0.995)}; continue; }
      const dx = Math.max(0, inner.left - r.left) - Math.max(0, r.right - inner.right);
      const dy = Math.max(0, inner.top - r.top) - Math.max(0, r.bottom - inner.bottom);
      if (dx === 0 && dy === 0) break;
      k = {...k, x: k.x + dx, y: k.y + dy};
    }
    return {...k, x: round2(k.x), y: round2(k.y), scale: Math.round(k.scale * 10000) / 10000};
  });
}

// ---------------------------------------------------------------------------------------------------------------- the solver

type Group = {suffix: string; lineIdx: number[]; layering: TextEvent['layering']; region: RegionHint};

function groupsOf(ev: TextEvent, preset: PresetName): Group[] {
  const def = PRESETS[preset];
  const region = ev.regionHint === 'auto' ? def.region : ev.regionHint;
  if (preset === 'stack.twoHero.depth' && ev.lines.length >= 2) {
    return [
      {suffix: '.a', lineIdx: [0], layering: 'behind', region: 'upperCenter'},
      {suffix: '.b', lineIdx: ev.lines.slice(1).map((_, i) => i + 1), layering: 'auto', region: 'betweenSubjects'},
    ];
  }
  if (preset === 'stack.twoCluster.behind' && ev.lines.length >= 2) {
    const heroIdx = ev.lines.map((l, i) => (l.role === 'hero' ? i : -1)).filter(i => i >= 0);
    const a = heroIdx.length && heroIdx.length < ev.lines.length ? heroIdx : ev.lines.slice(0, Math.ceil(ev.lines.length / 2)).map((_, i) => i);
    const b = ev.lines.map((_, i) => i).filter(i => !a.includes(i));
    return [
      {suffix: '.a', lineIdx: a, layering: ev.layering === 'auto' ? def.layering : ev.layering, region},
      {suffix: '.b', lineIdx: b, layering: 'auto', region: 'lowerCenter'},
    ];
  }
  return [{suffix: '', lineIdx: ev.lines.map((_, i) => i), layering: ev.layering, region}];
}

const phaseOf = (role: LineRole) => HOLD[role];
/** vendored single-weight faces: any other CSS weight would be a synthetic bold */
const SINGLE_WEIGHT: ReadonlySet<FontKey> = new Set<FontKey>(['anton', 'archivoBlack', 'pacifico']);

export function solveLayout(input: SolveInput): {spec: RenderSpec; report: SolveReport} {
  const {plan, words, shots, scenes, depth, brand, width, height, fps, seed} = input;
  const safe = shortsSafeRect(width, height);
  const safeR: Rect = {left: safe.left, right: safe.right, top: safe.top, bottom: safe.bottom};
  const report: SolveReport = {actions: [], dropped: [], violations: [], anchorDowngrades: []};
  const act = (eventId: string, action: string, detail?: string) => report.actions.push({eventId, action, ...(detail ? {detail} : {})});
  const events: RenderEvent[] = [];
  const neutralScene = (shotId: string): ShotScene => scenes[shotId] ?? {shotId, noMatte: true, estimated: true, subjectBox: {x: 0.3, y: 0.3, w: 0.4, h: 0.62}, alphaAreaFrac: 0, faceKeepOut: {x: 0.3, y: 0.3, w: 0.4, h: 0.26}, freeSpace: [], blurHint: 0, luminance: 0.45};

  const ordered = [...plan.events].filter(e => e.wordRange[1] < words.length && e.wordRange[0] <= e.wordRange[1]).sort((a, b) => (words[a.wordRange[0]]!.startFrame - words[b.wordRange[0]]!.startFrame) || a.id.localeCompare(b.id));
  for (const e of plan.events) if (!ordered.includes(e)) report.dropped.push({eventId: e.id, reason: 'wordRange outside transcript'});

  const cameraAt = (frame: number) => {
    const shot = shotOfFrame(shots, frame);
    return cameraSampleAt(shot ? input.cameras?.[shot.id] : undefined, frame);
  };

  // ---- match cuts (type.matchCut): own frame, <= 1 per 20 s, never overlapped by other type; solved first so everything else can step around them
  const mc = acceptMatchCuts(ordered, words, shots, fps);
  report.dropped.push(...mc.dropped);
  const matchCutEvents: RenderEvent[] = [];
  for (const m of mc.accepted) {
    const re = solveMatchCutEvent({ev: m.ev, words, shot: m.shot, fps, width, height, window: m.window, style: planStyle(plan)});
    if (re) matchCutEvents.push(re);
  }
  const mcStart = (o: TextEvent) => mc.accepted.find(m => m.ev === o)?.window.inFrame ?? words[o.wordRange[0]]!.startFrame;

  const pbState = newPlaybookState();
  const myIsLast = (e: TextEvent) => ordered.indexOf(e) === ordered.length - 1;
  for (const ev of ordered) {
    if (ev.preset === 'type.matchCut') continue;
    const shot = shots.find(s => s.id === ev.shotId) ?? shotOfFrame(shots, words[ev.wordRange[0]]!.startFrame);
    if (!shot) { report.dropped.push({eventId: ev.id, reason: 'no shot'}); continue; }
    const scene = neutralScene(shot.id);
    // ---- preset (+ worker gate fallback)
    const presetResolved: PresetName = input.presetOverrides?.[ev.id] ?? (ev.needsCustomTreatment ? closestPreset(ev.needsCustomTreatment.description, ev.preset) : ev.preset);
    if (ev.needsCustomTreatment) act(ev.id, 'custom-treatment-fallback', presetResolved);
    const def = PRESETS[presetResolved];
    const isCaptionOnly = ev.lines.every(l => isCaptionLike(l.role));
    const dominant: LineRole = ev.lines.some(l => l.role === 'hero') ? 'hero' : ev.lines.some(l => l.role === 'punch') ? 'punch' : ev.lines.some(l => l.role === 'support') ? 'support' : ev.lines.some(l => l.role === 'connector') ? 'connector' : 'caption';

    // ---- time window (cuts)
    let inFrame = words[ev.wordRange[0]]!.startFrame;
    let outFrame = words[ev.wordRange[1]]!.endFrame + phaseOf(dominant);
    if (!ev.persistAcrossCut) { inFrame = Math.max(inFrame, shot.startFrame); outFrame = Math.min(outFrame, shot.endFrame); }
    if (presetResolved === 'type.words') ({inFrame, outFrame} = playbookWindow(ev, words, shot, fps));
    if (outFrame - inFrame < 6) outFrame = ev.persistAcrossCut ? inFrame + 6 : Math.min(shot.endFrame, inFrame + 6);
    if (outFrame - inFrame < 4) { report.dropped.push({eventId: ev.id, reason: 'too short after clipping to the shot'}); continue; }
    if (mc.accepted.some(m => inFrame < m.window.outFrame + MIN_GAP_FRAMES && m.window.inFrame < outFrame + MIN_GAP_FRAMES)) { report.dropped.push({eventId: ev.id, reason: 'overlaps a match cut'}); continue; }

    // ---- density against what is already accepted
    const isHeroEv = ev.lines.some(l => l.role === 'hero') && def.hasHero;
    let skip = false;
    for (const prev of events) {
      const pid = parentId(prev.id);
      if (pid === ev.id) continue;
      const related = prev.wordRange[0] <= ev.wordRange[1] && ev.wordRange[0] <= prev.wordRange[1];
      const prevHero = prev.lines.some(l => l.role === 'hero');
      const prevCap = prev.lines.every(l => isCaptionLike(l.role));
      const needGap = !related && !isCaptionOnly && !prevCap;
      const gap = needGap ? MIN_GAP_FRAMES : isCaptionOnly && prevCap ? 0 : 0;
      if (prev.inFrame < outFrame + gap && inFrame < prev.outFrame + gap) {
        if (isHeroEv && prevHero && !related) {
          // trim the earlier one so this one can start with the gap
          const trimmed = inFrame - gap;
          if (prev.zone === null && trimmed - prev.inFrame >= 6) { prev.outFrame = trimmed; prev.keyframes = retimeTail(prev, trimmed); act(prev.id, 'trim-for-gap', `outFrame=${trimmed}`); } else { skip = true; }
        } else if (needGap || (isCaptionOnly && prevCap)) {
          const trimmed = inFrame - gap;
          if (prev.zone === null && trimmed - prev.inFrame >= 4) { prev.outFrame = trimmed; prev.keyframes = retimeTail(prev, trimmed); act(prev.id, 'trim-for-gap', `outFrame=${trimmed}`); } else skip = true;
        }
      }
    }
    // clusters <= 2 and caption <= 1 active at once
    if (!skip) {
      const active = events.filter(p => parentId(p.id) !== ev.id && p.inFrame < outFrame && inFrame < p.outFrame);
      const clusters = new Set(active.filter(p => !p.lines.every(l => isCaptionLike(l.role))).map(p => parentId(p.id)));
      if (!isCaptionOnly && clusters.size >= 2) skip = true;
      if (isHeroEv && active.some(p => p.lines.some(l => l.role === 'hero') && !(p.wordRange[0] <= ev.wordRange[1] && ev.wordRange[0] <= p.wordRange[1]))) skip = true;
    }
    if (skip) { report.dropped.push({eventId: ev.id, reason: 'density / gap rules'}); continue; }

    // ---- anchor (jitter downgrade)
    let anchor: keyof typeof ANCHOR_FACTOR = ev.anchor === 'auto' ? def.anchor : ev.anchor;
    const camTracks = shots.filter(s => s.startFrame < outFrame && s.endFrame > inFrame).map(s => input.cameras?.[s.id]);
    const jitter = Math.max(0, ...camTracks.map(c => cameraJitter(c, height)));
    while (anchor !== 'screen' && ANCHOR_FACTOR[anchor] * jitter > JITTER_MAX) {
      const next = ANCHOR_DOWNGRADE[anchor];
      report.anchorDowngrades.push({eventId: ev.id, action: 'anchor-downgrade', detail: `${anchor}->${next} (accel ${(jitter * ANCHOR_FACTOR[anchor]).toFixed(2)})`});
      anchor = next;
    }

    if (presetResolved === 'type.words') {
      const myIdx = ordered.indexOf(ev);
      const limitOut = Math.min(Infinity, ...ordered.slice(myIdx + 1)
        .filter(o => !(o.wordRange[0] <= ev.wordRange[1] && ev.wordRange[0] <= o.wordRange[1]))
        .map(o => mcStart(o) - (o.lines.some(l => l.role === 'hero' || l.role === 'punch') ? 2 : 1) - (!isCaptionOnly && !o.lines.every(l => isCaptionLike(l.role)) ? MIN_GAP_FRAMES : 1)));
      if (limitOut - inFrame < 8) { report.dropped.push({eventId: ev.id, reason: 'density / gap rules'}); continue; }
      const res = solvePlaybookEvent({ev, style: planStyle(plan), fontPair: plan.fontPair, words, shot, scene, width, height, fps, seed, depth, cameraAt, limitOut, isLast: myIdx === ordered.length - 1, state: pbState, phase: 0, varyPose: input.planSource === 'director' || input.planSource === 'fallback'});
      for (const a of res.actions) act(ev.id, a.action, a.detail);
      if (res.dropped || res.events.length === 0) { report.dropped.push({eventId: ev.id, reason: res.dropped ?? 'playbook produced no event'}); continue; }
      for (const e of res.events) { e.notes.push(...res.notes); events.push(e); if (e.notes.some(n => n.startsWith('unresolved'))) report.violations.push({eventId: e.id, rule: 'unresolved', detail: e.notes.join('; ')}); }
      continue;
    }
    const rng = mulberry32(seedFor(seed, ev.id));
    // library motion for the block-level presets: tagged (or rotated) entry + exit, never the same pair twice in a row
    const lmotion = pickLegacyMotion(pbState, ev, myIsLast(ev));
    const bgHex = lumToHex(scene.luminance);
    const accentRaw = resolveAccent(ev.accent) ?? plateAccents(scene.plateColor, bgHex)[0]!;
    const accentHex = nudgeForContrast(accentRaw, bgHex).hex;
    for (const g0 of groupsOf(ev, presetResolved)) {
      const gLines = g0.lineIdx.map(i => ev.lines[i]!);
      if (gLines.length === 0) continue;
      // a side gutter that the measured speaker box leaves too narrow (a close-up fills the frame) is not an open side: use the preset's own region instead of squeezing the type into a sliver
      const gut0 = gutterOf(g0.region, scene, inFrame, width, safe);
      const gutterTooNarrow = gut0 !== null && gut0.right - gut0.left < 0.22 * width;
      const g: Group = gutterTooNarrow ? {...g0, region: def.region} : g0;
      const gut = gutterTooNarrow ? null : gut0;
      const built = buildBlock({lines: gLines, preset: presetResolved, ev, brand, width, height, words, inFrame, fps, accent: accentHex, fontPair: plan.fontPair, ...(gut ? {maxW: gut.right - gut.left} : {})});
      const requested = g.layering === 'auto' ? def.layering : g.layering;
      const gHero = gLines.some(l => l.role === 'hero') && def.hasHero;
      const notes: string[] = [];
      const perspectivePx = Math.max(900, width * 1.4);
      const rotateX = def.rotateX;
      const rotateY = def.rotateY;

      // ---- forced front / no matte
      let wantBehind = requested === 'behind' || (requested === 'auto');
      if (def.name === 'caption.serif.lower' || isCaptionOnly) wantBehind = false;
      if (scene.noMatte) { if (wantBehind) notes.push('no-matte: forced front'); wantBehind = false; }
      else if (scene.alphaAreaFrac > FORCE_FRONT_ALPHA_AREA && wantBehind) { notes.push(`alpha-area ${scene.alphaAreaFrac.toFixed(2)} > ${FORCE_FRONT_ALPHA_AREA}: forced front`); wantBehind = false; act(ev.id + g.suffix, 'force-front', 'alpha-area'); }

      const prefY = preferredCy({region: g.region, scene, block: built.block, scale: 1, safe, width, height, behind: wantBehind, hero: gHero, frame: inFrame});
      if (wantBehind && gHero) {
        // bbox overlap of the hero box at its preferred position
        const heroLine = built.lines.find(l => l.role === 'hero')!;
        const r = projectLineAabb(heroLine, built.block, {x: width / 2, y: prefY, scale: 1, rotateX, rotateY, z: 0}, perspectivePx);
        const sb = boxAt(scene, inFrame);
        const subj: Rect = {left: sb.x * width, right: (sb.x + sb.w) * width, top: sb.y * height, bottom: (sb.y + sb.h) * height};
        const ov = overlapFraction(r, subj);
        // a measured alpha grid decides (hero occlusion ~4-22%, first/last letters readable); the bbox shortcut is only for an estimated box
        if (ov > FORCE_FRONT_BOX_OVERLAP && !scene.grid) { wantBehind = false; notes.push(`hero box overlaps subject bbox ${(ov * 100).toFixed(0)}% > 70%: forced front`); act(ev.id + g.suffix, 'force-front', 'bbox-overlap'); }
      }

      const others = events.filter(p => p.inFrame < outFrame && inFrame < p.outFrame).map(p => eventBlockAabbAtMid(p));
      const solveFor = (behind: boolean) => searchPlacement({behind, g, built, def, presetResolved, rotateX, rotateY, perspectivePx, scene, depth, width, height, safe: safeR, inFrame, outFrame, anchor, cameraAt, rng, others, hero: gHero, gLines, enter: lmotion.enter, exit: lmotion.exit, fps});
      let layering: 'behind' | 'front' = wantBehind ? 'behind' : 'front';
      let sol = solveFor(layering === 'behind');
      if (layering === 'behind' && !sol.ok) {
        notes.push(`behind rejected (${sol.why}); flipped to front`);
        act(ev.id + g.suffix, 'flip-front', sol.why);
        layering = 'front';
        sol = solveFor(false);
      } else if (layering === 'behind' && sol.shrink > 0) act(ev.id + g.suffix, 'shrink', `${(sol.shrink * 100).toFixed(0)}%`);
      if (!sol.ok) { notes.push(`unresolved: ${sol.why}`); report.violations.push({eventId: ev.id + g.suffix, rule: 'unresolved', detail: sol.why}); }

      // ---- contrast: shadow always, stroke when < 3:1 on the plate
      const bg = lumToHex(scene.luminance);
      const worst = Math.min(...built.lines.flatMap(l => [worstContrast(l.fill.colors, bg)]));
      const lowContrast = worst < CONTRAST_MIN;
      if (lowContrast) notes.push(`contrast ${worst.toFixed(1)}:1 < 3:1: stroke added`);
      const px = Math.max(...built.lines.map(l => l.fontPx));
      const shadow: RenderEvent['shadow'] = {
        color: scene.luminance > 0.5 ? 'rgba(0,0,0,0.38)' : 'rgba(0,0,0,0.55)',
        blurPx: round2(px * 0.06), offsetY: round2(px * 0.03),
        strokePx: lowContrast ? round2(Math.max(1.5, px * 0.025)) : 0,
        ...(lowContrast ? {strokeColor: contrastStrokeColor(scene.luminance)} : {}),
        ...(def.material === 'glow' || ev.styleOverrides?.material === 'glow' ? {glowColor: GOLD[1]!, glowPx: round2(px * 0.12)} : {glowPx: 0}),
      };
      const material = ev.styleOverrides?.material ?? def.material;
      const finalOcc = lineOcclusions({lines: built.lines, block: built.block, keyframes: sol.keyframes, perspectivePx}, scene, depth, width, height);
      const heroOcc = finalOcc.filter((_, i) => built.lines[i]!.role === 'hero');
      const occAll = layering === 'behind' ? (heroOcc.length ? heroOcc : finalOcc) : [{mean: 0, max: 0}];
      let minMargin = Infinity;
      for (const k of sol.keyframes) minMargin = Math.min(minMargin, marginInside(projectBlockAabb(built.block, k, perspectivePx), safeR));
      events.push({
        id: ev.id + g.suffix,
        shotId: shot.id,
        preset: ev.preset,
        presetResolved,
        inFrame,
        outFrame,
        fps,
        layering,
        anchor,
        material,
        perspectivePx,
        block: built.block,
        lines: built.lines.map(l => ({...l, anim: lmotion.enter})),
        keyframes: sol.keyframes,
        shadow,
        depthBlurPx: round2(def.depthBlurPx + (layering === 'behind' ? scene.blurHint * 2 : 0)),
        tint: presetResolved === 'plane3d.receding.swap' ? '#101829' : null,
        occlusionFraction: {mean: round2(occAll.reduce((a, b) => a + b.mean, 0) / occAll.length), max: round2(Math.max(...occAll.map(o => o.max)))},
        safeProof: {ok: minMargin >= -SAFE_TOLERANCE_PX - 1e-6, sampledKeyframes: sol.keyframes.length, minMarginPx: round2(minMargin)},
        wordRange: ev.wordRange,
        persistAcrossCut: Boolean(ev.persistAcrossCut),
        notes,
        style: planStyle(plan), zone: null, exit: lmotion.exit, hold: {push: [1, 1.04], rotY: 3, rotX: 1.5, periodSec: 5}, flash: null,
      });
    }
  }
  events.push(...matchCutEvents);
  events.sort((a, b) => a.inFrame - b.inFrame || a.id.localeCompare(b.id));
  const last = Math.max(0, ...events.map(e => e.outFrame), ...shots.map(s => s.endFrame));
  const spec: RenderSpec = {
    version: '1',
    seed,
    fps,
    width,
    height,
    durationInFrames: last,
    safeRect: {left: round2(safe.left), right: round2(safe.right), top: round2(safe.top), bottom: round2(safe.bottom)},
    noMatte: shots.length > 0 && shots.every(s => scenes[s.id]?.noMatte !== false),
    shots: shots.map(s => ({id: s.id, startFrame: s.startFrame, endFrame: s.endFrame, noMatte: scenes[s.id]?.noMatte !== false})),
    events,
    captions: buildGapCaptions({words, events, shots, scenes: Object.fromEntries(shots.map(sh => [sh.id, neutralScene(sh.id)])), width, height, fps}),
    ...(plan.fontPair ? {fontPair: plan.fontPair} : {}),
    planSource: input.planSource,
  };
  report.violations.push(...verifyRenderSpec(spec, {scenes: Object.fromEntries(shots.map(s => [s.id, neutralScene(s.id)])), depth, shots, ...(input.cameras ? {cameras: input.cameras} : {}), words, plan}));
  return {spec, report};
}

/** Re-time a trimmed event: drop keyframes after the new out and re-add the fade-out tail. */
function retimeTail(ev: RenderEvent, newOut: number): Keyframe[] {
  const X = Math.min(EXIT_FRAMES, Math.max(1, Math.floor((newOut - ev.inFrame) / 3)));
  const kept = ev.keyframes.filter(k => k.frame < newOut - X);
  const at = (f: number) => interpolateKeyframes(ev.keyframes, f);
  const tail: Keyframe[] = [];
  for (let o = X; o >= 0; o -= 2) { const f = newOut - o; const k = at(f); tail.push({...k, frame: f, opacity: round2(k.opacity * (1 - (X - o) / X)), blurPx: round2(k.blurPx + 6 * ((X - o) / X))}); }
  const out = [...kept, ...tail].sort((a, b) => a.frame - b.frame);
  return out.filter((k, i) => i === 0 || k.frame !== out[i - 1]!.frame);
}

function eventBlockAabbAtMid(ev: RenderEvent): Rect {
  const f = Math.round((ev.inFrame + ev.outFrame) / 2);
  return projectBlockAabb(ev.block, interpolateKeyframes(ev.keyframes, f), ev.perspectivePx);
}

/** Free horizontal band beside the subject box (px), or null for any other region. */
function gutterOf(region: RegionHint, scene: ShotScene, frame: number, width: number, safe: {left: number; right: number}): {left: number; right: number} | null {
  if (region !== 'besideLeft' && region !== 'besideRight') return null;
  const b = boxAt(scene, frame);
  const gap = 0.012 * width;
  return region === 'besideRight' ? {left: (b.x + b.w) * width + gap, right: safe.right} : {left: safe.left, right: b.x * width - gap};
}

function preferredCy(a: {region: RegionHint; scene: ShotScene; block: {w: number; h: number}; scale: number; safe: ReturnType<typeof shortsSafeRect>; width: number; height: number; behind: boolean; hero: boolean; frame: number}): number {
  const {safe, height} = a;
  const half = (a.block.h * a.scale) / 2;
  const sb = boxAt(a.scene, a.frame);
  const clamp = (y: number) => Math.min(safe.bottom - half, Math.max(safe.top + half, y));
  switch (a.region) {
    case 'besideLeft': case 'besideRight': return clamp((sb.y + 0.3 * sb.h) * height);
    case 'behindSignature': return a.behind ? clamp((sb.y + 0.3 * sb.h) * height) : clamp(sb.y * height - half - 0.01 * height); // legacy presets: a wide word across the shoulders
    case 'lowerCenter': return clamp(safe.bottom - half - 0.04 * height);
    case 'betweenSubjects': return clamp((sb.y + sb.h * 0.55) * height);
    case 'upperLeft': case 'upperRight': case 'upperCenter': default:
      return a.behind ? clamp((sb.y + 0.1 * sb.h) * height) : clamp(sb.y * height - half - 0.01 * height);
  }
}

type SearchArgs = {
  behind: boolean; g: Group; built: Built; def: (typeof PRESETS)[PresetName]; presetResolved: PresetName; rotateX: number; rotateY: number; perspectivePx: number; scene: ShotScene; depth: DepthProvider;
  width: number; height: number; safe: Rect; inFrame: number; outFrame: number; anchor: keyof typeof ANCHOR_FACTOR; cameraAt: (f: number) => {scale: number; tx: number; ty: number};
  rng: () => number; others: Rect[]; hero: boolean; gLines: TextEvent['lines'];
  enter?: AnimName; exit?: ExitName; fps?: number;
};
type Placement = {ok: boolean; why: string; keyframes: Keyframe[]; shrink: number};

/** Candidate search: position grid x shrink attempts. Behind: hero occlusion ~12% preferred, <= 28% hard, first/last letters readable; support/caption <= 5%. Front: stay off the face keep-out. */
function searchPlacement(a: SearchArgs): Placement {
  const {built, scene, width, height, safe} = a;
  const safeW = safe.right - safe.left;
  // behind: move, then shrink <= 15%, else the caller flips to front. Front has no 15% cap: it shrinks further rather than cover the face.
  // behind: a wide hero over a close-up speaker only clears the head by getting smaller, so it may shrink as far as the readability floor allows (it used to stop at -15% and flip to front)
  const baseScales = a.behind ? [1, 0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.48] : [1, 0.92, 0.85, 0.75, 0.65, 0.55, 0.45];
  // readability floor: a hero never shrinks through 7.5% of the frame height (a 3D hero is not allowed to end up caption-sized); when no scale holds it, only the full size is tried
  const heroPx = Math.max(0, ...built.lines.filter(l => l.role === 'hero' || l.role === 'punch').map(l => l.fontPx));
  const floorS = heroPx > 0 ? (HERO_FLOOR_FRAC * height) / heroPx : 0;
  const floored = baseScales.filter(sc => sc >= floorS - 1e-9);
  const scales = floored.length ? floored : [baseScales[0]!];
  const sbx = boxAt(scene, a.inFrame);
  let best: {cost: number; kfs: Keyframe[]; shrink: number; ok: boolean; why: string} | null = null;
  for (const shrink of scales) {
    const s = shrink;
    const bw = built.block.w * s, bh = built.block.h * s;
    const gutter = gutterOf(a.g.region, scene, a.inFrame, width, shortsSafeRect(width, height));
    const xs = gutter ? [(gutter.left + gutter.right) / 2] : a.g.region === 'upperLeft' ? [safe.left + bw / 2] : a.g.region === 'upperRight' ? [safe.right - bw / 2] : [width / 2, width / 2 - 0.06 * safeW, width / 2 + 0.06 * safeW, width / 2 - 0.12 * safeW, width / 2 + 0.12 * safeW, ...(a.behind ? [-0.18, 0.18, -0.24, 0.24, -0.3, 0.3].map(f => width / 2 + f * safeW) : [])];
    const pref = preferredCy({region: a.g.region, scene, block: built.block, scale: s, safe: shortsSafeRect(width, height), width, height, behind: a.behind, hero: a.hero, frame: a.inFrame});
    const ys: number[] = [];
    const step = 0.025 * (safe.bottom - safe.top);
    for (let y = safe.top + bh / 2; y <= safe.bottom - bh / 2 + 1e-6; y += step) ys.push(y);
    if (ys.length === 0) ys.push((safe.top + safe.bottom) / 2);
    let anyHardOk = false;
    let hardWhy = 'no candidate';
    for (const cx of xs) {
      for (const cy of ys) {
        const base: Base = {cx: Math.min(safe.right - bw / 2, Math.max(safe.left + bw / 2, cx)), cy, scale: s, rotateX: a.rotateX, rotateY: a.rotateY};
        let kfs = buildKeyframes({inFrame: a.inFrame, outFrame: a.outFrame, entrance: a.def.entrance, base, anchor: a.anchor, cameraAt: a.cameraAt, block: built.block, perspectivePx: a.perspectivePx, safe: a.safe, width, height, ...(a.enter ? {enter: a.enter} : {}), ...(a.exit ? {exit: a.exit} : {}), ...(a.fps ? {fps: a.fps} : {})});
        kfs = clampKeyframesToSafe(kfs, built.block, a.perspectivePx, a.safe);
        const ev = {lines: built.lines, block: built.block, keyframes: kfs, perspectivePx: a.perspectivePx};
        let cost = Math.abs(cy - pref) / (safe.bottom - safe.top) * 0.6 + Math.abs(cx - width / 2) / safeW * 0.3 + a.rng() * 1e-4;
        let hardOk = true;
        let why = '';
        const mid = Math.round((a.inFrame + a.outFrame) / 2);
        const blockMid = projectBlockAabb(built.block, interpolateKeyframes(kfs, mid), a.perspectivePx);
        for (const o of a.others) { const i = intersect(blockMid, o); if (i && rectArea(i) / Math.max(1, rectArea(blockMid)) > 0.04) { hardOk = false; why = 'overlaps another event'; } }
        if (a.behind) {
          const occ = lineOcclusions(ev, scene, a.depth, width, height);
          const edges = lineEdgeOcclusions(ev, scene, a.depth, width, height);
          built.lines.forEach((l, i) => {
            if (l.role === 'hero' && a.hero) {
              if (!heroReadable(occ[i]!, edges[i]!)) { hardOk = false; why = `hero occlusion ${(occ[i]!.max * 100).toFixed(0)}% / edges L ${(edges[i]!.left * 100).toFixed(0)}% R ${(edges[i]!.right * 100).toFixed(0)}%`; }
              cost += Math.abs(occ[i]!.mean - HERO_OCC_PREF) * 2 + (edges[i]!.left + edges[i]!.right);
            } else if (occ[i]!.max > SUPPORT_OCC_MAX) { hardOk = false; why = `${l.role} occlusion ${(occ[i]!.max * 100).toFixed(0)}% > 5%`; }
          });
        } else {
          for (const fr of [a.inFrame + Math.min(8, a.outFrame - a.inFrame - 1), mid]) {
            const fb = boxAt(scene, fr);
            const keep: Rect = {left: fb.x * width, right: (fb.x + fb.w) * width, top: fb.y * height, bottom: (fb.y + fb.h * 0.42) * height};
            const kf = interpolateKeyframes(kfs, fr);
            if (built.lines.some(l => overlapFraction(projectLineAabb(l, built.block, kf, a.perspectivePx), keep) > 0.02)) { hardOk = false; why = 'face keep-out'; break; }
          }
        }
        if (!hardOk) { hardWhy = why; cost += 100; } else anyHardOk = true;
        if (!best || cost < best.cost - 1e-12) best = {cost, kfs, shrink: 1 - s, ok: hardOk, why};
      }
    }
    if (anyHardOk && best && best.ok) return {ok: true, why: '', keyframes: best.kfs, shrink: best.shrink};
    if (s === scales[scales.length - 1] && best) return {ok: false, why: hardWhy, keyframes: best.kfs, shrink: best.shrink};
  }
  return {ok: false, why: 'no placement', keyframes: [], shrink: 0};
}
