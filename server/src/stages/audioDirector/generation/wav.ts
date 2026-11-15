/**
 * WAV reading, measurement and the deterministic SFX trim for generated assets. Pure TypeScript, no ffmpeg, no network.
 *
 * WAV only: the one live-verified Runware music contract returns WAV (`outputFormat: "WAV"`, agents/music_specialist/runware.py). The SFX output
 * format was never verified live (the Python agent saves it as `.mp3` without checking), so anything that is not a parseable WAV is refused upstream
 * (manifest.ts `unsupported_format`) rather than guessed at.
 *
 * Measurement rules are the ones the project already uses, so a generated file is placed exactly like a built-in:
 *   - onset: the first sample at or above 50 % of the peak (audioPlan/assets.test.ts, BUILTIN_SFX.transientOffsetSec);
 *   - leading-silence trim: 10 ms chunks below -50 dBFS RMS (agents/music_specialist/silence_trimmer.py THRESHOLD_DBFS, CHUNK_MS).
 */

export type WavInfo = {
  format: 'wav';
  codec: 'pcm_int' | 'pcm_float';
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  frames: number;
  durationSec: number;
};

export type DecodedWav = WavInfo & {
  /** Interleaved samples in [-1, 1]. */
  samples: Float32Array;
};

export type WavErrorCode = 'not_wav' | 'unsupported_wav_encoding' | 'malformed_wav' | 'empty_audio';

export class WavError extends Error {
  readonly code: WavErrorCode;
  constructor(code: WavErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_IEEE_FLOAT = 3;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

export function decodeWav(buf: Buffer): DecodedWav {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new WavError('not_wav', 'missing RIFF/WAVE header');
  let offset = 12;
  let fmt: {tag: number; channels: number; sampleRate: number; bits: number} | null = null;
  let data: Buffer | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > buf.length && id !== 'data') throw new WavError('malformed_wav', `chunk ${id} runs past the end of the file`);
    if (id === 'fmt ') {
      if (size < 16) throw new WavError('malformed_wav', 'fmt chunk shorter than 16 bytes');
      let tag = buf.readUInt16LE(body);
      if (tag === WAVE_FORMAT_EXTENSIBLE && size >= 40) tag = buf.readUInt16LE(body + 24);
      fmt = {tag, channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14)};
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(buf.length, body + size));
    }
    offset = body + size + (size % 2);
  }
  if (!fmt) throw new WavError('malformed_wav', 'no fmt chunk');
  if (!data) throw new WavError('malformed_wav', 'no data chunk');
  if (fmt.channels < 1 || fmt.sampleRate < 1) throw new WavError('malformed_wav', `channels ${fmt.channels}, sample rate ${fmt.sampleRate}`);
  const intPcm = fmt.tag === WAVE_FORMAT_PCM && [16, 24, 32].includes(fmt.bits);
  const floatPcm = fmt.tag === WAVE_FORMAT_IEEE_FLOAT && fmt.bits === 32;
  if (!intPcm && !floatPcm) throw new WavError('unsupported_wav_encoding', `format tag ${fmt.tag}, ${fmt.bits} bits`);
  const bytes = fmt.bits / 8;
  const count = Math.floor(data.length / bytes);
  const frames = Math.floor(count / fmt.channels);
  if (frames === 0) throw new WavError('empty_audio', 'no sample frames');
  const samples = new Float32Array(frames * fmt.channels);
  for (let i = 0; i < samples.length; i += 1) {
    const at = i * bytes;
    if (floatPcm) samples[i] = data.readFloatLE(at);
    else if (fmt.bits === 16) samples[i] = data.readInt16LE(at) / 32768;
    else if (fmt.bits === 24) samples[i] = data.readIntLE(at, 3) / 8388608;
    else samples[i] = data.readInt32LE(at) / 2147483648;
  }
  return {format: 'wav', codec: floatPcm ? 'pcm_float' : 'pcm_int', sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, frames, durationSec: frames / fmt.sampleRate, samples};
}

export const wavInfo = (wav: DecodedWav): WavInfo => {
  const {samples: _samples, ...info} = wav;
  return info;
};

/** Sample peak (dBFS; -Infinity for digital silence) and onset (first sample >= 50 % of peak, in seconds). Same rule as BUILTIN_SFX. */
export function measurePeakAndOnset(wav: DecodedWav): {peakDbfs: number; transientOffsetSec: number | null} {
  let peak = 0;
  for (const value of wav.samples) peak = Math.max(peak, Math.abs(value));
  if (peak === 0) return {peakDbfs: Number.NEGATIVE_INFINITY, transientOffsetSec: null};
  const index = wav.samples.findIndex(value => Math.abs(value) >= peak * 0.5);
  return {peakDbfs: Math.round(20 * Math.log10(peak) * 100) / 100, transientOffsetSec: Math.round((Math.floor(index / wav.channels) / wav.sampleRate) * 10000) / 10000};
}

export const SILENCE_THRESHOLD_DBFS = -50;
export const SILENCE_CHUNK_SEC = 0.01;

/** Leading near-silence in whole 10 ms chunks (pydub detect_leading_silence semantics: chunk RMS in dBFS below the threshold). */
export function leadingSilenceFrames(wav: DecodedWav): number {
  const chunk = Math.max(1, Math.round(wav.sampleRate * SILENCE_CHUNK_SEC));
  let start = 0;
  while (start < wav.frames) {
    const end = Math.min(wav.frames, start + chunk);
    let sum = 0;
    for (let i = start * wav.channels; i < end * wav.channels; i += 1) sum += wav.samples[i]! * wav.samples[i]!;
    const rms = Math.sqrt(sum / ((end - start) * wav.channels));
    const db = rms === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(rms);
    if (db >= SILENCE_THRESHOLD_DBFS) break;
    start = end;
  }
  return Math.min(start, wav.frames);
}

/** The fade applied where an SFX is cut short (so the cut never clicks). */
export const SFX_TAIL_FADE_SEC = 0.02;

/**
 * Deterministic SFX preparation: crop leading silence, cut to `maxSec`, linear fade over the last SFX_TAIL_FADE_SEC when cut, re-encode as 16-bit PCM
 * at the source rate and channel count. Returns the new WAV bytes and what was done.
 */
export function prepareSfxWav(wav: DecodedWav, maxSec: number): {bytes: Buffer; trimmedLeadSec: number; cutTailSec: number; faded: boolean} {
  const lead = leadingSilenceFrames(wav);
  if (lead >= wav.frames) throw new WavError('empty_audio', 'the file is silent below -50 dBFS throughout');
  const maxFrames = Math.max(1, Math.floor(maxSec * wav.sampleRate));
  const end = Math.min(wav.frames, lead + maxFrames);
  const frames = end - lead;
  const cut = end < wav.frames;
  const fadeFrames = cut ? Math.min(frames, Math.round(SFX_TAIL_FADE_SEC * wav.sampleRate)) : 0;
  const out = Buffer.alloc(44 + frames * wav.channels * 2);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + frames * wav.channels * 2, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(WAVE_FORMAT_PCM, 20);
  out.writeUInt16LE(wav.channels, 22);
  out.writeUInt32LE(wav.sampleRate, 24);
  out.writeUInt32LE(wav.sampleRate * wav.channels * 2, 28);
  out.writeUInt16LE(wav.channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(frames * wav.channels * 2, 40);
  for (let f = 0; f < frames; f += 1) {
    const gain = fadeFrames > 0 && f >= frames - fadeFrames ? (frames - 1 - f) / Math.max(1, fadeFrames - 1) : 1;
    for (let c = 0; c < wav.channels; c += 1) {
      const value = Math.max(-1, Math.min(1, wav.samples[(lead + f) * wav.channels + c]! * gain));
      out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), 44 + (f * wav.channels + c) * 2);
    }
  }
  return {bytes: out, trimmedLeadSec: lead / wav.sampleRate, cutTailSec: (wav.frames - end) / wav.sampleRate, faded: fadeFrames > 0};
}

/** Test and fixture helper: 16-bit PCM WAV from a per-frame generator. */
export function encodeWav16(sampleRate: number, channels: number, frames: number, sample: (frame: number, channel: number) => number): Buffer {
  const out = Buffer.alloc(44 + frames * channels * 2);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + frames * channels * 2, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(WAVE_FORMAT_PCM, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * channels * 2, 28);
  out.writeUInt16LE(channels * 2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(frames * channels * 2, 40);
  for (let f = 0; f < frames; f += 1) {
    for (let c = 0; c < channels; c += 1) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample(f, c) * 32767))), 44 + (f * channels + c) * 2);
  }
  return out;
}
