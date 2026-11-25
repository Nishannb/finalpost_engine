/**
 * P0 Variety instruments. Pure measurements of a RenderSpec (any engine: the composer, the Kinetic V2 playbook, a legacy plan), so the old and the new engine are scored the
 * same way. Logged with every composed edit (like the audio policy, a variety claim must come with a number).
 *
 *   designedShare      share of speech time covered by a designed treatment (anything that is not a plain caption: composer captionLane, V2 gap captions / running-only lines)
 *   captionLikeShare   share of speech time where the only text is caption-like (a running lane or a single small word)
 *   distinct           distinct treatments used; per30s = distinct treatments per 30 s window (mean)
 *   maxShare           the most used treatment's share of designed events
 *   repeats            back-to-back repeats of the same treatment
 *   zoneEntropy        0..1 spread of block centres over a 3 x 3 grid (0 = always the same spot)
 *   scaleContrast      largest / smallest resting font size on screen across the edit
 *   motionDistinct     distinct entry animations of hero / punch words
 *   torsoOverlap       share of text frames whose words sit over the speaker's torso / hands band (below the face, central 60% of the body)
 *   sceneElements      count of shapes / counters / plate treatments
 *   varietyScore       0..100 summary
 */
import type {RenderSpec} from '../schema.ts';
import {boxAt, type ShotScene} from '../scene.ts';
import {wordAabbAt, restingRange} from '../geometry.ts';
import {ANGLE_OK, beatOfId, isPartId} from './slant.ts';

export type VarietyMetrics = {
  events: number;
  designedShare: number;
  captionLikeShare: number;
  distinct: number;
  per30s: number;
  maxShare: number;
  repeats: number;
  zoneEntropy: number;
  scaleContrast: number;
  motionDistinct: number;
  torsoOverlap: number;
  sceneElements: number;
  histogram: Record<string, number>;
  varietyScore: number;
};

const CAPTIONY = new Set(['captionLane', 'running', 'gapCaption']);

/** P3 motion stats of the DESIGNED edit (caption lane and Match Cut excluded) */
export type MotionStats = {designed: number; enterDistinct: number; exitDistinct: number; dirFlips: number; exitAcross: number; angled: number; behind: number; slantable: number};
export function motionStats(spec: RenderSpec): MotionStats {
  const evs = spec.events.filter(e => e.composition && e.composition !== 'captionLane' && !isPartId(e.id)).sort((a, b) => a.inFrame - b.inFrame);
  const enters = new Set<string>(), exits = new Set<string>();
  for (const e of spec.events) if (e.composition && e.composition !== 'captionLane') { for (const l of e.lines) enters.add(l.anim); if (!isPartId(e.id)) exits.add(e.exit); }
  const dirOf = (e: RenderSpec['events'][number], k: string) => Number(e.notes.find(n => n.startsWith(`${k}:`))?.slice(k.length + 1) ?? 0);
  let flips = 0, across = 0, prev = 0;
  for (const e of evs) { const d = dirOf(e, 'dir'); if (prev && d && d !== prev) flips += 1; if (d) prev = d; if (d && dirOf(e, 'exitDir') && dirOf(e, 'exitDir') !== d) across += 1; }
  return {designed: evs.length, enterDistinct: enters.size, exitDistinct: exits.size, dirFlips: flips, exitAcross: across, angled: evs.filter(e => Math.abs(e.keyframes[0]?.rotateY ?? 0) >= 12).length, behind: evs.filter(e => e.layering === 'behind').length, slantable: evs.filter(e => ANGLE_OK.has(e.composition ?? '')).length};
}
/** the motion gate: an edit with >= 6 designed treatments needs >= 5 distinct entries, >= 3 distinct exits, >= 2 side flips and angled type (>= 2; a calm edit >= 1; never more than the
 * treatments that CAN slant: an edit of chips / bars / cards is flat by the one-slant-per-frame rule) */
export function motionGate(m: MotionStats, tone: string): boolean {
  if (m.designed < 6) return true;
  return m.enterDistinct >= 5 && m.exitDistinct >= 3 && m.dirFlips >= 2 && m.angled >= Math.min(tone === 'calm' ? 1 : 2, m.slantable ?? 2);
}

/** the treatment an event represents (composer: its composition; V2: preset + zone + whether it is caption-only) */
export function treatmentOf(e: RenderSpec['events'][number]): string {
  if (e.composition) return e.composition;
  if (e.presetResolved === 'type.matchCut') return 'matchCut';
  if (e.lines.every(l => l.role === 'running' || l.role === 'caption')) return 'running';
  return `${e.presetResolved}${e.zone ? `:${e.zone}` : ''}`;
}

export function measureVariety(spec: RenderSpec, scene?: ShotScene, speech?: {startFrame: number; endFrame: number}): VarietyMetrics {
  const fps = spec.fps;
  const s0 = speech?.startFrame ?? 0, s1 = speech?.endFrame ?? spec.durationInFrames;
  const speechFrames = Math.max(1, s1 - s0);
  const designedFrames = new Uint8Array(spec.durationInFrames + 1);
  const captionFrames = new Uint8Array(spec.durationInFrames + 1);
  const treatments: Array<{t: string; inFrame: number}> = [];
  const beatLines = new Map<string, number>();
  for (const e of spec.events) if (e.composition) beatLines.set(beatOfId(e.id), (beatLines.get(beatOfId(e.id)) ?? 0) + e.lines.length);
  for (const e of spec.events) {
    const t = treatmentOf(e);
    // a slanted treatment split into rows (`.rN`) is still one treatment: count its beat's lines
    const small = (beatLines.get(beatOfId(e.id)) ?? e.lines.length) === 1 && e.lines[0]!.fontPx < 100;
    const captiony = CAPTIONY.has(t) || small;
    for (let f = Math.max(0, e.inFrame); f < Math.min(spec.durationInFrames, e.outFrame); f += 1) (captiony ? captionFrames : designedFrames)[f] = 1;
    // a backed word's `.b` event is part of its beat's treatment, not a second treatment
    if (!captiony && !isPartId(e.id)) treatments.push({t, inFrame: e.inFrame});
  }
  for (const c of spec.captions ?? []) for (let f = Math.max(0, c.inFrame); f < Math.min(spec.durationInFrames, c.outFrame); f += 1) captionFrames[f] = 1;
  for (const el of spec.scene ?? []) if (el.kind === 'counter') for (let f = el.inFrame; f < Math.min(spec.durationInFrames, el.outFrame); f += 1) designedFrames[f] = 1;
  let designed = 0, captionOnly = 0;
  for (let f = s0; f < s1; f += 1) { if (designedFrames[f]) designed += 1; else if (captionFrames[f]) captionOnly += 1; }
  treatments.sort((a, b) => a.inFrame - b.inFrame);
  const histogram: Record<string, number> = {};
  for (const x of treatments) histogram[x.t] = (histogram[x.t] ?? 0) + 1;
  const distinct = Object.keys(histogram).length;
  const maxShare = treatments.length ? Math.max(...Object.values(histogram)) / treatments.length : 0;
  let repeats = 0;
  for (let i = 1; i < treatments.length; i += 1) if (treatments[i]!.t === treatments[i - 1]!.t && treatments[i]!.t !== 'listItem') repeats += 1;
  // distinct per 30 s window
  const win = 30 * fps;
  const windows: number[] = [];
  for (let w = 0; w < spec.durationInFrames; w += win) {
    const set = new Set(treatments.filter(x => x.inFrame >= w && x.inFrame < w + win).map(x => x.t));
    if (spec.durationInFrames - w >= 10 * fps) windows.push(set.size);
  }
  const per30s = windows.length ? windows.reduce((s, x) => s + x, 0) / windows.length : distinct;
  // zone entropy over a 3x3 grid of resting block centres
  const grid = new Array(9).fill(0);
  let samples = 0;
  for (const e of spec.events) {
    if (e.presetResolved === 'type.matchCut') continue;
    const k = e.keyframes[0]!;
    const gx = Math.min(2, Math.max(0, Math.floor((k.x / spec.width) * 3)));
    const gy = Math.min(2, Math.max(0, Math.floor((k.y / spec.height) * 3)));
    grid[gy * 3 + gx] += 1; samples += 1;
  }
  let ent = 0;
  for (const g of grid) if (g > 0) { const p = g / samples; ent -= p * Math.log(p); }
  const zoneEntropy = samples > 1 ? ent / Math.log(9) : 0;
  // scale contrast + motion
  const sizes: number[] = [];
  const motions = new Set<string>();
  for (const e of spec.events) for (const l of e.lines) { sizes.push(l.fontPx); if (l.role === 'hero' || l.role === 'punch') motions.add(l.anim); }
  for (const el of spec.scene ?? []) if (el.kind === 'counter') sizes.push(el.fontPx);
  const scaleContrast = sizes.length ? Math.max(...sizes) / Math.max(1, Math.min(...sizes)) : 1;
  // torso / hands band
  let textFrames = 0, torso = 0;
  if (scene) {
    for (const e of spec.events) {
      if (e.notes.includes('takeover') || e.presetResolved === 'type.matchCut') continue;
      for (let f = e.inFrame; f < e.outFrame; f += 3) {
        const b = boxAt(scene, f);
        const band = {left: (b.x + 0.2 * b.w) * spec.width, right: (b.x + 0.8 * b.w) * spec.width, top: (b.y + 0.42 * b.h) * spec.height, bottom: (b.y + 0.72 * b.h) * spec.height};
        let any = false, hit = false;
        for (const l of e.lines) {
          const [r0, r1] = restingRange(e, l);
          if (f < r0 || f > r1) continue;
          any = true;
          const r = wordAabbAt(e, l, f);
          const ix = Math.max(0, Math.min(r.right, band.right) - Math.max(r.left, band.left)), iy = Math.max(0, Math.min(r.bottom, band.bottom) - Math.max(r.top, band.top));
          if (ix * iy > 0.3 * (r.right - r.left) * (r.bottom - r.top) && l.fontPx < 110) hit = true;
        }
        if (any) { textFrames += 1; if (hit) torso += 1; }
      }
    }
  }
  const sceneElements = spec.scene?.length ?? 0;
  const designedShare = designed / speechFrames;
  const varietyScore = Math.round(
    100 * (0.22 * Math.min(1, designedShare / 0.7) + 0.22 * Math.min(1, per30s / 7) + 0.12 * (1 - Math.min(1, Math.max(0, maxShare - 0.2) / 0.6)) + 0.1 * (1 - Math.min(1, repeats / 4)) +
      0.12 * zoneEntropy + 0.1 * Math.min(1, (scaleContrast - 1) / 3) + 0.06 * Math.min(1, motions.size / 7) + 0.06 * Math.min(1, sceneElements / 10)),
  );
  return {
    events: spec.events.length, designedShare: r3(designedShare), captionLikeShare: r3(captionOnly / speechFrames), distinct, per30s: r3(per30s), maxShare: r3(maxShare), repeats, zoneEntropy: r3(zoneEntropy),
    scaleContrast: r3(scaleContrast), motionDistinct: motions.size, torsoOverlap: r3(textFrames ? torso / textFrames : 0), sceneElements, histogram, varietyScore,
  };
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** 0..1 how alike two edits are (1 = the same mix of treatments, motions and zones) */
export function sameness(a: RenderSpec, b: RenderSpec): number {
  const vec = (s: RenderSpec) => {
    const m = new Map<string, number>();
    for (const e of s.events) {
      if (CAPTIONY.has(treatmentOf(e)) || isPartId(e.id)) continue; // compare the designed edit, not the caption track every video has
      m.set(`t:${treatmentOf(e)}`, (m.get(`t:${treatmentOf(e)}`) ?? 0) + 1);
      for (const l of e.lines) if (l.role === 'hero' || l.role === 'punch') m.set(`m:${l.anim}`, (m.get(`m:${l.anim}`) ?? 0) + 1);
      const k = e.keyframes[0]!;
      const cell = `z:${Math.floor((k.x / s.width) * 3)},${Math.floor((k.y / s.height) * 3)}`;
      m.set(cell, (m.get(cell) ?? 0) + 1);
    }
    for (const el of s.scene ?? []) m.set(`s:${el.kind}:${el.kind === 'shape' ? el.shape : el.kind === 'plate' ? el.effect : ''}`, (m.get(`s:${el.kind}:${el.kind === 'shape' ? el.shape : el.kind === 'plate' ? el.effect : ''}`) ?? 0) + 1);
    return m;
  };
  const va = vec(a), vb = vec(b);
  let dot = 0, na = 0, nb = 0;
  for (const [k, x] of va) { dot += x * (vb.get(k) ?? 0); na += x * x; }
  for (const x of vb.values()) nb += x * x;
  return na && nb ? r3(dot / Math.sqrt(na * nb)) : 0;
}
