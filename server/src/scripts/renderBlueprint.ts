/**
 * Free re-render of a saved blueprint. Local Remotion + local ffmpeg only.
 *
 *   npm run render-blueprint -- <blueprint.json> [--duck-preset talking|default|legacy_brief]
 *     [--speech-offset -18] [--pause-offset -9] [--open-offset -4]
 *     [--release-ms 300] [--hold-ms 150] [--lead-ms 33.3]   (duck timing A/B; new edits default to hold 150, release 300, look-ahead 33.3 ms;
 *      a rebuild keeps the timing the blueprint was saved with unless a flag overrides it)
 *     [--carved 0|1] [--master 0|1] [--measure 0|1]
 *   --master defaults to 1 (the master pass is on for local renders); --master 0 turns it off.
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

import {classifyBedLoudness, classifyTranscript, classifyVoiceLoudness} from '../stages/music/bgmFailSafe.ts';
import {bedLoudnessRenderIssue} from '../stages/render/renderSafety.ts';
import {buildDuckEnvelope, type DuckPresetName} from '../stages/music/duckEnvelope.ts';
import type {AudioDesign, TimelineBlueprint} from '../types/blueprint.ts';

export type CliOptions = {
  file: string;
  duckPreset?: DuckPresetName;
  speechOffset?: number;
  pauseOffset?: number;
  openOffset?: number;
  holdMs?: number;
  releaseMs?: number;
  leadMs?: number;
  carved?: '0' | '1';
  master: '0' | '1';
  measure: '0' | '1';
  /** Phase SFX-3E: an explicitly supplied MEASURED voice loudness (LUFS) for a duck rebuild when the blueprint records none. Never assumed. */
  voLufs?: number;
  /** Phase SFX-3G: an explicitly supplied MEASURED integrated loudness (LUFS) of the generated bed, for a rebuild when the blueprint records none. Never assumed. */
  bedLufs?: number;
};

type Envelope = {videoId?: string; sourceVideoPath?: string | null; voLufs?: number | null; blueprint: TimelineBlueprint};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {file: '', master: '1', measure: '0'};
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
      case '--hold-ms': opts.holdMs = num(flag, value()); if (opts.holdMs < 0 || opts.holdMs > 2000) throw new Error('--hold-ms must be 0..2000'); break;
      case '--release-ms': opts.releaseMs = num(flag, value()); if (opts.releaseMs < 10 || opts.releaseMs > 3000) throw new Error('--release-ms must be 10..3000'); break;
      case '--lead-ms': opts.leadMs = num(flag, value()); if (opts.leadMs < 0 || opts.leadMs > 200) throw new Error('--lead-ms must be 0..200'); break;
      case '--vo-lufs': opts.voLufs = num(flag, value()); if (opts.voLufs < -70 || opts.voLufs > 0) throw new Error('--vo-lufs must be a measured loudness in -70..0 LUFS'); break;
      case '--bed-lufs': opts.bedLufs = num(flag, value()); if (opts.bedLufs < -70 || opts.bedLufs > 0) throw new Error('--bed-lufs must be a measured loudness in -70..0 LUFS'); break;
      case '--carved': opts.carved = bit(flag, value()); break;
      case '--master': opts.master = bit(flag, value()); break;
      case '--measure': opts.measure = bit(flag, value()); break;
      default:
        if (flag.startsWith('--')) throw new Error(`unknown flag ${flag}`);
        if (opts.file) throw new Error('only one blueprint file is accepted');
        opts.file = arg;
    }
  }
  if (!opts.file) throw new Error('Usage: npm run render-blueprint -- <blueprint.json> [--duck-preset ...] [--speech-offset N] [--pause-offset N] [--open-offset N] [--hold-ms N] [--release-ms N] [--lead-ms N] [--carved 0|1] [--master 0|1] [--measure 0|1]');
  return opts;
}

/** The env this CLI needs for one render. Pure on the env it is given. Called after the engine config has loaded .env, so the flags win over .env. */
export function applyRenderEnv(opts: Pick<CliOptions, 'carved' | 'master' | 'measure'>, env: NodeJS.ProcessEnv): void {
  if (opts.carved !== undefined) env.MUSIC_CARVED_TWIN = opts.carved;
  env.MUSIC_MASTER_PASS = opts.master;
  env.MUSIC_MIX_MEASURE = opts.measure;
  env.LOCAL_RENDER_SKIP_R2 = '1'; // a free re-render never uploads
}

export function resolveBlueprintPath(file: string): string {
  return path.isAbsolute(file) ? file : path.resolve(REPO_ROOT, file);
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
  return opts.duckPreset !== undefined || opts.speechOffset !== undefined || opts.pauseOffset !== undefined || opts.openOffset !== undefined || opts.holdMs !== undefined || opts.releaseMs !== undefined || opts.leadMs !== undefined;
}

/** Pure: returns an AudioDesign with the duck rebuilt when asked (or when it is missing but words and a generated bed exist). Otherwise returns the input untouched. */
export function applyDuckOverrides(
  blueprint: TimelineBlueprint,
  opts: Pick<CliOptions, 'duckPreset' | 'speechOffset' | 'pauseOffset' | 'openOffset' | 'holdMs' | 'releaseMs' | 'leadMs'> & {voLufs?: number; bedLufs?: number},
  envelopeVoLufs?: number | null,
): {audioDesign: AudioDesign | undefined; rebuilt: boolean; warnings: string[]} {
  const audio = blueprint.audioDesign;
  const warnings: string[] = [];
  if (!audio) return {audioDesign: audio, rebuilt: false, warnings};
  const requested = duckOverridesRequested(opts as CliOptions);
  const hasBed = audio.musicSource === 'generated' && Boolean(audio.musicFullUrl ?? audio.musicUrl);
  const words = blueprint.captionWords ?? [];
  const missing = !audio.duck && words.length > 0 && hasBed;
  if (!requested && !missing) return {audioDesign: audio, rebuilt: false, warnings};
  if (!hasBed) return {audioDesign: audio, rebuilt: false, warnings};
  const preset = opts.duckPreset ?? audio.duck?.preset ?? 'talking';
  // Phase SFX-3E: never an assumed voice level. The level the blueprint itself recorded (audioDesign.voLufs, the saved envelope's voLufs, or the
  // stored duck's voLufs) keeps historical renders compatible; an explicit --vo-lufs is the operator's measured value. Otherwise a voice-relative
  // (talking) rebuild is refused with a diagnostic instead of guessing. An absolute preset does not use the voice.
  const recorded = opts.voLufs ?? audio.voLufs ?? envelopeVoLufs ?? audio.duck?.voLufs;
  const voice = classifyVoiceLoudness({measured: recorded, voiceTrack: 'unknown'});
  if (preset === 'talking' && voice.status !== 'measured') {
    throw new Error(
      `Cannot rebuild the voice-relative duck: this blueprint records no valid voice loudness (${voice.status}${voice.status === 'invalid' ? `: ${voice.reason}` : ''}). ` +
        'The level is never assumed. Pass --vo-lufs <measured LUFS>, use an absolute --duck-preset (default | legacy_brief), or render without duck options.',
    );
  }
  const voLufs = voice.status === 'measured' ? voice.lufs : undefined;
  // Phase SFX-3G: the bed's loudness too: the stored duck's bedLufs or an explicit --bed-lufs, never the assumed -16. A voice-relative rebuild
  // without it is refused (an absolute preset does not use it).
  const bed = classifyBedLoudness(opts.bedLufs ?? audio.duck?.bedLufs);
  if (preset === 'talking' && bed.status !== 'measured') {
    throw new Error(
      `Cannot rebuild the voice-relative duck: this blueprint records no valid bed loudness (${bed.status}${bed.status === 'invalid' ? `: ${bed.reason}` : ''}). ` +
        'The bed loudness is never assumed. Pass --bed-lufs <measured LUFS>, use an absolute --duck-preset (default | legacy_brief), or render without duck options.',
    );
  }
  // Speech timing: stored caption words that are empty or untrusted never open the bed; it is held at the speech level for the whole video.
  const durationSec = audio.duck?.durationSec ?? blueprint.outputDurationSec;
  const transcript = classifyTranscript({words, analysis: 'unknown', durationSec});
  const duckWords = transcript.status === 'speech' ? words : [{start: 0, end: Math.max(durationSec, 1e-3)}];
  if (transcript.status !== 'speech') warnings.push(`duck rebuild: caption words ${transcript.status} (${'reason' in transcript ? transcript.reason : ''}); the bed is held at the speech level for the whole video`);
  const duck = buildDuckEnvelope({
    words: duckWords,
    durationSec,
    preset,
    ...(voLufs !== undefined ? {voLufs} : {}),
    ...(bed.status === 'measured' ? {bedLufs: bed.lufs} : {}),
    speechOffsetLu: opts.speechOffset,
    pauseOffsetLu: opts.pauseOffset,
    openOffsetLu: opts.openOffset,
    // A rebuild keeps the timing the blueprint was saved with (an older blueprint keeps its 450 ms release and no look-ahead); a flag overrides.
    ...(audio.duck ? {holdSec: audio.duck.holdSec, releaseSec: audio.duck.releaseSec, leadSec: audio.duck.leadSec ?? 0} : {}),
    ...(opts.holdMs !== undefined ? {holdSec: opts.holdMs / 1000} : {}),
    ...(opts.releaseMs !== undefined ? {releaseSec: opts.releaseMs / 1000} : {}),
    ...(opts.leadMs !== undefined ? {leadSec: opts.leadMs / 1000} : {}),
  });
  return {audioDesign: {...audio, duck, ...(audio.voLufs !== undefined || voLufs !== undefined ? {voLufs: audio.voLufs ?? voLufs} : {})}, rebuilt: true, warnings};
}

/**
 * Phase SFX-3G/3H: why a stored blueprint's generated bed cannot be rendered, or null. The production rule (stages/render/renderSafety.ts, also
 * enforced by renderLocally itself): a `talking` duck's bed loudness must be valid AND backed by provenance. A blueprint written before SFX-3H has
 * no provenance and is refused until an operator attests the value with --bed-lufs.
 */
export function storedBedLoudnessIssue(audio: AudioDesign | undefined): string | null {
  const issue = bedLoudnessRenderIssue(audio);
  if (!issue) return null;
  return `${issue.code}: ${issue.detail}; it is never rendered against the assumed -16 LUFS or an unverified value. Pass --bed-lufs <measured LUFS> (with --vo-lufs if needed) to attest (or rebuild) it.`;
}

/**
 * Phase SFX-3H: an operator's explicit attestation. When the duck of a generated `talking` bed already uses exactly `bedLufs`, the provenance
 * {status: 'operator_attested', lufs} is recorded; the duck and every level are left untouched. Otherwise nothing changes (the caller rebuilds).
 */
export function applyBedAttestation(audio: AudioDesign | undefined, bedLufs: number | undefined): {audioDesign: AudioDesign | undefined; attested: boolean} {
  if (!audio || bedLufs === undefined || audio.musicSource !== 'generated' || !audio.duck) return {audioDesign: audio, attested: false};
  const bed = classifyBedLoudness(audio.duck.bedLufs);
  if (bed.status !== 'measured' || bed.lufs !== bedLufs) return {audioDesign: audio, attested: false};
  return {audioDesign: {...audio, musicProvenance: {...(audio.musicProvenance ?? {source: 'generated'}), bedLoudness: {status: 'operator_attested', lufs: bedLufs}}}, attested: true};
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
  const loaded = loadBlueprintFile(resolveBlueprintPath(opts.file));
  let blueprint = loaded.blueprint;

  const videoUrl = resolveVideoUrl(blueprint.videoUrl, loaded.sourceVideoPath);
  // Phase SFX-3G/3H: an explicit --bed-lufs rebuilds the duck when the stored value is missing, invalid or different; when it equals the stored
  // value the duck is kept as saved and only attested (applyBedAttestation). Without it an unverified bed is refused below.
  const stored = blueprint.audioDesign?.duck ? classifyBedLoudness(blueprint.audioDesign.duck.bedLufs) : null;
  const needsRebuild = opts.bedLufs !== undefined && blueprint.audioDesign?.musicSource === 'generated' && stored !== null && (stored.status !== 'measured' || stored.lufs !== opts.bedLufs);
  const rebuildOpts = needsRebuild && !duckOverridesRequested(opts) ? {...opts, releaseMs: Math.round((blueprint.audioDesign?.duck?.releaseSec ?? 0.3) * 1000)} : opts;
  const {audioDesign: ducked, rebuilt, warnings: duckWarnings} = applyDuckOverrides(blueprint, rebuildOpts, loaded.voLufs);
  for (const warning of duckWarnings) console.warn(warning);
  const {audioDesign: attestedDesign, attested} = applyBedAttestation(ducked, opts.bedLufs);
  if (attested) console.warn(`bed loudness ${opts.bedLufs} LUFS attested by the operator (--bed-lufs); the duck is unchanged.`);
  const bedIssue = storedBedLoudnessIssue(attestedDesign);
  if (bedIssue) throw new Error(`Refusing to render: ${bedIssue}`);
  if (duckOverridesRequested(opts) && !rebuilt) console.warn('No generated bed on this blueprint, so the duck options were ignored.');
  const {audioDesign, warning: carvedWarning} = applyCarvedOverride(attestedDesign, opts.carved);
  if (carvedWarning) console.warn(carvedWarning);
  blueprint = {...blueprint, videoUrl, ...(audioDesign ? {audioDesign} : {})};

  const [{renderLocally, localServedRenderPath}, {DEFAULT_RENDER_STYLE}] = await Promise.all([
    import('../stages/render/localRender.ts'),
    import('../http/schemas.ts'),
  ]);
  // Env for this process only; .env is never touched. This MUST come after the imports above: config/env.ts loads the engine's .env with
  // override: true when they load, so anything set before them is silently replaced by a MUSIC_* value in .env (and LOCAL_RENDER_SKIP_R2 would be too).
  applyRenderEnv(opts, process.env);

  const videoId = loaded.videoId ?? blueprint.blueprintId;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
  const preset = `${audioDesign?.duck?.preset ?? 'none'}-r${Math.round((audioDesign?.duck?.releaseSec ?? 0.45) * 1000)}-c${audioDesign?.musicCarvedUrl ? 1 : 0}-m${opts.master}`;
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
