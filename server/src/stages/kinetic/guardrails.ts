/**
 * Guardrails (G): independent, pure checks over a solved RenderSpec. The solver uses the same constants and the same occlusion helper; `verifyRenderSpec` re-measures from the spec alone
 * (so a solver bug cannot hide itself). Every rule has a test.
 */
import {contrastRatio, hexLuminance} from '../../lib/contrast.ts';
import {shortsSafeRect} from '../broll/heroSweep.ts';
import {cameraJitter, type CameraTrack} from './camera.ts';
import {HERO_HOLD_FRAMES, MIN_GAP_FRAMES, rangeFrames, transcriptFidelity} from './fallback.ts';
import {eventBlockAabbAt, interpolateKeyframes, marginInside, overlapFraction, projectLineAabb, restingMargin, restingRange, wordAabbAt, type Rect} from './geometry.ts';
import type {DepthProvider} from './depth.ts';
import type {Box, ShotScene} from './scene.ts';
import {boxAt} from './scene.ts';
import {MATCH_CUT_GAP_SEC, matchCutBudget} from './matchCut.ts';
import {interpolateWordKeys} from './motion.ts';
import type {KineticPlan, KineticShot, KineticWord, RenderEvent, RenderSpec} from './schema.ts';

/** Behind the speaker: a little occlusion (the letters live in the scene) but the first and last letters must stay readable. */
export const HERO_OCC_MIN = 0.02;
export const HERO_OCC_MAX_TARGET = 0.22;
export const HERO_OCC_HARD_MAX = 0.28;
/** Solver prefers this mean (a hair tucked under the cap, not a letter swallowed). */
export const HERO_OCC_PREF = 0.12;
/** Max occlusion of the left / right 22% of a behind hero (the K of HOOK, the S of EFFECTS). */
export const HERO_EDGE_OCC_MAX = 0.22;
export const HERO_EDGE_FRAC = 0.22;
export const SUPPORT_OCC_MAX = 0.05;
/** stackOverCutout: a non-hero line that is deliberately behind the matte may be covered this much and stay readable */
export const STACK_BEHIND_OCC_MAX = 0.5;
export const lineLayerOf = (ev: Pick<RenderEvent, 'layering'>, line: {layer?: 'front' | 'behind' | undefined}): 'front' | 'behind' => line.layer ?? ev.layering;
export const FORCE_FRONT_ALPHA_AREA = 0.55;
/** 2026-11-27: the Composer's behind words are placed by measured occlusion (giantBehind), so it only refuses a speaker filling more than this (no room above the head) */
export const COMPOSER_BEHIND_MAX_AREA = 0.8;
export const FORCE_FRONT_BOX_OVERLAP = 0.7;
/**
 * Phase 5.12 (G1-a): the CATEGORICAL behind-the-person eligibility of a shot, i.e. the scene-level part of the solver's own tests (playbook `behindFree` / `stackFree`: `!noMatte &&
 * alphaAreaFrac <= FORCE_FRONT_ALPHA_AREA`; the legacy path in layout.ts; the verifier's `force-front-area`). The per-placement rules (occlusion, edges, face keep-out, 8 s cap, search)
 * are NOT here: an eligible shot can still refuse a given event. Read-only: it tells the Director and the fallback planner what the solver will categorically refuse; the solver itself
 * keeps its own inline tests unchanged.
 */
export function sceneBehindEligibility(scene: Pick<ShotScene, 'noMatte' | 'alphaAreaFrac'>): {eligible: true} | {eligible: false; reason: 'no_matte' | 'alpha_area'} {
  if (scene.noMatte) return {eligible: false, reason: 'no_matte'};
  if (scene.alphaAreaFrac > FORCE_FRONT_ALPHA_AREA) return {eligible: false, reason: 'alpha_area'};
  return {eligible: true};
}
export const MAX_SHRINK = 0.15;
export const CONTRAST_MIN = 3;
/** px / frame^2 of the anchored motion above which the anchor is downgraded */
export const JITTER_MAX = 1.5;
export const ANCHOR_FACTOR = {screen: 0, background: 0.6, 'plane:wall': 0.85, 'plane:floor': 1} as const;
export const ANCHOR_DOWNGRADE = {'plane:floor': 'background', 'plane:wall': 'background', background: 'screen', screen: 'screen'} as const;
export const SAFE_TOLERANCE_PX = 0.5;

/** Group events of one plan event are `<id>.a` / `<id>.b`. */
export const parentId = (id: string): string => id.replace(/\.[ab]$/, '');

/** `caption` (legacy) and `running` are the one-word-at-a-time chest-height lines: exempt from the unrelated-event gap like captions always were. */
export const isCaptionLike = (role: string): boolean => role === 'caption' || role === 'running';

export type Violation = {eventId: string; rule: string; detail: string};

/**
 * The verifier's face keep-out test for ONE line of a playbook event, shared with the solver (Phase 4.2: the solver used to run an older, weaker copy that skipped words without a rest pose and used the union
 * box): each word's own projected box over the frames it is at rest (every 2nd frame); a word whose exit starts before its entry settles has no rest pose and is judged on the frames where it is (nearly) fully
 * visible. `keepAt(frame)` is the per-frame keep-out rect. Returns the first frame that overlaps by more than 2%, or null.
 */
export function lineFaceHitFrame(ev: RenderEvent, l: RenderEvent['lines'][number], keepAt: (frame: number) => Rect): number | null {
  const [r0, r1] = restingRange(ev, l);
  const settled = r0 <= r1;
  const wordOpacity = (fr: number) => (l.wordKeyframes.length ? interpolateWordKeys(l.wordKeyframes, fr).opacity : 1) * interpolateKeyframes(ev.keyframes, fr).opacity;
  const [f0, f1] = settled ? [r0, r1] : [ev.inFrame + l.enterFrame, ev.outFrame];
  for (let fr = f0; fr <= f1; fr += 2) {
    if (!settled && wordOpacity(fr) < 0.9) continue;
    if (overlapFraction(wordAabbAt(ev, l, fr), keepAt(fr)) > 0.02) return fr;
  }
  return null;
}

/** Contrast background colour for a plate luminance (linear 0..1 -> #rrggbb grey). */
export function lumToHex(lum: number): string {
  const l = Math.min(1, Math.max(0, lum));
  const v = l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055;
  const h = Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h}${h}${h}`;
}
export function worstContrast(colors: string[], bgHex: string): number {
  return Math.min(...colors.filter(c => /^#[0-9a-fA-F]{6}$/.test(c)).map(c => contrastRatio(c, bgHex)), 21);
}
export const contrastStrokeColor = (bgLum: number): string => (bgLum > 0.4 ? '#000000' : '#FFFFFF');

const norm = (r: Rect, w: number, h: number): Box => ({x: r.left / w, y: r.top / h, w: (r.right - r.left) / w, h: (r.bottom - r.top) / h});

/** Frames at which an event is fully visible (the keyframes with opacity >= 0.9), thinned to <= `limit` evenly spaced. */
export function holdFrames(ev: Pick<RenderEvent, 'keyframes'>, limit = 6): number[] {
  // the settled hold only: library entries / exits carry motion blur, so frames still moving (blur >= 1.5 px) are not the pose the viewer reads
  const settled = ev.keyframes.filter(k => k.opacity >= 0.9 && k.blurPx < 1.5).map(k => k.frame);
  const f = settled.length >= 2 ? settled : ev.keyframes.filter(k => k.opacity >= 0.9).map(k => k.frame);
  if (f.length <= limit) return f.length ? f : [ev.keyframes[0]!.frame];
  return Array.from({length: limit}, (_, i) => f[Math.round((i * (f.length - 1)) / (limit - 1))]!);
}

/** Visible enough to be read as type: event opacity x word opacity. */
const FACE_TRANSIT_OPACITY = 0.5;

/**
 * Words that pass THROUGH the face keep-out while entering or exiting (not at rest), measured per frame with the word's own opacity. This is a measurement, not a verifier rule: the original
 * verifier only ever checked the settled hold, the solver does not steer transits, and a hard rule would reject today's plans. Reported by the benchmark; see docs.
 */
export function faceTransitWords(spec: RenderSpec, scenes: Record<string, ShotScene>): Array<{eventId: string; text: string; frame: number; phase: 'entering' | 'exiting'}> {
  const out: Array<{eventId: string; text: string; frame: number; phase: 'entering' | 'exiting'}> = [];
  for (const ev of spec.events) {
    const scene = scenes[ev.shotId];
    if (!scene || ev.zone === null) continue;
    for (const l of ev.lines.filter(x => lineLayerOf(ev, x) === 'front')) {
      const [r0, r1] = restingRange(ev, l);
      for (let fr = ev.inFrame; fr <= ev.outFrame; fr += 1) {
        if (fr >= r0 && fr <= r1) continue;
        const wk = l.wordKeyframes.length ? interpolateWordKeys(l.wordKeyframes, fr) : null;
        if ((wk?.opacity ?? 1) * interpolateKeyframes(ev.keyframes, fr).opacity < FACE_TRANSIT_OPACITY) continue;
        const face = boxAt(scene, fr);
        const keep: Rect = {left: face.x * spec.width, right: (face.x + face.w) * spec.width, top: face.y * spec.height, bottom: (face.y + face.h * 0.42) * spec.height};
        if (overlapFraction(wordAabbAt(ev, l, fr), keep) > 0.02) { out.push({eventId: ev.id, text: l.text, frame: fr, phase: fr < r0 ? 'entering' : 'exiting'}); break; }
      }
    }
  }
  return out;
}

/** Per-line {mean,max} fraction of the line box covered by the subject (only meaningful for `behind`). */
export function lineOcclusions(ev: Pick<RenderEvent, 'lines' | 'block' | 'keyframes' | 'perspectivePx'>, scene: ShotScene | undefined, depth: DepthProvider, width: number, height: number): Array<{mean: number; max: number}> {
  const frames = holdFrames(ev);
  return ev.lines.map(line => {
    if (!scene) return {mean: 0, max: 0};
    const vals = frames.map(fr => depth.occlusion(scene, norm(projectLineAabb(line, ev.block, interpolateKeyframes(ev.keyframes, fr), ev.perspectivePx), width, height), fr));
    return {mean: vals.reduce((a, b) => a + b, 0) / vals.length, max: Math.max(...vals)};
  });
}

/** Occlusion of the first and last letters of a line (left / right `HERO_EDGE_FRAC` strips). */
export function lineEdgeOcclusions(ev: Pick<RenderEvent, 'lines' | 'block' | 'keyframes' | 'perspectivePx'>, scene: ShotScene | undefined, depth: DepthProvider, width: number, height: number): Array<{left: number; right: number}> {
  const frames = holdFrames(ev);
  return ev.lines.map(line => {
    if (!scene) return {left: 0, right: 0};
    let left = 0, right = 0;
    for (const fr of frames) {
      const n = norm(projectLineAabb(line, ev.block, interpolateKeyframes(ev.keyframes, fr), ev.perspectivePx), width, height);
      const w = Math.max(1e-4, n.w * HERO_EDGE_FRAC);
      left = Math.max(left, depth.occlusion(scene, {x: n.x, y: n.y, w, h: n.h}, fr));
      right = Math.max(right, depth.occlusion(scene, {x: n.x + n.w - w, y: n.y, w, h: n.h}, fr));
    }
    return {left, right};
  });
}

export const heroReadable = (occ: {mean: number; max: number}, edge: {left: number; right: number}): boolean =>
  occ.max <= HERO_OCC_HARD_MAX && occ.mean <= HERO_OCC_MAX_TARGET && occ.mean >= HERO_OCC_MIN && edge.left <= HERO_EDGE_OCC_MAX && edge.right <= HERO_EDGE_OCC_MAX;

export type VerifyContext = {
  /** largest speaker area (0..1) at which a behind event is legal; default FORCE_FRONT_ALPHA_AREA (the Composer passes COMPOSER_BEHIND_MAX_AREA) */
  behindMaxArea?: number;
  scenes: Record<string, ShotScene>;
  depth: DepthProvider;
  shots: KineticShot[];
  cameras?: Record<string, CameraTrack>;
  words?: KineticWord[];
  plan?: KineticPlan;
};

/** Re-measure a RenderSpec against every rule. An empty array = clean. */
export function verifyRenderSpec(spec: RenderSpec, ctx: VerifyContext): Violation[] {
  const out: Violation[] = [];
  const safe = shortsSafeRect(spec.width, spec.height);
  for (const ev of spec.events) {
    const scene = ctx.scenes[ev.shotId];
    if (ev.presetResolved === 'type.matchCut') {
      // full-frame by design (the grammar bleeds off the edges): only the cut rule applies here; cap + overlap are checked below
      const mshot = ctx.shots.find(s => s.id === ev.shotId);
      if (mshot && !ev.persistAcrossCut && (ev.inFrame < mshot.startFrame || ev.outFrame > mshot.endFrame)) out.push({eventId: ev.id, rule: 'cut', detail: `[${ev.inFrame},${ev.outFrame}) crosses shot ${mshot.id}`});
      if (ev.layering !== 'front') out.push({eventId: ev.id, rule: 'matchcut-front', detail: 'a match cut owns the frame in front of the plate'});
      continue;
    }
    // --- safe rect, every frame of the event (after scale + perspective)
    let minMargin = Infinity;
    if (ev.zone !== null) minMargin = restingMargin(ev, safe); // playbook: the settled ink of every word (E3 / X6 may cross the edge only while they move)
    else for (let f = ev.inFrame; f <= ev.outFrame; f += 1) minMargin = Math.min(minMargin, marginInside(eventBlockAabbAt(ev, f), safe));
    if (minMargin < -SAFE_TOLERANCE_PX) out.push({eventId: ev.id, rule: 'safe-rect', detail: `block leaves the safe rect by ${(-minMargin).toFixed(1)}px`});
    // --- cuts
    const shot = ctx.shots.find(s => s.id === ev.shotId);
    if (shot && !ev.persistAcrossCut && (ev.inFrame < shot.startFrame || ev.outFrame > shot.endFrame)) out.push({eventId: ev.id, rule: 'cut', detail: `[${ev.inFrame},${ev.outFrame}) crosses shot ${shot.id} [${shot.startFrame},${shot.endFrame})`});
    // --- matte
    if (scene?.noMatte && ev.layering === 'behind') out.push({eventId: ev.id, rule: 'no-matte-behind', detail: 'behind text without a matte'});
    if (scene && ev.layering === 'behind') {
      const areaMax = ctx.behindMaxArea ?? FORCE_FRONT_ALPHA_AREA;
      if (scene.alphaAreaFrac > areaMax) out.push({eventId: ev.id, rule: 'force-front-area', detail: `alpha area ${scene.alphaAreaFrac.toFixed(2)} > ${areaMax}`});
      const occ = lineOcclusions(ev, scene, ctx.depth, spec.width, spec.height);
      const edges = lineEdgeOcclusions(ev, scene, ctx.depth, spec.width, spec.height);
      ev.lines.forEach((l, i) => {
        if (lineLayerOf(ev, l) === 'front') return; // a front line of a stack is checked against the face keep-out below
        const limit = l.role === 'hero' ? HERO_OCC_HARD_MAX : ev.zone === 'stackOverCutout' ? STACK_BEHIND_OCC_MAX : SUPPORT_OCC_MAX;
        if (occ[i]!.max > limit + 1e-9) out.push({eventId: ev.id, rule: l.role === 'hero' ? 'hero-occlusion' : 'support-occlusion', detail: `${l.role} "${l.text}" occluded ${(occ[i]!.max * 100).toFixed(0)}% > ${limit * 100}%`});
        if ((l.role === 'hero' || l.role === 'punch') && (edges[i]!.left > HERO_EDGE_OCC_MAX + 1e-9 || edges[i]!.right > HERO_EDGE_OCC_MAX + 1e-9)) {
          out.push({eventId: ev.id, rule: 'hero-edge-occlusion', detail: `"${l.text}" first/last letters occluded L ${(edges[i]!.left * 100).toFixed(0)}% R ${(edges[i]!.right * 100).toFixed(0)}%`});
        }
      });
    }
    // --- face keep-out: anything in front must stay off the upper subject box
    if (scene && (ev.layering === 'front' || ev.lines.some(l => l.layer === 'front'))) {
      const frontLines = ev.lines.filter(l => lineLayerOf(ev, l) === 'front');
      const keepAt = (fr: number): Rect => {
        const face = boxAt(scene, fr);
        return {left: face.x * spec.width, right: (face.x + face.w) * spec.width, top: face.y * spec.height, bottom: (face.y + face.h * 0.42) * spec.height};
      };
      if (ev.zone !== null) {
        // playbook (type.words) events: the same measure the solver and the safe-rect rule above use: each WORD's own projected box (its keyframes, depth and the block pose) over the frames in
        // which it is at rest. The block-level line box ignores words that have not entered yet and over-covers tilted type, which flagged type that was visibly clear of the face.
        for (const l of frontLines) {
          const hitFrame = lineFaceHitFrame(ev, l, (fr: number) => keepAt(fr));
          if (hitFrame !== null) { out.push({eventId: ev.id, rule: 'face-keepout', detail: `front line "${l.text}" covers the face keep-out at frame ${hitFrame}`}); break; }
        }
      } else {
        for (const fr of holdFrames(ev)) {
          const keep = keepAt(fr);
          const kf = interpolateKeyframes(ev.keyframes, fr);
          const hit = frontLines.find(l => overlapFraction(projectLineAabb(l, ev.block, kf, ev.perspectivePx), keep) > 0.02);
          if (hit) { out.push({eventId: ev.id, rule: 'face-keepout', detail: `front line "${hit.text}" covers the face keep-out at frame ${fr}`}); break; }
        }
      }
    }
    // --- contrast
    if (scene) {
      const bg = lumToHex(scene.luminance);
      for (const l of ev.lines) {
        if (worstContrast(l.fill.colors, bg) < CONTRAST_MIN && !(ev.shadow.strokePx > 0 || ev.shadow.glowPx > 0)) out.push({eventId: ev.id, rule: 'contrast', detail: `"${l.text}" < ${CONTRAST_MIN}:1 with no stroke/glow`});
      }
    }
    // --- jitter
    if (ctx.cameras && ev.anchor !== 'screen') {
      const j = Math.max(...Object.values(ctx.cameras).filter(c => ctx.shots.some(s => s.id === c.shotId && s.startFrame < ev.outFrame && s.endFrame > ev.inFrame)).map(c => cameraJitter(c, spec.height)), 0);
      if (ANCHOR_FACTOR[ev.anchor] * j > JITTER_MAX) out.push({eventId: ev.id, rule: 'jitter', detail: `anchored (${ev.anchor}) accel ${(ANCHOR_FACTOR[ev.anchor] * j).toFixed(2)} px/f² > ${JITTER_MAX}`});
    }
  }
  // --- density / gaps (events that share words are related and exempt from the gap)
  const evs = spec.events;
  // --- match cuts: <= 1 per 20 s, and no other type on screen with one
  const cuts = evs.filter(e => e.presetResolved === 'type.matchCut');
  const cutBudget = matchCutBudget(spec.durationInFrames / spec.fps);
  if (cuts.length > cutBudget) for (const c of cuts.slice(cutBudget)) out.push({eventId: c.id, rule: 'matchcut-cap', detail: `more than ${cutBudget} match cut(s) for a ${Math.round(spec.durationInFrames / spec.fps)} s video`});
  for (let i = 0; i < cuts.length; i += 1) {
    for (let j = i + 1; j < cuts.length; j += 1) if (Math.abs(cuts[i]!.inFrame - cuts[j]!.inFrame) < MATCH_CUT_GAP_SEC * spec.fps) out.push({eventId: cuts[j]!.id, rule: 'matchcut-cap', detail: `${cuts[i]!.id} and ${cuts[j]!.id} are < ${MATCH_CUT_GAP_SEC} s apart`});
  }
  for (const c of cuts) for (const o of evs) if (o !== c && o.presetResolved !== 'type.matchCut' && o.inFrame < c.outFrame && c.inFrame < o.outFrame) out.push({eventId: o.id, rule: 'matchcut-overlap', detail: `${o.presetResolved} overlaps match cut ${c.id}`});
  for (let i = 0; i < evs.length; i += 1) {
    for (let j = i + 1; j < evs.length; j += 1) {
      const a = evs[i]!, b = evs[j]!;
      if (a.presetResolved === 'type.matchCut' || b.presetResolved === 'type.matchCut') continue;
      const related = a.wordRange[0] <= b.wordRange[1] && b.wordRange[0] <= a.wordRange[1];
      const bothHero = a.lines.some(l => l.role === 'hero') && b.lines.some(l => l.role === 'hero');
      const overlap = a.inFrame < b.outFrame && b.inFrame < a.outFrame;
      if (bothHero && overlap && parentId(a.id) !== parentId(b.id)) out.push({eventId: b.id, rule: 'density-hero', detail: `${a.id} and ${b.id} are both hero and active together`});
      else if (!related && a.shotId === b.shotId && !overlap && a.lines.some(l => !isCaptionLike(l.role)) && b.lines.some(l => !isCaptionLike(l.role))) {
        const gap = Math.max(b.inFrame - a.outFrame, a.inFrame - b.outFrame);
        if (gap < MIN_GAP_FRAMES) out.push({eventId: b.id, rule: 'gap', detail: `gap ${gap} < ${MIN_GAP_FRAMES} frames to ${a.id}`});
      }
    }
  }
  // --- transcript fidelity (when the plan + words are known)
  if (ctx.plan && ctx.words) for (const v of transcriptFidelity(ctx.plan, ctx.words)) out.push({eventId: v.split(':')[0]!, rule: 'transcript-fidelity', detail: v});
  return out;
}

export {HERO_HOLD_FRAMES, hexLuminance, rangeFrames};
