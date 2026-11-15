/**
 * An OFFLINE, deterministic stand-in for the SFX provider (Runware / Mirelo). It answers `audioInference` tasks with locally SYNTHESIZED audio
 * shaped by the task's family (read from its prompt) and duration, so the whole event-SFX path (requests -> job -> ingest -> plan -> compile ->
 * render) can run with no network and no cost.
 *
 * THESE SOUNDS ARE NOT AI-GENERATED AND NOT PROVIDER OUTPUT. Every manifest entry made from them carries FIXTURE_SFX_USAGE (licence text says so),
 * the response cost is 0, and the transport is never `live`. It proves the integration, timing, safety and levels; it does not prove what the real
 * provider will sound like (that needs one approved, controlled generation run).
 */

import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';

import type {RunwareTransport} from './runware.ts';
import {encodeWav16} from './wav.ts';

export const FIXTURE_SFX_USAGE = Object.freeze({
  cleared: true,
  licence: 'SYNTHETIC LOCAL FIXTURE (FixtureSfxTransport): not AI-generated, not provider output',
  restriction: 'offline tests and local proof renders only; never shipped as a generated sound',
});

const SAMPLE_RATE = 48000;

/** Deterministic PRNG (mulberry32) seeded from the task. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Family = 'impact' | 'pop' | 'click' | 'whoosh' | 'sweep' | 'riser' | 'swell' | 'texture' | 'stinger';
const FAMILIES: readonly Family[] = ['impact', 'pop', 'click', 'whoosh', 'sweep', 'riser', 'swell', 'texture', 'stinger'];

/** The family the request builder put in the prompt (`<description>, <family> sound effect, ...`, runware.ts sfxPrompt). */
export function familyFromPrompt(prompt: string): Family {
  const match = /,\s*([a-z]+) sound effect/.exec(prompt);
  return match && (FAMILIES as readonly string[]).includes(match[1]!) ? (match[1] as Family) : 'impact';
}

/**
 * Validation Sprint 2: typing / interface variants a prompt can ask for (the provider follows the description; the fixture mimics that by keywords).
 * Each keeps its energy where a voice is weak (a low body under ~300 Hz and/or air above ~6 kHz) so a speech-band carve leaves it audible.
 */
export type FixtureVariant = 'key_tap' | 'ui_click' | 'rounded_click' | 'typing_texture' | 'low_air_impact';
export function variantFromPrompt(prompt: string): FixtureVariant | null {
  const p = prompt.toLowerCase();
  if (/typing (texture|flurry)|key-tap flurry|flurry of key/.test(p)) return 'typing_texture';
  if (/mechanical key|key tap|keyboard tap/.test(p)) return 'key_tap';
  if (/interface click|ui click|digital click/.test(p)) return 'ui_click';
  if (/rounded/.test(p)) return 'rounded_click';
  if (/low thump/.test(p) && /impact sound effect/.test(p)) return 'low_air_impact';
  return null;
}

function synthesizeVariant(variant: FixtureVariant, seed: number): Float64Array {
  const rand = prng(seed);
  const noise = () => rand() * 2 - 1;
  const SR = SAMPLE_RATE;
  const tap = (out: Float64Array, at: number, gain: number, bodyHz: number) => {
    // one key tap: a short low "thock" body + a 3-5 ms bright clack (high-passed noise)
    let prev = 0;
    for (let i = 0; i < Math.round(0.06 * SR) && at + i < out.length; i += 1) {
      const t = i / SR;
      const w = noise();
      const bright = w - prev; // first-difference high-pass: energy rises toward the top octaves
      prev = w;
      out[at + i]! += gain * (Math.sin(2 * Math.PI * bodyHz * t) * Math.exp(-t / 0.018) * 0.9 + bright * Math.exp(-t / 0.0035) * 0.45);
    }
  };
  const lengthSec = {key_tap: 0.08, ui_click: 0.07, rounded_click: 0.09, typing_texture: 0.16, low_air_impact: 0.15}[variant];
  const out = new Float64Array(Math.round(lengthSec * SR));
  if (variant === 'key_tap') tap(out, 0, 1, 220);
  else if (variant === 'typing_texture') {
    // three rapid taps, each softer and a little higher (a word typing itself, not a machine gun)
    tap(out, 0, 1, 210);
    tap(out, Math.round(0.045 * SR), 0.7, 240);
    tap(out, Math.round(0.095 * SR), 0.5, 230);
  } else if (variant === 'ui_click') {
    let prev = 0;
    for (let i = 0; i < out.length; i += 1) {
      const t = i / SR;
      const w = noise();
      const air = w - prev;
      prev = w;
      out[i] = Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t / 0.012) * 0.8 + air * Math.exp(-t / 0.002) * 0.5;
    }
  } else if (variant === 'rounded_click') {
    for (let i = 0; i < out.length; i += 1) {
      const t = i / SR;
      out[i] = Math.sin(2 * Math.PI * 260 * t) * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / 0.02);
    }
  } else {
    // low_air_impact: a sub thump with a short air burst on top, almost nothing in 1-4 kHz
    let prev = 0;
    for (let i = 0; i < out.length; i += 1) {
      const t = i / SR;
      const w = noise();
      const air = w - prev;
      prev = w;
      out[i] = Math.sin(2 * Math.PI * (95 - 40 * Math.min(1, t / 0.08)) * t) * Math.exp(-t / 0.05) + air * Math.exp(-t / 0.006) * 0.35;
    }
  }
  const fade = Math.round(0.002 * SR);
  for (let i = 0; i < fade && i < out.length; i += 1) out[out.length - 1 - i]! *= i / fade;
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 10 ** (-3 / 20) / peak : 0;
  for (let i = 0; i < out.length; i += 1) out[i]! *= g;
  return out;
}

/** Synthesized mono signal for one family, peak-normalised to -3 dBFS, onset at sample 0. Content length is the family's natural length. */
export function synthesizeSfx(family: Family, seed: number, variant: FixtureVariant | null = null): Float64Array {
  if (variant) return synthesizeVariant(variant, seed);
  const rand = prng(seed);
  const noise = () => rand() * 2 - 1;
  const len = (sec: number) => Math.round(sec * SAMPLE_RATE);
  const lengthSec = {impact: 0.32, pop: 0.12, click: 0.06, whoosh: 0.45, sweep: 0.6, riser: 1.2, swell: 1.6, texture: 2.0, stinger: 0.9}[family];
  const n = len(lengthSec);
  const out = new Float64Array(n);
  let lp = 0;
  let hp = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const u = t / lengthSec;
    const w = noise();
    let v = 0;
    if (family === 'impact' || family === 'stinger') {
      // a fast broadband transient (bright noise, 1-6 kHz region) over a short low-mid body: audible over a bed without masking the voice's fundamental
      lp += 0.35 * (w - lp);
      const bright = w - lp; // high-passed noise
      v = bright * Math.exp(-t / 0.018) * 0.9 + Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t / 0.07) * 0.5 + lp * Math.exp(-t / 0.05) * 0.4;
      if (family === 'stinger') v += Math.sin(2 * Math.PI * 660 * t) * Math.exp(-t / 0.35) * 0.25;
    } else if (family === 'pop' || family === 'click') {
      // a short, bright tick: a decaying 2.4 kHz partial plus a noise snap
      const f = family === 'pop' ? 1800 : 3200;
      v = Math.sin(2 * Math.PI * f * t * (1 - 0.3 * u)) * Math.exp(-t / (family === 'pop' ? 0.025 : 0.01)) + noise() * Math.exp(-t / 0.004) * 0.6;
    } else if (family === 'whoosh' || family === 'sweep') {
      // band-passed noise swelling in and out, its brightness moving with the swell
      const env = Math.sin(Math.PI * Math.min(1, u)) ** 2;
      const k = 0.05 + 0.4 * env;
      lp += k * (w - lp);
      hp += 0.02 * (lp - hp);
      v = (lp - hp) * env * 2.2;
    } else if (family === 'riser') {
      lp += (0.02 + 0.3 * u) * (w - lp);
      v = lp * u * u * 1.6 + Math.sin(2 * Math.PI * (200 + 600 * u) * t) * u * 0.15;
    } else {
      // swell / texture: soft filtered air
      lp += 0.03 * (w - lp);
      v = lp * Math.sin(Math.PI * u) * 3;
    }
    out[i] = v;
  }
  // gentle 2 ms fade at the end (no click), then normalise to -3 dBFS
  const fade = len(0.002);
  for (let i = 0; i < fade && i < n; i += 1) out[n - 1 - i]! *= i / fade;
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 10 ** (-3 / 20) / peak : 0;
  for (let i = 0; i < n; i += 1) out[i]! *= gain;
  return out;
}

export class FixtureSfxTransport implements RunwareTransport {
  readonly live = false;
  readonly label = 'fixture' as const;
  readonly posts: Array<Record<string, unknown>[]> = [];
  private readonly files = new Map<string, Buffer>();

  async post(tasks: readonly Record<string, unknown>[]): Promise<unknown> {
    this.posts.push(tasks.map(task => ({...task})));
    const task = tasks[0]!;
    if (task.taskType !== 'audioInference') return {errors: [{code: 'fixture_unsupported_task'}]};
    const uuid = String(task.taskUUID);
    const family = familyFromPrompt(String(task.positivePrompt ?? ''));
    const seed = createHash('sha256').update(uuid).digest().readUInt32BE(0);
    const mono = synthesizeSfx(family, seed, variantFromPrompt(String(task.positivePrompt ?? '')));
    const taskSec = typeof task.duration === 'number' && task.duration > 0 ? task.duration : 1;
    const frames = Math.max(mono.length, Math.round(taskSec * SAMPLE_RATE));
    // stereo (identical channels), padded with silence to the task duration, like a provider file; ingest trims it to the request
    const bytes = encodeWav16(SAMPLE_RATE, 2, frames, frame => (frame < mono.length ? mono[frame]! : 0));
    const url = `https://fixture-sfx.invalid/${uuid}.wav`;
    this.files.set(url, bytes);
    return {data: [{taskType: 'audioInference', taskUUID: uuid, audioURL: url, cost: 0}]};
  }

  async download(url: string, dest: string): Promise<void> {
    const bytes = this.files.get(url);
    if (!bytes) throw new Error(`fixture transport has no file for ${url}`);
    writeFileSync(dest, bytes);
  }
}
