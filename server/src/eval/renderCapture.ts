/**
 * Render a blueprint produced by the real pipeline with the real Remotion composition and capture what the renderer was given and
 * what it wrote (offline tooling; not imported by production code). Uses `remotion still` (one frame, headless Chrome) so a test can
 * prove the blueprint -> renderer boundary without a full encode or an upload. The full-video path (`renderLocally`) additionally
 * prefetches assets, encodes with ffmpeg and uploads to object storage; that path is NOT exercised here.
 */
import {execFileSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import type {RenderCapture} from './runCapture.ts';

const REMOTION = resolve(dirname(fileURLToPath(import.meta.url)), '../../../remotion');

export const DEFAULT_RENDER_STYLE = {
  captionTemplate: 'karaoke', layoutStyle: 'fullscreen', captionBottomFrac: 0.2, captionCenterXFrac: 0.5,
  brollEnabled: true, zoomEnabled: true, trimEnabled: true, colorGradeLut: '',
} as const;

export function renderBlueprintStill(input: {
  blueprint: unknown;
  style?: Record<string, unknown>;
  /** Directory served as Remotion's public dir (so `staticFile:` URLs resolve). */
  publicDir: string;
  /** Scratch directory for the props file and the output. */
  workDir: string;
  outName: string;
  frame: number;
  now?: () => Date;
}): RenderCapture {
  const now = input.now ?? (() => new Date());
  // Props exactly as production hands them to Remotion ({blueprint, style}); no schema defaults are filled in here.
  const props = {blueprint: input.blueprint as {fps: number; width: number; height: number}, style: input.style ?? DEFAULT_RENDER_STYLE};
  mkdirSync(input.workDir, {recursive: true});
  const propsPath = join(input.workDir, `${input.outName}.props.json`);
  const outPath = join(input.workDir, `${input.outName}.png`);
  writeFileSync(propsPath, JSON.stringify(props));
  const startedAt = now().toISOString();
  let status: RenderCapture['status'] = 'ok';
  try {
    execFileSync('npx', ['remotion', 'still', 'src/index.ts', 'ShortVideo', outPath, `--props=${propsPath}`, `--frame=${input.frame}`, `--public-dir=${input.publicDir}`], {cwd: REMOTION, stdio: 'pipe', timeout: 180_000});
  } catch {
    status = 'failed';
  }
  return {
    engine: 'remotion-still', codec: 'png', fps: props.blueprint.fps, width: props.blueprint.width, height: props.blueprint.height,
    outputs: status === 'ok' ? [{kind: 'render_still', path: outPath}] : [], startedAt, endedAt: now().toISOString(), status,
  };
}
