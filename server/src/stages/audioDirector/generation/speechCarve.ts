/**
 * Speech-band carving for under-speech accent SFX (Visual Event Sound Design sprint). Pure TypeScript, deterministic, no ffmpeg.
 *
 * A short accent that sits at a word onset must not compete with the consonant cues that carry intelligibility (roughly 1-4 kHz). The sound is
 * cut by SPEECH_CARVE.gainDb with one RBJ peaking biquad centred on SPEECH_CARVE.centerHz (Q SPEECH_CARVE.q: about 0.8-5 kHz at -6 dB), run
 * forward and backward (zero phase, so the transient does not move; the two passes double the cut: about -36 dB at 2 kHz, -24..-30 dB measured
 * over 1-4 kHz on real sounds), then re-encoded as 16-bit PCM. Its low thump and air stay, which is what
 * makes it audible under a voice without masking the word. The measured band reduction is returned so the manifest records what was done.
 */
import {decodeWav, encodeWav16} from './wav.ts';

export const SPEECH_CARVE = Object.freeze({centerHz: 2000, q: 0.6, gainDb: -18});
/** Validation Sprint 2 comparison profile: wider and deeper (about 0.6-6 kHz at -6 dB). Evaluated, not the default. */
export const SPEECH_CARVE_WIDE = Object.freeze({centerHz: 2000, q: 0.45, gainDb: -24});
export type CarveProfile = {centerHz: number; q: number; gainDb: number};

function peakingCoefficients(sampleRate: number, f0: number, q: number, gainDb: number) {
  const a = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha / a;
  return {b0: (1 + alpha * a) / a0, b1: (-2 * cos) / a0, b2: (1 - alpha * a) / a0, a1: (-2 * cos) / a0, a2: (1 - alpha / a) / a0};
}

function biquad(x: Float64Array, c: ReturnType<typeof peakingCoefficients>): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = c.b0 * x[i]! + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x[i]!; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** Band energy (dB) of a mono signal in [lo, hi) Hz by a direct DFT over Hann-windowed 2048-sample blocks (small files only). */
export function bandEnergyDb(x: Float64Array, sampleRate: number, lo: number, hi: number): number {
  const n = 2048;
  let total = 0;
  for (let start = 0; start + n <= Math.max(n, x.length); start += n) {
    for (let k = Math.ceil((lo * n) / sampleRate); k < Math.min(n / 2, (hi * n) / sampleRate); k += 4) {
      let re = 0, im = 0;
      for (let i = 0; i < n; i += 1) {
        const v = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
        re += v * Math.cos((2 * Math.PI * k * i) / n);
        im -= v * Math.sin((2 * Math.PI * k * i) / n);
      }
      total += re * re + im * im;
    }
  }
  return 10 * Math.log10(total + 1e-30);
}

/** Carves the speech band of a WAV file (any channel count). Returns the new bytes and the measured 1-4 kHz reduction in dB (negative). */
export function carveSpeechBand(bytes: Buffer, profile: CarveProfile = SPEECH_CARVE): {bytes: Buffer; speechBandChangeDb: number} {
  const wav = decodeWav(bytes);
  const c = peakingCoefficients(wav.sampleRate, profile.centerHz, profile.q, profile.gainDb);
  const channels: Float64Array[] = [];
  for (let ch = 0; ch < wav.channels; ch += 1) {
    const x = new Float64Array(wav.frames);
    for (let f = 0; f < wav.frames; f += 1) x[f] = wav.samples[f * wav.channels + ch]!;
    // forward then time-reversed pass: zero phase, the transient stays where it was measured
    const forward = biquad(x, c);
    const back = biquad(forward.reverse(), c).reverse();
    channels.push(back);
  }
  const before = new Float64Array(wav.frames);
  const after = new Float64Array(wav.frames);
  for (let f = 0; f < wav.frames; f += 1) {
    before[f] = wav.samples[f * wav.channels]!;
    after[f] = channels[0]![f]!;
  }
  const speechBandChangeDb = Math.round((bandEnergyDb(after, wav.sampleRate, 1000, 4000) - bandEnergyDb(before, wav.sampleRate, 1000, 4000)) * 10) / 10;
  return {bytes: encodeWav16(wav.sampleRate, wav.channels, wav.frames, (frame, ch) => channels[ch]![frame]!), speechBandChangeDb};
}
