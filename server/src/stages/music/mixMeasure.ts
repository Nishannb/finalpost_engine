import {execFile, spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import {stageLogger} from '../../lib/logger.ts';
import {DUCK_ATTACK_SEC, DUCK_HOLD_SEC, DUCK_PAUSE_GAP_SEC, DUCK_RELEASE_SEC} from './duckEnvelope.ts';
import {mixMeasureEnabled, resolvePython} from './flags.ts';

const log = stageLogger('music');

export const MIX_PROBE_COMPOSITION = 'MusicMixProbe';

export type Window = [number, number];
/** pause = the whole gap (hold and release ramps included). pauseSettled = only the part where the envelope has reached the pause gain. */
export type MixWindows = {speech: Window[]; pause: Window[]; pauseSettled: Window[]};

type DuckLike = {
  phrases: Array<{start: number; end: number}>;
  durationSec: number;
  attackSec?: number;
  holdSec?: number;
  releaseSec?: number;
  leadSec?: number;
};

/** A settled stretch shorter than this is not measured: too short to carry a loudness number. */
export const MIN_SETTLED_SEC = 0.3;
/** Trimmed off each edge of a settled stretch so a ramp never leaks into the measurement. */
export const SETTLED_GUARD_SEC = 0.02;

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * Speech windows are the duck phrases. Pause windows are the gaps between two phrases of at least 600 ms
 * (interior only: the open head and tail are not pauses). Both are clipped to the timeline.
 */
export function mixWindows(duck: DuckLike): MixWindows {
  const limit = Math.max(0, duck.durationSec);
  const phrases = [...duck.phrases].sort((a, b) => a.start - b.start);
  const hold = duck.holdSec ?? DUCK_HOLD_SEC;
  const release = duck.releaseSec ?? DUCK_RELEASE_SEC;
  const attack = (duck.attackSec ?? DUCK_ATTACK_SEC) + (duck.leadSec ?? 0);
  const speech: Window[] = [];
  const pause: Window[] = [];
  const pauseSettled: Window[] = [];
  phrases.forEach((phrase, index) => {
    const start = Math.max(0, phrase.start);
    const end = Math.min(limit, phrase.end);
    if (end > start) speech.push([round3(start), round3(end)]);
    const next = phrases[index + 1];
    if (next && next.start - phrase.end >= DUCK_PAUSE_GAP_SEC - 1e-9) {
      const gapStart = Math.max(0, phrase.end);
      const gapEnd = Math.min(limit, next.start);
      if (gapEnd > gapStart) pause.push([round3(gapStart), round3(gapEnd)]);
      // The envelope holds speechDb to phrase.end + hold, ramps down for `release`, sits at pauseDb, and starts the attack `attack` before the next phrase.
      const settledStart = Math.max(0, phrase.end) + hold + release + SETTLED_GUARD_SEC;
      const settledEnd = Math.min(limit, next.start) - attack - SETTLED_GUARD_SEC;
      if (settledEnd - settledStart >= MIN_SETTLED_SEC) pauseSettled.push([round3(settledStart), round3(settledEnd)]);
    }
  });
  return {speech, pause, pauseSettled};
}

export type PauseReport = {start: number; end: number; lengthSec: number; settledSec: number; settled: boolean};

/** One row per pause window: its length and how long the envelope sits at the pause gain inside it. settled = long enough to be measured. */
export function describePauses(duck: DuckLike): PauseReport[] {
  const {pause, pauseSettled} = mixWindows(duck);
  return pause.map(([start, end]) => {
    const inside = pauseSettled.find(([a, b]) => a >= start && b <= end);
    return {start, end, lengthSec: round3(end - start), settledSec: inside ? round3(inside[1] - inside[0]) : 0, settled: Boolean(inside)};
  });
}

/** The generated-bed fields the final render plays, so the bed stem (and the carved twin, when present) is measured the way it is mixed. */
export function bedSpecFor(audioDesign: MixMeasureInput['audioDesign']): Record<string, unknown> | undefined {
  if (!audioDesign) return undefined;
  const spec: Record<string, unknown> = {};
  for (const key of ['musicFullUrl', 'musicLoopUrl', 'musicCarvedUrl', 'musicFullDurationSec', 'musicSource'] as const) {
    if (audioDesign[key] !== undefined && audioDesign[key] !== '') spec[key] = audioDesign[key];
  }
  return Object.keys(spec).length > 0 ? spec : undefined;
}

export type MixProbeInput = {
  stem: 'bed' | 'vo';
  outPath: string;
  propsPath: string;
};

/** Pure: argv for one local probe render. Null when MUSIC_MIX_MEASURE is not on, so nothing is spawned. No Lambda flags. */
export function buildMixProbeArgv(input: MixProbeInput, env: NodeJS.ProcessEnv = process.env): string[] | null {
  if (!mixMeasureEnabled(env)) return null;
  return ['remotion', 'render', 'src/index.ts', MIX_PROBE_COMPOSITION, input.outPath, '--codec=wav', `--props=${input.propsPath}`, '--concurrency=1', '--log=error'];
}

export type MixMeasured = {
  speechGapLu: number | null;
  /** VO speech − bed over the whole pause window, hold and release ramps included. Reads high on short pauses. */
  pauseGapLuAll: number | null;
  /** VO speech − bed only where the envelope has reached the pause gain, on pauses long enough to settle. */
  pauseGapLuSettled: number | null;
  settledPauseCount: number;
  settledPauseSec: number;
  voSpeechLufs: number | null;
  bedSpeechLufs: number | null;
  bedPauseLufs: number | null;
  bedPauseSettledLufs: number | null;
  /** Speech windows where the bed's loudness is within VOICE_FIGHT_LU of the voice's. Windows under 0.4 s cannot be measured and are counted apart. */
  bedOverVoiceWindows: number;
  speechWindowsUnmeasured: number;
  minSpeechWindowGapLu: number | null;
};

export const VOICE_FIGHT_LU = 6;

/** speechGapLu = VO speech LUFS − bed speech LUFS. The pause gaps use the same VO speech LUFS minus the bed over the pause window (the VO is silent in a pause). */
export function gapsFromMeasure(
  raw: {vo_speech_lufs?: number | null; bed_speech_lufs?: number | null; bed_pause_lufs?: number | null; bed_pause_settled_lufs?: number | null; bed_over_voice_windows?: number; speech_windows_unmeasured?: number; min_speech_window_gap_lu?: number | null},
  settled: Window[] = [],
): MixMeasured {
  const num = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  const vo = num(raw.vo_speech_lufs);
  const bedSpeech = num(raw.bed_speech_lufs);
  const bedPause = num(raw.bed_pause_lufs);
  const bedPauseSettled = num(raw.bed_pause_settled_lufs);
  return {
    voSpeechLufs: vo,
    bedSpeechLufs: bedSpeech,
    bedPauseLufs: bedPause,
    speechGapLu: vo !== null && bedSpeech !== null ? round1(vo - bedSpeech) : null,
    pauseGapLuAll: vo !== null && bedPause !== null ? round1(vo - bedPause) : null,
    bedPauseSettledLufs: bedPauseSettled,
    bedOverVoiceWindows: raw.bed_over_voice_windows ?? 0,
    speechWindowsUnmeasured: raw.speech_windows_unmeasured ?? 0,
    minSpeechWindowGapLu: num(raw.min_speech_window_gap_lu),
    pauseGapLuSettled: vo !== null && bedPauseSettled !== null ? round1(vo - bedPauseSettled) : null,
    settledPauseCount: settled.length,
    settledPauseSec: round3(settled.reduce((sum, [a, b]) => sum + (b - a), 0)),
  };
}

export const CARVED_TOLERANCE_LU = 1;

export type CarvedDecision = {allowed: boolean; speechDeltaLu: number | null; pauseDeltaLu: number | null; reason: string};

/**
 * Carved twin vs the same render without it (carved=0), never against the intended 18 / 9. The carved bed changes tone, not loudness,
 * so a loudness gap can only say "carved did not move the level": allowed when the speech gap and the settled pause gap each stay
 * within CARVED_TOLERANCE_LU of carved=0. This is a necessary check only. MUSIC_CARVED_TWIN stays off by default whatever it says;
 * the human decides by ear.
 */
export function carvedDecision(
  carved0: Pick<MixMeasured, 'speechGapLu' | 'pauseGapLuSettled'>,
  carved1: Pick<MixMeasured, 'speechGapLu' | 'pauseGapLuSettled'>,
): CarvedDecision {
  const delta = (a: number | null, b: number | null) => (a === null || b === null ? null : round1(b - a));
  const speechDeltaLu = delta(carved0.speechGapLu, carved1.speechGapLu);
  const pauseDeltaLu = delta(carved0.pauseGapLuSettled, carved1.pauseGapLuSettled);
  if (speechDeltaLu === null || pauseDeltaLu === null) {
    return {allowed: false, speechDeltaLu, pauseDeltaLu, reason: 'a gap is missing (no settled pause, or a stem could not be measured), so carved cannot be compared'};
  }
  const within = Math.abs(speechDeltaLu) <= CARVED_TOLERANCE_LU + 1e-9 && Math.abs(pauseDeltaLu) <= CARVED_TOLERANCE_LU + 1e-9;
  return {
    allowed: within,
    speechDeltaLu,
    pauseDeltaLu,
    reason: within ? `carved moved speech ${speechDeltaLu} LU and settled pause ${pauseDeltaLu} LU, inside ±${CARVED_TOLERANCE_LU}` : `carved moved speech ${speechDeltaLu} LU and settled pause ${pauseDeltaLu} LU, outside ±${CARVED_TOLERANCE_LU}`,
  };
}

/** The measurer the render hook uses: pyloudnorm in agents/.venv, on two stem files and the windows. */
export function measureStems(input: {bedPath: string; voPath: string; windows: MixWindows; agentsDir: string}): Promise<MixMeasured> {
  return new Promise((resolve, reject) => {
    const python = resolvePython(input.agentsDir);
    const windowsFile = path.join(path.dirname(input.bedPath), `mix-windows-${process.pid}-${Date.now()}.json`);
    fs.writeFile(windowsFile, JSON.stringify(input.windows))
      .then(() => {
        execFile(
          python.command,
          ['-m', 'music_specialist.vo_lufs', '--mix', input.bedPath, input.voPath, windowsFile],
          {cwd: input.agentsDir, timeout: 120000, maxBuffer: 1 << 20},
          (error, stdout) => {
            void fs.rm(windowsFile, {force: true});
            if (error) return reject(error);
            try {
              resolve(gapsFromMeasure(JSON.parse(stdout), input.windows.pauseSettled));
            } catch (parseError) {
              reject(parseError);
            }
          },
        );
      })
      .catch(reject);
  });
}

/** Integrated loudness and true peak of the audio of a rendered file (ffmpeg ebur128). */
export function measureFinalAudio(filePath: string, ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg'): Promise<{finalLufs: number | null; finalTruePeak: number | null}> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ['-nostats', '-hide_banner', '-i', filePath, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 400_000) stderr = stderr.slice(-200_000);
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffmpeg ebur128 exited ${code}`));
      resolve(parseEbur128Summary(stderr));
    });
  });
}

export function parseEbur128Summary(stderr: string): {finalLufs: number | null; finalTruePeak: number | null} {
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const grab = (pattern: RegExp) => {
    const match = summary.match(pattern);
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) ? value : null;
  };
  return {
    finalLufs: grab(/Integrated loudness:[\s\S]*?I:\s+(-?[\d.]+)\s+LUFS/),
    finalTruePeak: grab(/True peak:[\s\S]*?Peak:\s+(-?[\d.]+)\s+dBFS/),
  };
}

function runProbe(argv: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', argv, {cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`remotion probe exited ${code}: ${stderr.slice(-300)}`));
    });
  });
}

export type MixMeasureInput = {
  renderJobId: string;
  remotionRoot: string;
  agentsDir: string;
  finalPath: string;
  durationSec: number;
  videoUrl: string;
  keepSegments?: Array<{sourceStart: number; sourceEnd: number; outputStart: number}>;
  audioDesign?: {
    musicUrl?: string;
    musicFullUrl?: string;
    musicLoopUrl?: string;
    musicCarvedUrl?: string;
    musicFullDurationSec?: number;
    musicSource?: 'licensed' | 'generated';
    duck?: DuckLike & {voLufs?: number; bedLufs?: number; speechDb?: number} & Record<string, unknown>;
  };
  blueprintId?: string;
};

/** Flag-gated. Never throws: a failed probe logs music.mix_measure_failed and the render carries on. */
export async function runMixMeasure(input: MixMeasureInput, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!mixMeasureEnabled(env)) return;
  const outDir = path.join(input.remotionRoot, 'out');
  const files: string[] = [];
  try {
    const duck = input.audioDesign?.duck;
    const bedUrl = input.audioDesign?.musicUrl;
    if (!duck || !bedUrl) return;
    const windows = mixWindows(duck);
    const stems = {bed: path.join(outDir, `${input.renderJobId}.mixprobe-bed.wav`), vo: path.join(outDir, `${input.renderJobId}.mixprobe-vo.wav`)};
    for (const stem of ['bed', 'vo'] as const) {
      const propsPath = path.join(outDir, `${input.renderJobId}.mixprobe-${stem}.json`);
      files.push(propsPath, stems[stem]);
      await fs.writeFile(
        propsPath,
        JSON.stringify({stem, bedUrl, ...(bedSpecFor(input.audioDesign) ? {bedSpec: bedSpecFor(input.audioDesign)} : {}), voUrl: input.videoUrl, duck, durationSec: input.durationSec, ...(input.keepSegments?.length ? {voSegments: input.keepSegments} : {})}),
      );
      const argv = buildMixProbeArgv({stem, outPath: stems[stem], propsPath}, env);
      if (!argv) return;
      await runProbe(argv, input.remotionRoot, 240000);
    }
    const measured = await measureStems({bedPath: stems.bed, voPath: stems.vo, windows, agentsDir: input.agentsDir});
    const finalAudio = await measureFinalAudio(input.finalPath);
    // The gap the envelope was asked for, so a shortfall is visible next to the measured one.
    const intendedSpeechGapLu =
      typeof duck.voLufs === 'number' && typeof duck.bedLufs === 'number' && typeof duck.speechDb === 'number' ? round1(duck.voLufs - (duck.bedLufs + duck.speechDb)) : null;
    const speechGapShortfallLu = intendedSpeechGapLu !== null && measured.speechGapLu !== null ? round1(intendedSpeechGapLu - measured.speechGapLu) : null;
    if (measured.bedOverVoiceWindows > 0) {
      log.warn({blueprintId: input.blueprintId, bedOverVoiceWindows: measured.bedOverVoiceWindows, minSpeechWindowGapLu: measured.minSpeechWindowGapLu, thresholdLu: VOICE_FIGHT_LU}, 'music.voice_fight');
    }
    log.info({blueprintId: input.blueprintId, ...measured, intendedSpeechGapLu, speechGapShortfallLu, ...finalAudio, speechWindows: windows.speech.length, pauseWindows: windows.pause.length, holdSec: duck.holdSec, releaseSec: duck.releaseSec, pauses: describePauses(duck)}, 'music.mix_measured');
  } catch (error) {
    log.warn({blueprintId: input.blueprintId, reason: error instanceof Error ? error.message.slice(0, 300) : 'mix_measure'}, 'music.mix_measure_failed');
  } finally {
    await Promise.all(files.map(file => fs.rm(file, {force: true}).catch(() => undefined)));
  }
}
