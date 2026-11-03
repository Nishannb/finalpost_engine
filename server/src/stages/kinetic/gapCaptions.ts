/**
 * Gap captions: leftover spoken words shown ONLY on frames where no kinetic event is active.
 * Leftover content is LARGE type filling the open area of the frame (1-2 letter words are skipped).
 * IN-11 caption tick in, OUT-6 cut out. Words come from the transcript only.
 */
import {shortsSafeRect} from '../broll/heroSweep.ts';
import {CONTRAST_MIN, contrastStrokeColor, lumToHex, worstContrast} from './guardrails.ts';
import {fpsScale} from './motion.ts';
import {entryPose, IDENT} from './motionLibrary.ts';
import {FONT_METRICS, textWidthEm} from './measure.ts';
import {boxAt, FACE_FRACTION, type ShotScene} from './scene.ts';
import type {GapCaption, KineticShot, KineticWord, RenderEvent} from './schema.ts';
import {normToken} from './transcript.ts';

/** Large leftover type (~11% of the frame): a textual edit, not a tiny chest caption. */
export const CAPTION_PX_FRAC = 0.11;
export const CAPTION_PX_MIN = 0.07;
export const CAPTION_PX_MAX = 0.14;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildGapCaptions(a: {words: KineticWord[]; events: RenderEvent[]; shots: KineticShot[]; scenes: Record<string, ShotScene>; width: number; height: number; fps: number}): GapCaption[] {
  const {words, events, width, height, fps} = a;
  const safe = shortsSafeRect(width, height);
  const owned = new Set<number>();
  for (const e of events) for (let i = e.wordRange[0]; i <= e.wordRange[1]; i += 1) owned.add(i);
  const holdFrames = fpsScale(6, fps);
  const tickN = Math.max(2, Math.min(3, fpsScale(3, fps)));
  const out: GapCaption[] = [];
  for (const w of words) {
    if (owned.has(w.idx)) continue;
    const text = w.text.replace(/[.,;:!?]+$/, '').trim();
    if (!text) continue;
    if (normToken(text).length <= 2) continue;
    const start = w.startFrame;
    // never while a kinetic lockup is on screen
    if (events.some(e => start >= e.inFrame && start < e.outFrame)) continue;
    const next = words[w.idx + 1];
    let end = next && next.startFrame - w.endFrame <= holdFrames ? next.startFrame : w.endFrame + holdFrames;
    for (const e of events) if (e.inFrame > start && e.inFrame < end) end = e.inFrame;
    if (end - start < 2) continue;
    const shot = a.shots.find(s => start >= s.startFrame && start < s.endFrame) ?? a.shots[a.shots.length - 1];
    const scene = shot ? a.scenes[shot.id] : undefined;
    if (shot) end = Math.min(end, shot.endFrame);
    if (end - start < 2) continue;
    const wEm = textWidthEm(text, 'poppins', 800, false, 0);
    const sb = scene ? boxAt(scene, start) : {x: 0.3, y: 0.3, w: 0.4, h: 0.62};
    const faceTop = sb.y * height;
    const faceBottom = (sb.y + FACE_FRACTION * sb.h) * height;
    const aboveH = Math.max(0, faceTop - safe.top);
    const belowH = Math.max(0, safe.bottom - faceBottom);
    const bandH = Math.max(aboveH, belowH);
    const widthPx = Math.min(CAPTION_PX_MAX * height, (0.88 * safe.w) / Math.max(0.4, wEm));
    const bandPx = Math.max(CAPTION_PX_MIN * height, Math.min(CAPTION_PX_MAX * height, bandH * 0.72));
    const px = round2(Math.min(widthPx, bandPx, CAPTION_PX_FRAC * height * 1.15));
    const bw = round2(Math.min(safe.w, wEm * px)), bh = round2(px * FONT_METRICS.poppins.lineEm * 1.1);
    const placeAbove = aboveH >= belowH && faceTop - bh / 2 - 0.02 * height >= safe.top;
    const lo = placeAbove ? safe.top + bh / 2 : Math.min(faceBottom + 0.02 * height + bh / 2, safe.bottom - bh / 2);
    const hi = placeAbove ? Math.max(lo, faceTop - 0.02 * height - bh / 2) : safe.bottom - bh / 2;
    const prefer = placeAbove ? (safe.top + faceTop) / 2 : Math.max(0.58 * height, lo);
    const cy = round2(Math.min(hi, Math.max(lo, prefer)));
    const bg = lumToHex(scene?.luminance ?? 0.45);
    const low = worstContrast(['#FFFFFF'], bg) < CONTRAST_MIN;
    const keyframes: GapCaption['keyframes'] = [];
    for (let i = 0; i < tickN && start + i < end; i += 1) {
      const p = entryPose('IN-11', i, {fps, bw, k: width / 1080, t: 1, width, dir: 1, wordW: bw});
      keyframes.push({frame: start + i, scale: Math.round(p.scale * 10000) / 10000, opacity: Math.round(p.opacity * 10000) / 10000});
    }
    keyframes.push({frame: Math.min(end - 1, start + tickN), scale: 1, opacity: IDENT(0).opacity}, {frame: Math.max(start + tickN, end - 1), scale: 1, opacity: 1});
    const dedup = keyframes.filter((k, i) => i === 0 || k.frame > keyframes[i - 1]!.frame);
    out.push({
      wordIdx: w.idx, text, inFrame: start, outFrame: end, cx: round2(width / 2), cy, w: bw, h: bh, fontPx: px, font: 'poppins', weight: 800, color: '#FFFFFF',
      strokeColor: low ? contrastStrokeColor(scene?.luminance ?? 0.45) : null, anim: 'IN-11', exit: 'OUT-6', keyframes: dedup,
    });
  }
  return out;
}
