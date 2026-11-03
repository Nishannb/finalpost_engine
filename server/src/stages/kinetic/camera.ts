/**
 * S5: CameraProvider. Default StaticCamera. A measured similarity (per-frame scale + pan, e.g. from tracks or the coarse bbox estimator) is smoothed with a short moving average
 * that never crosses a cut. CoTracker / homography is an optional adapter (CAMERA_TRACKER=1), a typed stub here, never imported otherwise.
 */
import type {KineticShot} from './schema.ts';
import type {ShotScene} from './scene.ts';
import {boxAt} from './scene.ts';

export type CameraSample = {frame: number; /** ~1 */ scale: number; /** px */ tx: number; ty: number};
export type CameraTrack = {shotId: string; source: string; samples: CameraSample[]};

export interface CameraProvider {
  readonly id: string;
  readonly version: string;
  track(shot: KineticShot, scene: ShotScene | undefined, size: {width: number; height: number}): CameraTrack;
}

export const STATIC_SAMPLE = (frame: number): CameraSample => ({frame, scale: 1, tx: 0, ty: 0});

export class StaticCamera implements CameraProvider {
  readonly id = 'static';
  readonly version = '1';
  track(shot: KineticShot): CameraTrack {
    return {shotId: shot.id, source: 'static', samples: [STATIC_SAMPLE(shot.startFrame), STATIC_SAMPLE(Math.max(shot.startFrame, shot.endFrame - 1))]};
  }
}

/** Moving average inside ONE shot (callers pass one track per shot, so a cut is never smoothed across). */
export function smoothTrack(samples: CameraSample[], window = 5): CameraSample[] {
  const half = Math.floor(window / 2);
  return samples.map((s, i) => {
    const lo = Math.max(0, i - half), hi = Math.min(samples.length - 1, i + half);
    let sc = 0, tx = 0, ty = 0;
    for (let k = lo; k <= hi; k += 1) { sc += samples[k]!.scale; tx += samples[k]!.tx; ty += samples[k]!.ty; }
    const n = hi - lo + 1;
    return {frame: s.frame, scale: sc / n, tx: tx / n, ty: ty / n};
  });
}

/** Camera from measured similarities (e.g. a tracker's output) for a shot; smoothed. */
export class MeasuredCamera implements CameraProvider {
  readonly id = 'similarity';
  readonly version = '1';
  private readonly measured: Record<string, CameraSample[]>;
  private readonly window: number;
  constructor(measured: Record<string, CameraSample[]>, window = 5) {
    this.measured = measured;
    this.window = window;
  }
  track(shot: KineticShot): CameraTrack {
    const m = this.measured[shot.id];
    if (!m || m.length < 2) return new StaticCamera().track(shot);
    return {shotId: shot.id, source: 'similarity', samples: smoothTrack([...m].sort((a, b) => a.frame - b.frame), this.window)};
  }
}

/**
 * Coarse estimate from matte bbox motion: ONLY a real zoom of the subject box (|scale change| >= 8% over the shot) is read as camera motion (dolly / punch); the pan is the box-centre drift damped by 0.5.
 * Opt-in (CAMERA_PROVIDER=bbox) because a walking subject also moves its own box; the default stays static so text holds world position.
 */
export class BboxMotionCamera implements CameraProvider {
  readonly id = 'bbox-motion';
  readonly version = '1';
  track(shot: KineticShot, scene: ShotScene | undefined, size: {width: number; height: number}): CameraTrack {
    const t = scene?.boxTrack;
    if (!scene || scene.noMatte || !t || t.length < 3) return new StaticCamera().track(shot);
    const first = boxAt(scene, shot.startFrame);
    const raw: CameraSample[] = t
      .filter(s => s.frame >= shot.startFrame && s.frame < shot.endFrame)
      .map(s => ({frame: s.frame, scale: first.h > 0 ? 1 + ((s.box.h / first.h) - 1) : 1, tx: (s.box.x + s.box.w / 2 - (first.x + first.w / 2)) * size.width * 0.5, ty: (s.box.y + s.box.h / 2 - (first.y + first.h / 2)) * size.height * 0.5}));
    const dz = Math.max(...raw.map(r => Math.abs(r.scale - 1)), 0);
    if (raw.length < 3 || dz < 0.08) return new StaticCamera().track(shot);
    return {shotId: shot.id, source: 'bbox-motion', samples: smoothTrack(raw)};
  }
}

export function cameraSampleAt(track: CameraTrack | undefined, frame: number): CameraSample {
  const s = track?.samples;
  if (!s || s.length === 0) return STATIC_SAMPLE(frame);
  if (frame <= s[0]!.frame) return {...s[0]!, frame};
  if (frame >= s[s.length - 1]!.frame) return {...s[s.length - 1]!, frame};
  for (let i = 1; i < s.length; i += 1) {
    if (frame <= s[i]!.frame) {
      const a = s[i - 1]!, b = s[i]!;
      const u = (frame - a.frame) / Math.max(1, b.frame - a.frame);
      return {frame, scale: a.scale + (b.scale - a.scale) * u, tx: a.tx + (b.tx - a.tx) * u, ty: a.ty + (b.ty - a.ty) * u};
    }
  }
  return STATIC_SAMPLE(frame);
}

/** Peak |second difference| of the pan (px / frame^2) plus the zoom expressed in px of the frame height; the jitter metric. */
export function cameraJitter(track: CameraTrack | undefined, height: number): number {
  const s = track?.samples ?? [];
  let peak = 0;
  for (let i = 1; i + 1 < s.length; i += 1) {
    const a = s[i - 1]!, b = s[i]!, c = s[i + 1]!;
    const dt = Math.max(1, b.frame - a.frame);
    const acc = (Math.abs(c.tx - 2 * b.tx + a.tx) + Math.abs(c.ty - 2 * b.ty + a.ty) + Math.abs(c.scale - 2 * b.scale + a.scale) * height) / (dt * dt);
    peak = Math.max(peak, acc);
  }
  return peak;
}

/** Optional adapter (CAMERA_TRACKER=1): typed stub, loaded only on the flag. */
export async function loadCameraTracker(): Promise<CameraProvider> {
  if (process.env.CAMERA_TRACKER !== '1') throw new Error('camera tracker adapter disabled (set CAMERA_TRACKER=1)');
  throw new Error('CoTracker / homography adapter is not installed in this repo; use static / measured similarity');
}
