/**
 * Deterministic Tier-1 delivery execution.
 *
 * Builds a shaped A/V proxy directly from the original source. Video and audio
 * use the same piecewise map. Audio boundaries use 10ms acrossfades; video
 * uses matching micro-crossfades. FFmpeg `atempo` preserves pitch.
 */

import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';

import {env} from '../../config/env.ts';
import {EngineError} from '../../lib/errors.ts';
import {stageLogger} from '../../lib/logger.ts';
import {
  DELIVERY_PRESET_PARAMS,
  type DeliveryOperation,
  type DeliveryPreset,
  type LoudnessStats,
} from '../../lib/deliveryShaping.ts';
import type {TimeRemap} from '../../lib/timeRemap.ts';
import {measureLoudness} from './deliveryAcoustics.ts';

const log = stageLogger('delivery-renderer');

export async function renderDeliveryShaping(input: {
  sourcePath: string;
  outputPath: string;
  map: TimeRemap;
  ops: DeliveryOperation[];
  preset: DeliveryPreset;
  fps: number;
}): Promise<{path: string; loudnessAfter: LoudnessStats}> {
  if (input.map.segments.length === 0) {
    throw new EngineError('render_failed', 'Delivery shaping removed the whole source');
  }
  const filter = buildDeliveryFilter(input);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input.sourcePath,
    '-filter_complex',
    filter.graph,
    '-map',
    `[${filter.videoLabel}]`,
    '-map',
    `[${filter.audioLabel}]`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(input.fps),
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    input.outputPath,
  ];
  const started = Date.now();
  await run(env.FFMPEG_PATH, args, 12 * 60_000);
  const stat = await fs.stat(input.outputPath).catch(() => null);
  if (!stat || stat.size < 1) {
    throw new EngineError('render_failed', 'Delivery shaping produced an empty file');
  }
  const targetLufs = targetLoudness(input.ops, input.preset);
  let loudnessAfter = await measureLoudness(input.outputPath);
  if (Math.abs(loudnessAfter.integratedLufs - targetLufs) > 0.5) {
    await correctLoudness({
      path: input.outputPath,
      targetLufs,
      measuredLufs: loudnessAfter.integratedLufs,
      limiterDbtp: DELIVERY_PRESET_PARAMS[input.preset].limiterDbtp,
    });
    loudnessAfter = await measureLoudness(input.outputPath);
  }
  if (loudnessAfter.truePeakDbtp > -1) {
    throw new EngineError(
      'render_failed',
      `Delivery shaping exceeded the -1 dBTP ceiling (${loudnessAfter.truePeakDbtp} dBTP)`,
    );
  }
  log.info(
    {
      ms: Date.now() - started,
      bytes: stat.size,
      segments: input.map.segments.length,
      outputSec: input.map.outputDurationSec,
      loudnessAfter,
    },
    'delivery shaping proxy rendered',
  );
  return {path: input.outputPath, loudnessAfter};
}

export function buildDeliveryFilter(input: {
  map: TimeRemap;
  ops: DeliveryOperation[];
  preset: DeliveryPreset;
  fps: number;
}): {graph: string; videoLabel: string; audioLabel: string} {
  const filters: string[] = [];
  const durations: number[] = [];
  input.map.segments.forEach((segment, index) => {
    const duration = Math.max(0.02, segment.outputEnd - segment.outputStart);
    durations.push(duration);
    if (segment.kind === 'pause') {
      const sourceAt = Math.max(0, segment.sourceStart);
      const oneFrame = 1 / Math.max(1, input.fps);
      filters.push(
        `[0:v]trim=start=${fmt(sourceAt)}:end=${fmt(sourceAt + oneFrame)},` +
          `setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${fmt(duration)},` +
          `trim=duration=${fmt(duration)},setpts=PTS-STARTPTS[v${index}]`,
      );
      const fill = pauseFillAt(input.ops, sourceAt);
      if (fill === 'room_tone') {
        const roomEnd = Math.min(
          input.map.sourceDurationSec,
          Math.max(0.08, sourceAt),
        );
        const roomStart = Math.max(0, roomEnd - 0.08);
        filters.push(
          `[0:a]atrim=start=${fmt(roomStart)}:end=${fmt(roomEnd)},` +
            `asetpts=PTS-STARTPTS,aresample=48000,volume=0.32,` +
            `aloop=loop=-1:size=3840,atrim=duration=${fmt(duration)},` +
            `afade=t=in:d=0.01,afade=t=out:st=${fmt(Math.max(0, duration - 0.01))}:d=0.01[a${index}]`,
        );
      } else {
        filters.push(
          `anullsrc=r=48000:cl=stereo,atrim=duration=${fmt(duration)}[a${index}]`,
        );
      }
      return;
    }

    const gain = gainAt(input.ops, (segment.sourceStart + segment.sourceEnd) / 2);
    const gainFilter =
      Math.abs(gain.db) > 0.01
        ? `,volume='if(isnan(t),1,pow(10,(${fmt(
            gain.db,
          )}*min(1,min(t/${fmt(
            Math.max(0.005, gain.attackSec),
          )},(${fmt(duration)}-t)/${fmt(
            Math.max(0.01, gain.releaseSec),
          )})))/20))':eval=frame`
        : '';
    filters.push(
      `[0:v]trim=start=${fmt(segment.sourceStart)}:end=${fmt(segment.sourceEnd)},` +
        `setpts=(PTS-STARTPTS)/${fmt(segment.rate)}[v${index}]`,
    );
    filters.push(
      `[0:a]atrim=start=${fmt(segment.sourceStart)}:end=${fmt(segment.sourceEnd)},` +
        `asetpts=PTS-STARTPTS,aresample=48000,atempo=${fmt(segment.rate)}` +
        `${gainFilter}[a${index}]`,
    );
  });

  let videoLabel = 'v0';
  let audioLabel = 'a0';
  let accumulated = durations[0] ?? 0;
  for (let index = 1; index < input.map.segments.length; index += 1) {
    const previous = input.map.segments[index - 1]!;
    const current = input.map.segments[index]!;
    const mappedOverlap = Math.max(0, previous.outputEnd - current.outputStart);
    const fade = Math.min(
      mappedOverlap,
      accumulated / 2,
      (durations[index] ?? 0) / 2,
    );
    const nextVideo = `vx${index}`;
    const nextAudio = `ax${index}`;
    if (fade >= 0.001) {
      const offset = Math.max(0, accumulated - fade);
      filters.push(
        `[${videoLabel}][v${index}]xfade=transition=fade:duration=${fmt(
          fade,
        )}:offset=${fmt(offset)}[${nextVideo}]`,
      );
      filters.push(
        `[${audioLabel}][a${index}]acrossfade=d=${fmt(
          fade,
        )}:c1=tri:c2=tri[${nextAudio}]`,
      );
    } else {
      filters.push(
        `[${videoLabel}][v${index}]concat=n=2:v=1:a=0[${nextVideo}]`,
      );
      filters.push(
        `[${audioLabel}][a${index}]concat=n=2:v=0:a=1[${nextAudio}]`,
      );
    }
    videoLabel = nextVideo;
    audioLabel = nextAudio;
    accumulated += (durations[index] ?? 0) - fade;
  }

  const presetDefaults = DELIVERY_PRESET_PARAMS[input.preset];
  const dynamics = input.ops.find(op => op.op === 'dynamics_chain');
  const preset = {
    ...presetDefaults,
    targetLufs: finiteNumber(
      dynamics?.params.targetLufs,
      presetDefaults.targetLufs,
    ),
    compressorThresholdDb: finiteNumber(
      dynamics?.params.compressorThresholdDb,
      presetDefaults.compressorThresholdDb,
    ),
    compressorRatio: finiteNumber(
      dynamics?.params.compressorRatio,
      presetDefaults.compressorRatio,
    ),
    highPassHz: finiteNumber(
      dynamics?.params.highPassHz,
      presetDefaults.highPassHz,
    ),
    presenceDb: finiteNumber(
      dynamics?.params.presenceDb,
      presetDefaults.presenceDb,
    ),
    deesserAmount: finiteNumber(
      dynamics?.params.deesserAmount,
      presetDefaults.deesserAmount,
    ),
    limiterDbtp: Math.min(
      -1.2,
      finiteNumber(dynamics?.params.limiterDbtp, presetDefaults.limiterDbtp),
    ),
  };
  const finalAudio = 'delivery_audio';
  const limiterLinear = 10 ** (Math.min(-1, preset.limiterDbtp) / 20);
  filters.push(
    `[${audioLabel}]highpass=f=${fmt(preset.highPassHz)},` +
      `equalizer=f=3500:t=q:w=1:g=${fmt(preset.presenceDb)},` +
      `deesser=i=${fmt(preset.deesserAmount)}:m=0.5:f=0.5,` +
      `acompressor=threshold=${fmt(preset.compressorThresholdDb)}dB:` +
      `ratio=${fmt(preset.compressorRatio)}:attack=20:release=180:makeup=1,` +
      `loudnorm=I=${fmt(preset.targetLufs)}:TP=${fmt(preset.limiterDbtp)}:LRA=11,` +
      `alimiter=limit=${fmt(limiterLinear)}:level=false[${finalAudio}]`,
  );
  return {graph: filters.join(';'), videoLabel, audioLabel: finalAudio};
}

function gainAt(
  ops: DeliveryOperation[],
  at: number,
): {db: number; attackSec: number; releaseSec: number} {
  const active = ops.filter(
    op => op.op === 'gain_automation' && at >= op.start && at <= op.end,
  );
  return {
    db: clamp(
      active.reduce((sum, op) => sum + Number(op.params.gainDb ?? 0), 0),
      -4,
      4,
    ),
    attackSec: Math.max(
      0.005,
      Number(active[0]?.params.attackMs ?? 30) / 1000,
    ),
    releaseSec: Math.max(
      0.01,
      Number(active[0]?.params.releaseMs ?? 120) / 1000,
    ),
  };
}

function pauseFillAt(
  ops: DeliveryOperation[],
  at: number,
): 'room_tone' | 'silence' {
  const op = ops.find(
    item => item.op === 'insert_pause' && Math.abs(item.start - at) < 0.02,
  );
  return op?.params.fill === 'silence' ? 'silence' : 'room_tone';
}

function run(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
      if (stderr.length > 20_000) {
        stderr = stderr.slice(-10_000);
      }
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new EngineError('upstream_timeout', 'Delivery shaping FFmpeg timed out'));
    }, timeoutMs);
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new EngineError('render_failed', `Delivery shaping FFmpeg failed (${code})`, {
            stderr: stderr.slice(-2_000),
          }),
        );
      }
    });
  });
}

async function correctLoudness(input: {
  path: string;
  targetLufs: number;
  measuredLufs: number;
  limiterDbtp: number;
}): Promise<void> {
  const correctionDb = clamp(
    input.targetLufs - input.measuredLufs,
    -6,
    6,
  );
  const temp = `${input.path}.loudness.mp4`;
  const limiterLinear = 10 ** (Math.min(-1.2, input.limiterDbtp) / 20);
  try {
    await run(
      env.FFMPEG_PATH,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        input.path,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0',
        '-c:v',
        'copy',
        '-af',
        `volume=${fmt(
          correctionDb,
        )}dB,alimiter=limit=${fmt(limiterLinear)}:level=false`,
        '-c:a',
        'aac',
        '-b:a',
        '160k',
        '-movflags',
        '+faststart',
        temp,
      ],
      4 * 60_000,
    );
    await fs.rename(temp, input.path);
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
}

function targetLoudness(
  ops: DeliveryOperation[],
  preset: DeliveryPreset,
): number {
  const dynamics = ops.find(op => op.op === 'dynamics_chain');
  return clamp(
    finiteNumber(
      dynamics?.params.targetLufs,
      DELIVERY_PRESET_PARAMS[preset].targetLufs,
    ),
    -18,
    -12,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fmt(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
