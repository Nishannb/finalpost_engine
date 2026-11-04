/**
 * Free re-render of a saved blueprint. Local Remotion + local ffmpeg only.
 *
 *   npm run render-blueprint -- <blueprint.json> [--duck-preset talking|default|legacy_brief]
 *     [--speech-offset -18] [--pause-offset -9] [--open-offset -4]
 *     [--carved 0|1] [--master 0|1] [--measure 0|1]
 *
 * <blueprint.json> is a raw TimelineBlueprint or a SavedBlueprintEnvelope (top-level `blueprint` object).
 * Output: out/renders/{videoId}-{preset}-{timestamp}.mp4. mix_measured / master_pass numbers are in the engine log for the job id.
 *
 * BAN: this file must never reach the analyze pipeline, an LLM client, Runware, or a Lambda render. The render
 * module is imported dynamically inside main(), so the pure helpers below load without any config.
 */

import {copyFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildDuckEnvelope, VO_LUFS_ASSUMED, type DuckPresetName} from '../stages/music/duckEnvelope.ts';
import type {AudioDesign, TimelineBlueprint} from '../types/blueprint.ts';

export type CliOptions = {
  file: string;
  duckPreset?: DuckPresetName;
  speechOffset?: number;
  pauseOffset?: number;
  openOffset?: number;
  carved?: '0' | '1';
  master: '0' | '1';
  measure: '0' | '1';
};

type Envelope = {videoId?: string; sourceVideoPath?: string | null; voLufs?: number | null; blueprint: TimelineBlueprint};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {file: '', master: '0', measure: '0'};
  const num = (flag: string, raw: string | undefined): number => {
    const value = Number(raw);
    if (raw === undefined || raw === '' || !Number.isFinite(value)) throw new Error(`${flag} needs a number`);
    return value;
  };
  const bit = (flag: string, raw: string | undefined): '0' | '1' => {
    if (raw !== '0' && raw !== '1') throw new Error(`${flag} must be 0 or 1`);
    return raw;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => inline ?? argv[++i];
    switch (flag) {
      case '--duck-preset': {
        const raw = value();
        if (raw !== 'talking' && raw !== 'default' && raw !== 'legacy_brief') throw new Error('--duck-preset must be talking|default|legacy_brief');
        opts.duckPreset = raw;
        break;
      }
      case '--speech-offset': opts.speechOffset = num(flag, value()); break;
      case '--pause-offset': opts.pauseOffset = num(flag, value()); break;
      case '--open-offset': opts.openOffset = num(flag, value()); break;
      case '--carved': opts.carved = bit(flag, value()); break;
      case '--master': opts.master = bit(flag, value()); break;
      case '--measure': opts.measure = bit(flag, value()); break;
      default:
        if (flag.startsWith('--')) throw new Error(`unknown flag ${flag}`);
        if (opts.file) throw new Error('only one blueprint file is accepted');
        opts.file = arg;
    }
  }
  if (!opts.file) throw new Error('Usage: npm run render-blueprint -- <blueprint.json> [--duck-preset ...] [--speech-offset N] [--pause-offset N] [--open-offset N] [--carved 0|1] [--master 0|1] [--measure 0|1]');
  return opts;
}

export function loadBlueprintFile(file: string): Envelope {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (parsed.blueprint && typeof parsed.blueprint === 'object') return parsed as unknown as Envelope;
  return {blueprint: parsed as unknown as TimelineBlueprint};
}

/** Keep a local path that exists or an http(s) URL. A missing /prefetch path falls back to the envelope's sourceVideoPath, else throws. */
export function resolveVideoUrl(videoUrl: string, sourceVideoPath: string | null | undefined, exists: (p: string) => boolean = existsSync): string {
  const trimmed = videoUrl.trim();
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('staticFile:')) return trimmed;
  const onDisk = trimmed.startsWith('/prefetch/') ? exists(path.join(REPO_ROOT, 'remotion', 'public', trimmed)) : exists(trimmed);
  if (onDisk) return trimmed;
  if (sourceVideoPath && exists(sourceVideoPath)) return sourceVideoPath;
  throw new Error(
    `videoUrl "${trimmed}" is not available on disk. Give the blueprint a local videoUrl (an existing path or an http(s) URL), or use a saved envelope whose sourceVideoPath still exists.`,
  );
}

export function duckOverridesRequested(opts: CliOptions): boolean {
  return opts.duckPreset !== undefined || opts.speechOffset !== undefined || opts.pauseOffset !== undefined || opts.openOffset !== undefined;
}

/** Pure: returns an AudioDesign with the duck rebuilt when asked (or when it is missing but words and a generated bed exist). Otherwise returns the input untouched. */
export function applyDuckOverrides(
  blueprint: TimelineBlueprint,
  opts: Pick<CliOptions, 'duckPreset' | 'speechOffset' | 'pauseOffset' | 'openOffset'>,
  envelopeVoLufs?: number | null,
): {audioDesign: AudioDesign | undefined; rebuilt: boolean} {
  const audio = blueprint.audioDesign;
  if (!audio) return {audioDesign: audio, rebuilt: false};
  const requested = duckOverridesRequested(opts as CliOptions);
  const hasBed = audio.musicSource === 'generated' && Boolean(audio.musicFullUrl ?? audio.musicUrl);
  const words = blueprint.captionWords ?? [];
  const missing = !audio.duck && words.length > 0 && hasBed;
  if (!requested && !missing) return {audioDesign: audio, rebuilt: false};
  if (!hasBed) return {audioDesign: audio, rebuilt: false};
  const voLufs = audio.voLufs ?? envelopeVoLufs ?? VO_LUFS_ASSUMED;
  const duck = buildDuckEnvelope({
    words,
    durationSec: audio.duck?.durationSec ?? blueprint.outputDurationSec,
    preset: opts.duckPreset ?? audio.duck?.preset ?? 'talking',
    voLufs,
    bedLufs: audio.duck?.bedLufs ?? -16,
    speechOffsetLu: opts.speechOffset,
    pauseOffsetLu: opts.pauseOffset,
    openOffsetLu: opts.openOffset,
  });
  return {audioDesign: {...audio, duck, voLufs: audio.voLufs ?? voLufs}, rebuilt: true};
}

/** Pure: MusicBedTrack plays the twin whenever musicCarvedUrl is present, so `--carved 0` must omit the key. `--carved 1` never invents a URL. */
export function applyCarvedOverride(
  audioDesign: AudioDesign | undefined,
  carved: CliOptions['carved'],
): {audioDesign: AudioDesign | undefined; warning?: string} {
  if (!audioDesign || carved === undefined) return {audioDesign};
  if (carved === '0') {
    if (!('musicCarvedUrl' in audioDesign)) return {audioDesign};
    const {musicCarvedUrl: _dropped, ...rest} = audioDesign;
    return {audioDesign: rest as AudioDesign};
  }
  if (!audioDesign.musicCarvedUrl) return {audioDesign, warning: '--carved 1: carved cannot engage without musicCarvedUrl on the blueprint.'};
  return {audioDesign};
}

async function main(): Promise<void> {
  const opts = parseCliArgs(process.argv.slice(2));
  const loaded = loadBlueprintFile(path.resolve(opts.file));
  let blueprint = loaded.blueprint;

  const videoUrl = resolveVideoUrl(blueprint.videoUrl, loaded.sourceVideoPath);
  const {audioDesign: ducked, rebuilt} = applyDuckOverrides(blueprint, opts, loaded.voLufs);
  if (duckOverridesRequested(opts) && !rebuilt) console.warn('No generated bed on this blueprint, so the duck options were ignored.');
  const {audioDesign, warning: carvedWarning} = applyCarvedOverride(ducked, opts.carved);
  if (carvedWarning) console.warn(carvedWarning);
  blueprint = {...blueprint, videoUrl, ...(audioDesign ? {audioDesign} : {})};

  // Env for this process only; .env is never touched.
  if (opts.carved !== undefined) process.env.MUSIC_CARVED_TWIN = opts.carved;
  process.env.MUSIC_MASTER_PASS = opts.master;
  process.env.MUSIC_MIX_MEASURE = opts.measure;
  process.env.LOCAL_RENDER_SKIP_R2 = '1';

  const [{renderLocally, localServedRenderPath}, {DEFAULT_RENDER_STYLE}] = await Promise.all([
    import('../stages/render/localRender.ts'),
    import('../http/schemas.ts'),
  ]);

  const videoId = loaded.videoId ?? blueprint.blueprintId;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
  const preset = `${audioDesign?.duck?.preset ?? 'none'}-c${process.env.MUSIC_CARVED_TWIN === '1' ? 1 : 0}-m${opts.master}`;
  const renderJobId = `rb_${videoId}_${stamp}`.replace(/[^A-Za-z0-9_-]/g, '_');

  await renderLocally({
    blueprint,
    style: {
      ...DEFAULT_RENDER_STYLE,
      captionTemplate: blueprint.captionDirection?.template ?? DEFAULT_RENDER_STYLE.captionTemplate,
      captionBottomFrac: blueprint.captionDirection?.bottomFrac ?? DEFAULT_RENDER_STYLE.captionBottomFrac,
      colorGradeLut: '',
    },
    renderJobId,
    onProgress: progress => {
      if (Math.round(progress * 20) % 4 === 0) console.log(`rendering ${Math.round(progress * 100)}%`);
    },
  });

  const outDir = path.join(REPO_ROOT, 'out', 'renders');
  mkdirSync(outDir, {recursive: true});
  const dest = path.join(outDir, `${videoId}-${preset}-${stamp}.mp4`);
  copyFileSync(localServedRenderPath(renderJobId), dest);
  console.log(`\nDone. Render: ${dest}`);
  console.log(`music.mix_measured / music.master_pass numbers are in the engine log under renderJobId ${renderJobId}.`);
}

const invokedDirectly = (() => {
  const invoked = process.argv[1];
  return Boolean(invoked) && path.resolve(invoked!) === fileURLToPath(import.meta.url);
})();

if (invokedDirectly) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
