/**
 * P8 Composer guardrails. Every composed spec is re-verified by the SAME independent verifier the Kinetic V2 engine uses (verifyRenderSpec: safe rect, face keep-out per word at
 * rest, contrast, density, gaps, match-cut rules) plus the readability floor, and by composer-specific rules for what that verifier does not know about:
 *   - takeover cards: exempt from the face keep-out ONLY because an opaque backdrop owns the frame for the whole window (checked), <= 2.7 s, spaced;
 *   - backed words (text on a chip / bar / card / highlighter): contrast is judged against their backing, not the plate;
 *   - scene elements: inside the frame, inside the timeline, counters inside the safe rect and off the face keep-out;
 *   - one text system at a time: no two composer events overlap in time.
 */
import {shortsSafeRect} from '../../broll/heroSweep.ts';
import {SubjectBandDepth} from '../depth.ts';
import {interpolateKeyframes, restingRange} from '../geometry.ts';
import {COMPOSER_BEHIND_MAX_AREA, verifyRenderSpec, type Violation} from '../guardrails.ts';
import {HERO_FLOOR_FRAC, SUPPORT_FLOOR_FRAC} from '../motion.ts';
import {boxAt, type ShotScene} from '../scene.ts';
import type {KineticShot, RenderSpec, SceneElement} from '../schema.ts';
import {isPartId, slantViolations} from './slant.ts';
import {TAKEOVER_SPACING_SEC} from './controller.ts';

export const TAKEOVER_MAX_SEC = 2.7;

const isTakeover = (e: RenderSpec['events'][number]) => e.notes.includes('takeover');
const backedTexts = (e: RenderSpec['events'][number]) => new Set(e.notes.filter(n => n.startsWith('backed:')).map(n => n.slice('backed:'.length)));

function amountAt(el: SceneElement, frame: number): number {
  const ks = el.keys;
  if (frame <= ks[0]!.frame) return ks[0]!.amount * ks[0]!.opacity;
  for (let i = 1; i < ks.length; i += 1) {
    if (frame <= ks[i]!.frame) { const a = ks[i - 1]!, b = ks[i]!; const u = (frame - a.frame) / Math.max(1, b.frame - a.frame); return (a.amount + (b.amount - a.amount) * u) * (a.opacity + (b.opacity - a.opacity) * u); }
  }
  const l = ks[ks.length - 1]!;
  return l.amount * l.opacity;
}

export function verifyComposed(spec: RenderSpec, scene: ShotScene, shots: KineticShot[]): Violation[] {
  const out: Violation[] = [];
  const scenes = {[scene.shotId]: scene};
  const regular = spec.events.filter(e => !isTakeover(e));
  for (const v of verifyRenderSpec({...spec, events: regular}, {scenes, depth: new SubjectBandDepth(), shots, behindMaxArea: COMPOSER_BEHIND_MAX_AREA})) {
    if (v.rule === 'contrast') {
      const ev = spec.events.find(e => e.id === v.eventId);
      const m = /^"(.*)" </.exec(v.detail);
      if (ev && m && backedTexts(ev).has(m[1]!)) continue;
    }
    out.push(v);
  }
  // readability floor (the production stage's rule, every exported line)
  for (const e of spec.events) {
    if (e.presetResolved === 'type.matchCut') continue;
    for (const l of e.lines) {
      const [f] = restingRange(e, l);
      const px = l.fontPx * interpolateKeyframes(e.keyframes, Math.min(Math.max(f, e.inFrame), e.outFrame)).scale;
      const floor = (l.role === 'hero' || l.role === 'punch' ? HERO_FLOOR_FRAC : SUPPORT_FLOOR_FRAC) * spec.height;
      if (px < 0.96 * floor - 0.5) { out.push({eventId: e.id, rule: 'readability-floor', detail: `"${l.text}" ${px.toFixed(0)}px < floor ${floor.toFixed(0)}px`}); break; }
    }
  }
  // takeover cards
  const sceneEls = spec.scene ?? [];
  const takeovers = spec.events.filter(isTakeover);
  for (const t of takeovers) {
    if ((t.outFrame - t.inFrame) / spec.fps > TAKEOVER_MAX_SEC + 1e-6) out.push({eventId: t.id, rule: 'takeover-length', detail: `${((t.outFrame - t.inFrame) / spec.fps).toFixed(2)} s > ${TAKEOVER_MAX_SEC} s`});
    const backdrop = sceneEls.find(el => el.kind === 'plate' && el.effect === 'backdrop' && el.inFrame <= t.inFrame && el.outFrame >= t.outFrame);
    if (!backdrop) { out.push({eventId: t.id, rule: 'takeover-backdrop', detail: 'no backdrop covers the card window'}); continue; }
    // every frame in which a takeover word is visible at rest must have the backdrop >= 0.85
    for (const l of t.lines) {
      const [r0, r1] = restingRange(t, l);
      for (let f = Math.max(t.inFrame, r0); f <= Math.min(t.outFrame - 1, r1); f += 2) {
        if (amountAt(backdrop, f) < 0.85) { out.push({eventId: t.id, rule: 'takeover-backdrop', detail: `backdrop ${amountAt(backdrop, f).toFixed(2)} at frame ${f} under "${l.text}"`}); break; }
      }
    }
  }
  // one card per BEAT: the extra rows of a slanted card (`.rN`) and its backed words (`.b`) are parts of the same card, not a second takeover
  const cards = takeovers.filter(t => !isPartId(t.id));
  for (let i = 0; i < cards.length; i += 1) for (let j = i + 1; j < cards.length; j += 1) if (Math.abs(cards[i]!.inFrame - cards[j]!.inFrame) < TAKEOVER_SPACING_SEC * spec.fps - 1) out.push({eventId: cards[j]!.id, rule: 'takeover-spacing', detail: `two takeover cards < ${TAKEOVER_SPACING_SEC} s apart`});
  // one text system at a time
  const evs = [...spec.events].sort((a, b) => a.inFrame - b.inFrame);
  for (let i = 1; i < evs.length; i += 1) {
    const a = evs[i - 1]!, b = evs[i]!;
    if (b.inFrame < a.outFrame && a.id.split('-')[0] !== b.id.split('-')[0]) out.push({eventId: b.id, rule: 'composer-overlap', detail: `${a.id} and ${b.id} overlap`});
  }
  // no two words ever print over each other: within a beat (its plain and backed events), any two words visible in the same frame must not overlap at rest
  {
    type W = {ev: string; text: string; from: number; to: number; dx: number; dy: number; w: number; h: number; e: RenderSpec['events'][number]};
    const visible = (e: RenderSpec['events'][number], l: RenderSpec['events'][number]['lines'][number]): [number, number] => {
      const ks = l.wordKeyframes;
      if (!ks.length) return [e.inFrame + l.enterFrame, e.outFrame];
      const last = ks[ks.length - 1]!;
      const end = last.opacity > 0.01 ? e.outFrame : [...ks].reverse().find(k => k.opacity > 0.01)?.frame ?? last.frame;
      return [Math.max(e.inFrame, ks[0]!.frame), Math.min(e.outFrame, end)];
    };
    const byBeat = new Map<string, W[]>();
    for (const e of spec.events) {
      if (e.presetResolved === 'type.matchCut') continue;
      const beat = e.id.split('-')[0]!;
      const list = byBeat.get(beat) ?? [];
      for (const l of e.lines) { const [from, to] = visible(e, l); list.push({ev: e.id, text: l.text, from, to, dx: l.dx, dy: l.dy, w: l.w, h: l.h, e}); }
      byBeat.set(beat, list);
    }
    const absRect = (x: W, f: number) => {
      const k = interpolateKeyframes(x.e.keyframes, f);
      const left = k.x - x.e.block.w / 2 + x.dx, top = k.y - x.e.block.h / 2 + x.dy;
      const sh = 0.12 * x.h; // line box -> ink box
      return {left: left + 0.02 * x.w, right: left + x.w - 0.02 * x.w, top: top + sh, bottom: top + x.h - sh};
    };
    for (const ws of byBeat.values()) {
      let hit = false;
      for (let i = 0; i < ws.length && !hit; i += 1) for (let j = i + 1; j < ws.length && !hit; j += 1) {
        const a = ws[i]!, b = ws[j]!;
        const f0 = Math.max(a.from, b.from), f1 = Math.min(a.to, b.to);
        if (f1 <= f0) continue;
        const f = Math.round((f0 + f1) / 2);
        const ra = absRect(a, f), rb = absRect(b, f);
        const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ix > 2 && iy > 2) { out.push({eventId: b.ev, rule: 'word-collision', detail: `"${a.text}" and "${b.text}" overlap on screen at frame ${f}`}); hit = true; }
      }
    }
  }
  const safe = shortsSafeRect(spec.width, spec.height);
  // text on a backing never carries an outline / glow (the backing is the contrast)
  for (const e of spec.events) {
    if (!e.notes.some(n => n.startsWith('backed:'))) continue;
    if (e.shadow.strokePx > 0 || e.shadow.glowPx > 0 || e.lines.some(l => l.glow)) out.push({eventId: e.id, rule: 'backed-stroke', detail: 'text on a chip / highlighter / card carries an outline or glow'});
  }
  // angled treatments: the ROTATED block (at its peak push) stays inside the safe rect and, in front, off the face keep-out (the base verifier measures the unrotated block)
  for (const e of spec.events) {
    const deg = e.rotateDeg ?? 0;
    if (!deg || isTakeover(e)) continue;
    const a = (deg * Math.PI) / 180;
    for (let f = e.inFrame; f <= e.outFrame; f += 4) {
      const k = interpolateKeyframes(e.keyframes, f);
      const hw = (e.block.w / 2) * k.scale, hh = (e.block.h / 2) * k.scale;
      const ex = Math.abs(hw * Math.cos(a)) + Math.abs(hh * Math.sin(a)), ey = Math.abs(hw * Math.sin(a)) + Math.abs(hh * Math.cos(a));
      const r = {left: k.x - ex, right: k.x + ex, top: k.y - ey, bottom: k.y + ey};
      if (r.left < safe.left - 2 || r.right > safe.right + 2 || r.top < safe.top - 2 || r.bottom > safe.bottom + 2) { out.push({eventId: e.id, rule: 'rotated-safe-rect', detail: `rotated block leaves the safe rect at frame ${f}`}); break; }
      if (e.layering === 'front') {
        const b = boxAt(scene, f);
        const face = {left: b.x * spec.width, right: (b.x + b.w) * spec.width, top: b.y * spec.height, bottom: (b.y + 0.42 * b.h) * spec.height};
        const ix = Math.max(0, Math.min(r.right, face.right) - Math.max(r.left, face.left)), iy = Math.max(0, Math.min(r.bottom, face.bottom) - Math.max(r.top, face.top));
        if (ix * iy > 0.02 * (r.right - r.left) * (r.bottom - r.top)) { out.push({eventId: e.id, rule: 'rotated-face-keepout', detail: `rotated block covers the face keep-out at frame ${f}`}); break; }
      }
    }
  }
  // scene elements
  for (const el of sceneEls) {
    if (el.inFrame < 0 || el.outFrame > spec.durationInFrames || el.outFrame <= el.inFrame) out.push({eventId: el.id, rule: 'scene-window', detail: `[${el.inFrame},${el.outFrame}) outside the timeline`});
    if (el.kind === 'counter') {
      const r = {left: el.cx - el.w / 2, right: el.cx + el.w / 2, top: el.cy - el.h / 2, bottom: el.cy + el.h / 2};
      if (r.left < safe.left - 1 || r.right > safe.right + 1 || r.top < safe.top - 1 || r.bottom > safe.bottom + 1) out.push({eventId: el.id, rule: 'counter-safe-rect', detail: 'counter leaves the safe rect'});
      const covered = takeovers.some(t => t.inFrame <= el.inFrame && t.outFrame >= el.outFrame);
      for (let f = el.countStart; f <= el.outFrame && !covered; f += 3) {
        const b = boxAt(scene, f);
        const face = {left: b.x * spec.width, right: (b.x + b.w) * spec.width, top: b.y * spec.height, bottom: (b.y + 0.42 * b.h) * spec.height};
        const ix = Math.max(0, Math.min(r.right, face.right) - Math.max(r.left, face.left)), iy = Math.max(0, Math.min(r.bottom, face.bottom) - Math.max(r.top, face.top));
        if (ix * iy > 0.02 * (r.right - r.left) * (r.bottom - r.top)) { out.push({eventId: el.id, rule: 'counter-face', detail: `counter covers the face keep-out at frame ${f}`}); break; }
      }
    }
    if (el.kind === 'shape' && el.layer === 'over') {
      const covered = takeovers.some(t => t.inFrame <= el.inFrame && t.outFrame >= el.outFrame);
      const b = boxAt(scene, Math.round((el.inFrame + el.outFrame) / 2));
      const face = {left: b.x * spec.width, right: (b.x + b.w) * spec.width, top: b.y * spec.height, bottom: (b.y + 0.42 * b.h) * spec.height};
      const r = {left: Math.min(el.x, el.x + el.w), right: Math.max(el.x, el.x + el.w), top: Math.min(el.y, el.y + el.h), bottom: Math.max(el.y, el.y + el.h)};
      const ix = Math.max(0, Math.min(r.right, face.right) - Math.max(r.left, face.left)), iy = Math.max(0, Math.min(r.bottom, face.bottom) - Math.max(r.top, face.top));
      if (!covered && ix > 0 && iy > 0) out.push({eventId: el.id, rule: 'shape-face', detail: `${el.shape} over the face keep-out`});
    }
  }
  // one slant per frame, each slanted row about its own centre
  out.push(...slantViolations(spec.events));
  return out;
}
