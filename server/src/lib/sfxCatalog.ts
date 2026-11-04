/**
 * Human-curated SFX library (remotion/public/sfx-library/sfxinfo.json). See that folder's README.md and docs/audio/VOICE_FIRST.md.
 *
 * Parsing, validation, the deterministic pick and the voice-relative level live here. polishSfx.ts stays pure and unchanged:
 * `applyCatalogToHits` runs on its output, and with an empty catalog it is never called, so every render is identical to before.
 * Nothing here ever writes to the library folder.
 */

import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {SFX_WORD_MASK_SEC, type PolishSfxHit} from './polishSfx.ts';

export {SFX_WORD_MASK_SEC};

export const SFX_CUES = ['cut', 'transition', 'zoom_in', 'zoom_out', 'caption_pop', 'kinetic_plate', 'emphasis', 'hook', 'cta', 'ui', 'ambience'] as const;
export type SfxCue = (typeof SFX_CUES)[number];

/** Cues the engine fires today (see cueForHit). The others are accepted in the catalog and reserved for later wiring. */
export const WIRED_CUES: readonly SfxCue[] = ['cut', 'transition', 'zoom_in', 'kinetic_plate', 'emphasis'];

export const SFX_AUDIO_EXTENSIONS = ['.wav', '.mp3', '.m4a'] as const;
export const SFX_LIBRARY_DIRNAME = 'sfx-library';
export const SFX_CATALOG_FILE = 'sfxinfo.json';

/** The file path Remotion serves with staticFile(). Same for local and Lambda renders (public/ ships with the bundle). */
export const SFX_STATIC_PREFIX = `${SFX_LIBRARY_DIRNAME}/`;

export const SFX_DURATION_TOLERANCE_SEC = 0.05;
export const SFX_LEADING_SILENCE_MAX_SEC = 0.01;
export const SFX_SILENCE_DBFS = -50;
/** The engine assumes each file peaks near 0 dBFS, so the level it sets is the peak level. */
export const SFX_PEAK_RANGE_DBFS: readonly [number, number] = [-3, 0];

export const SFX_DEFAULT_VOICE_OFFSET_LU = -10;
/** Hard ceiling: an SFX peak is never closer to the voice than this, whatever `gainDb` says. */
export const SFX_MAX_PEAK_OVER_VOICE_LU = -6;

export type SfxEntry = {fileName: string; duration: number; tobeused: SfxCue[]; gainDb: number; notes?: string};

export type SfxIssue = {level: 'error' | 'warn'; code: string; fileName?: string; message: string; suggestion?: string};

export type AudioProbe = {durationSec: number; leadingSilenceSec: number; peakDbfs: number | null};

const isCue = (value: string): value is SfxCue => (SFX_CUES as readonly string[]).includes(value);

/** Default library folder. SFX_LIBRARY_DIR overrides it (tests, other deployments). */
export function sfxLibraryDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = (env.SFX_LIBRARY_DIR ?? '').trim();
  if (explicit) return path.resolve(explicit);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../remotion/public', SFX_LIBRARY_DIRNAME);
}

/** SFX_VOICE_OFFSET_LU: LU of the SFX peak relative to the voice's speech loudness. Default -10. Positive or non-numeric values fall back. */
export function sfxVoiceOffsetLu(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.SFX_VOICE_OFFSET_LU ?? '').trim();
  if (raw === '') return SFX_DEFAULT_VOICE_OFFSET_LU;
  const value = Number(raw);
  return Number.isFinite(value) && value <= 0 ? value : SFX_DEFAULT_VOICE_OFFSET_LU;
}

/** Pure. Never throws: a bad entry becomes a warning and is dropped, a bad cue is removed from its entry. */
export function parseCatalog(raw: unknown): {entries: SfxEntry[]; issues: SfxIssue[]} {
  const issues: SfxIssue[] = [];
  const entries: SfxEntry[] = [];
  if (!Array.isArray(raw)) {
    issues.push({level: 'error', code: 'catalog_not_array', message: `${SFX_CATALOG_FILE} must be a JSON array (use [] for an empty library).`});
    return {entries, issues};
  }
  const seen = new Set<string>();
  raw.forEach((item, index) => {
    const label = `entry ${index + 1}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push({level: 'warn', code: 'entry_invalid', message: `${label} is not an object and was ignored.`});
      return;
    }
    const record = item as Record<string, unknown>;
    const fileName = typeof record.fileName === 'string' ? record.fileName.trim() : '';
    if (!fileName) {
      issues.push({level: 'warn', code: 'entry_no_filename', message: `${label} has no fileName and was ignored.`});
      return;
    }
    if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
      issues.push({level: 'warn', code: 'entry_bad_filename', fileName, message: `${label}: fileName must be a plain file name inside the library folder.`});
      return;
    }
    if (!(SFX_AUDIO_EXTENSIONS as readonly string[]).includes(path.extname(fileName).toLowerCase())) {
      issues.push({level: 'warn', code: 'entry_bad_extension', fileName, message: `${fileName}: use ${SFX_AUDIO_EXTENSIONS.join(', ')}.`});
      return;
    }
    if (seen.has(fileName)) {
      issues.push({level: 'warn', code: 'entry_duplicate', fileName, message: `${fileName} appears twice. The first entry is used.`});
      return;
    }
    const duration = Number(record.duration);
    if (!(typeof record.duration === 'number' && Number.isFinite(duration) && duration > 0)) {
      issues.push({level: 'warn', code: 'entry_no_duration', fileName, message: `${fileName}: duration (seconds) is required and must be above 0. Entry ignored.`});
      return;
    }
    const rawCues = Array.isArray(record.tobeused)
      ? record.tobeused.map(cue => String(cue))
      : typeof record.tobeused === 'string'
        ? record.tobeused.split(',')
        : null;
    if (rawCues === null) {
      issues.push({level: 'warn', code: 'entry_no_cues', fileName, message: `${fileName}: tobeused is required (an array of cue names). Entry ignored.`});
      return;
    }
    const cues: SfxCue[] = [];
    for (const rawCue of rawCues) {
      const cue = rawCue.trim().toLowerCase();
      if (!cue) continue;
      if (isCue(cue)) {
        if (!cues.includes(cue)) cues.push(cue);
      } else {
        issues.push({
          level: 'warn',
          code: 'unknown_cue',
          fileName,
          message: `${fileName}: unknown tobeused value "${rawCue.trim()}".`,
          suggestion: `Allowed: ${SFX_CUES.join(', ')}.`,
        });
      }
    }
    if (cues.length === 0) {
      issues.push({level: 'warn', code: 'entry_no_valid_cues', fileName, message: `${fileName}: no valid tobeused value, so the engine will never pick it.`});
      return;
    }
    let gainDb = 0;
    if (record.gainDb !== undefined) {
      if (typeof record.gainDb === 'number' && Number.isFinite(record.gainDb)) gainDb = record.gainDb;
      else issues.push({level: 'warn', code: 'entry_bad_gain', fileName, message: `${fileName}: gainDb must be a number. Using 0.`});
    }
    seen.add(fileName);
    entries.push({fileName, duration, tobeused: cues, gainDb, ...(typeof record.notes === 'string' ? {notes: record.notes} : {})});
  });
  return {entries, issues};
}

/** Reads sfxinfo.json. A missing folder or file is an empty library, not a problem. Never throws. */
export function loadSfxCatalog(dir: string = sfxLibraryDir()): {entries: SfxEntry[]; issues: SfxIssue[]} {
  const file = path.join(dir, SFX_CATALOG_FILE);
  if (!existsSync(file)) return {entries: [], issues: []};
  try {
    return parseCatalog(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    return {entries: [], issues: [{level: 'error', code: 'catalog_unreadable', message: `${SFX_CATALOG_FILE} is not valid JSON: ${error instanceof Error ? error.message.slice(0, 120) : 'parse error'}`}]};
  }
}

/** ffmpeg decode to mono float32, then duration, leading silence and peak. Local only; reads the file, never writes. */
export function probeAudioFile(filePath: string, ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg'): Promise<AudioProbe> {
  const rate = 48000;
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ['-v', 'error', '-i', filePath, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-'], {stdio: ['ignore', 'pipe', 'pipe']});
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-500);
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffmpeg could not decode the file: ${stderr.trim().slice(0, 160)}`));
      const buffer = Buffer.concat(chunks);
      const samples = new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.byteLength / 4));
      resolve(analyzeSamples(samples, rate));
    });
  });
}

/** Pure. Leading silence = time until the first sample above SFX_SILENCE_DBFS. */
export function analyzeSamples(samples: Float32Array, rate: number): AudioProbe {
  const floor = 10 ** (SFX_SILENCE_DBFS / 20);
  let peak = 0;
  let first = -1;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.abs(samples[i]!);
    if (value > peak) peak = value;
    if (first < 0 && value > floor) first = i;
  }
  return {
    durationSec: samples.length / rate,
    leadingSilenceSec: first < 0 ? samples.length / rate : first / rate,
    peakDbfs: peak > 0 ? 20 * Math.log10(peak) : null,
  };
}

export type LibraryReport = {dir: string; entries: SfxEntry[]; issues: SfxIssue[]; probed: number};

/**
 * The one validation both `npm run sfx:check` and engine startup use. Read-only. Suggestions are text only.
 * `probe` is injectable so tests do not need ffmpeg; the default decodes with ffmpeg.
 */
export async function validateSfxLibrary(
  dir: string = sfxLibraryDir(),
  probe: (filePath: string) => Promise<AudioProbe> = probeAudioFile,
): Promise<LibraryReport> {
  const loaded = loadSfxCatalog(dir);
  const issues = [...loaded.issues];
  let probed = 0;
  for (const entry of loaded.entries) {
    const file = path.join(dir, entry.fileName);
    if (!existsSync(file)) {
      issues.push({level: 'error', code: 'file_missing', fileName: entry.fileName, message: `${entry.fileName} is in ${SFX_CATALOG_FILE} but not in the folder.`});
      continue;
    }
    let result: AudioProbe;
    try {
      result = await probe(file);
      probed += 1;
    } catch (error) {
      issues.push({level: 'error', code: 'file_unreadable', fileName: entry.fileName, message: `${entry.fileName}: ${error instanceof Error ? error.message : 'could not be read'}`});
      continue;
    }
    if (Math.abs(result.durationSec - entry.duration) > SFX_DURATION_TOLERANCE_SEC) {
      issues.push({
        level: 'warn',
        code: 'duration_mismatch',
        fileName: entry.fileName,
        message: `${entry.fileName}: catalog says ${entry.duration}s, the file is ${result.durationSec.toFixed(3)}s.`,
        suggestion: `Set "duration": ${Math.round(result.durationSec * 100) / 100} for ${entry.fileName}.`,
      });
    }
    if (result.leadingSilenceSec > SFX_LEADING_SILENCE_MAX_SEC) {
      issues.push({
        level: 'warn',
        code: 'leading_silence',
        fileName: entry.fileName,
        message: `${entry.fileName}: ${Math.round(result.leadingSilenceSec * 1000)} ms of leading silence. The hit should start at 0.0 s.`,
        suggestion: `Trim the first ${Math.round(result.leadingSilenceSec * 1000)} ms in your editor, then update "duration".`,
      });
    }
    if (result.peakDbfs !== null && (result.peakDbfs < SFX_PEAK_RANGE_DBFS[0] || result.peakDbfs > SFX_PEAK_RANGE_DBFS[1])) {
      issues.push({
        level: 'warn',
        code: 'peak_out_of_range',
        fileName: entry.fileName,
        message: `${entry.fileName}: peak is ${result.peakDbfs.toFixed(1)} dBFS. The engine assumes about -1 dBFS when it sets the level under the voice.`,
        suggestion: `Normalize the file to a -1 dBFS peak, or set "gainDb": ${Math.round(-1 - result.peakDbfs)} to compensate.`,
      });
    }
  }
  const catalogued = new Set(loaded.entries.map(entry => entry.fileName));
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue;
      if (!(SFX_AUDIO_EXTENSIONS as readonly string[]).includes(path.extname(name).toLowerCase())) continue;
      if (!catalogued.has(name)) {
        issues.push({
          level: 'warn',
          code: 'uncatalogued_file',
          fileName: name,
          message: `${name} is in the folder but has no entry in ${SFX_CATALOG_FILE}, so the engine will not use it.`,
          suggestion: `Add {"fileName": "${name}", "duration": <seconds>, "tobeused": ["cut"]} to ${SFX_CATALOG_FILE}.`,
        });
      }
    }
  }
  return {dir, entries: loaded.entries, issues, probed};
}

/**
 * Which cue a scheduled polish hit stands for. Reasons come from schedulePolishSfxHits.
 * Full-screen plates and recipe entrances are scene or plate changes; a hard cut is a cut; a smash zoom is a zoom-in; a framed window is a punch-in.
 */
export function cueForHit(hit: Pick<PolishSfxHit, 'kind' | 'reason'>): SfxCue {
  const reason = (hit.reason ?? '').split('|')[0]!; // placement tags a snapped hit with '|beat'
  if (reason === 'sfx_hook') return 'hook';
  if (reason === 'sfx_cta') return 'cta';
  if (reason.startsWith('recipe_')) return 'kinetic_plate';
  if (reason === 'graphic_full_screen') return 'transition';
  if (reason === 'graphic_split_screen') return 'emphasis';
  if (reason === 'framed_window') return 'zoom_in';
  if (reason.startsWith('transition_')) {
    if (/smash\s*zoom/i.test(reason)) return 'zoom_in';
    return hit.kind === 'hit' ? 'cut' : 'transition';
  }
  return hit.kind === 'whoosh' ? 'transition' : 'emphasis';
}

/** Deterministic: the same video, cue and time always pick the same file. Order of the catalog does not matter. */
export function pickEntry(entries: readonly SfxEntry[], cue: SfxCue, videoId: string, atSec: number): SfxEntry | null {
  const matches = entries.filter(entry => entry.tobeused.includes(cue)).sort((a, b) => a.fileName.localeCompare(b.fileName));
  if (matches.length === 0) return null;
  const digest = createHash('sha256').update(`${videoId}|${cue}|${atSec.toFixed(3)}`).digest();
  return matches[digest.readUInt32BE(0) % matches.length]!;
}

/** Linear Remotion volume for a catalog hit: peak at voLufs + offset + gainDb, never closer to the voice than SFX_MAX_PEAK_OVER_VOICE_LU. */
export function catalogVolume(voLufs: number, offsetLu: number, gainDb: number): {volume: number; peakDbfs: number; clamped: boolean} {
  const relative = offsetLu + gainDb;
  const clamped = relative > SFX_MAX_PEAK_OVER_VOICE_LU;
  const peakDbfs = voLufs + Math.min(relative, SFX_MAX_PEAK_OVER_VOICE_LU);
  return {volume: Math.min(1, Math.round(10 ** (peakDbfs / 20) * 10000) / 10000), peakDbfs: Math.round(peakDbfs * 100) / 100, clamped};
}

export type CatalogHit = PolishSfxHit & {src?: string; durationSec?: number};

export type CatalogApplyStats = {
  input: number;
  fromCatalog: number;
  fallback: number;
  maskedByWord: number;
  clamped: number;
  /** The loudest catalog hit relative to the voice (LU). The number that proves the voice-first rule. Null when no catalog hit played. */
  maxPeakVsVoiceLu: number | null;
  voLufs: number;
  offsetLu: number;
};

/**
 * Replace scheduled hits with catalog files where an entry matches the hit's cue. No match keeps the hit unchanged (built-in wav).
 * A catalog hit that would land within SFX_WORD_MASK_SEC after a word onset is dropped, so it never covers a word.
 * Cap and spacing were already applied by schedulePolishSfxHits; this never adds a hit.
 */
export function applyCatalogToHits(
  hits: readonly CatalogHit[],
  input: {entries: readonly SfxEntry[]; videoId: string; voLufs: number; offsetLu?: number; wordOnsetsSec?: readonly number[]},
): {hits: CatalogHit[]; stats: CatalogApplyStats} {
  const offsetLu = input.offsetLu ?? SFX_DEFAULT_VOICE_OFFSET_LU;
  const onsets = (input.wordOnsetsSec ?? []).filter(Number.isFinite);
  const out: CatalogHit[] = [];
  const stats: CatalogApplyStats = {input: hits.length, fromCatalog: 0, fallback: 0, maskedByWord: 0, clamped: 0, maxPeakVsVoiceLu: null, voLufs: input.voLufs, offsetLu};
  for (const hit of hits) {
    const entry = pickEntry(input.entries, cueForHit(hit), input.videoId, hit.at);
    if (!entry) {
      stats.fallback += 1;
      out.push(hit);
      continue;
    }
    if (onsets.some(onset => hit.at > onset + 1e-6 && hit.at <= onset + SFX_WORD_MASK_SEC + 1e-6)) {
      stats.maskedByWord += 1;
      continue;
    }
    const level = catalogVolume(input.voLufs, offsetLu, entry.gainDb);
    if (level.clamped) stats.clamped += 1;
    const vsVoice = Math.round((level.peakDbfs - input.voLufs) * 100) / 100;
    stats.maxPeakVsVoiceLu = stats.maxPeakVsVoiceLu === null ? vsVoice : Math.max(stats.maxPeakVsVoiceLu, vsVoice);
    stats.fromCatalog += 1;
    out.push({
      ...hit,
      volume: level.volume,
      src: `staticFile:${SFX_STATIC_PREFIX}${entry.fileName}`,
      durationSec: entry.duration,
      reason: `${hit.reason ?? 'hit'}|sfx:${entry.fileName}`,
    });
  }
  return {hits: out, stats};
}
