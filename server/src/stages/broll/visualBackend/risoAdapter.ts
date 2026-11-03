/**
 * WP53 riso adapter: eian-riso-broll (owner-authorized, vendored at runtime into vendor/eian-riso-broll, see vendor/NOTICE-eian-riso.md). It turns a planned `riso` beat into a grounded composition HTML (the template with its
 * top `const DATA = {...}` replaced) and, ONLY when asked (`renderRisoDraft`, VISUAL_BACKEND_RENDER=1 or an explicit script), runs
 *   node <root>/scripts/render.mjs <html> --draft -o <out.mp4>
 * (silent 1080x1920 H.264; `--alpha` ProRes 4444 is optional, off by default, never used by the pipeline proof). Analyze never renders: it only reads the cache `remotion/out/visual-backend-cache/<hash>.mp4`.
 * Missing root / Chrome / ffmpeg -> `{ok:false, reason:'riso:unavailable'}`; nothing here throws into analyze.
 */
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {RisoPayload, VisualBackendBeat} from './planVisualBackendBeats.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** server/src/stages/broll/visualBackend -> repo root */
export const REPO_ROOT = resolve(HERE, '../../../../..');
export const VISUAL_BACKEND_CACHE_DIR = join(REPO_ROOT, 'remotion/out/visual-backend-cache');

export type RisoResult = {ok: true; path: string} | {ok: false; reason: 'riso:unavailable' | 'riso:render_failed' | 'riso:bad_template'; detail?: string};

/** EIAN_RISO_ROOT, else vendor/eian-riso-broll. Returns null when neither has scripts/render.mjs + templates/. */
export function resolveRisoRoot(configured?: string): string | null {
  const candidates = [configured?.trim() ? resolve(configured.trim()) : null, join(REPO_ROOT, 'vendor/eian-riso-broll')].filter((p): p is string => Boolean(p));
  return candidates.find(root => existsSync(join(root, 'scripts/render.mjs')) && existsSync(join(root, 'templates'))) ?? null;
}

export function risoPayloadOf(beat: Pick<VisualBackendBeat, 'payload'>): RisoPayload | null {
  return beat.payload.kind === 'riso' ? beat.payload : null;
}

/** Cache key = hash(templateId + DATA + palette + duration). */
export function risoCacheKey(beat: Pick<VisualBackendBeat, 'templateId' | 'payload'>): string {
  const payload = risoPayloadOf(beat);
  const body = JSON.stringify({templateId: beat.templateId, data: payload?.data ?? null, palette: payload?.palette ?? null, duration: (payload?.data as {duration?: number} | undefined)?.duration ?? null});
  return createHash('sha256').update(body).digest('hex').slice(0, 24);
}

export function risoCachePath(beat: Pick<VisualBackendBeat, 'templateId' | 'payload'>, cacheDir = VISUAL_BACKEND_CACHE_DIR): string {
  return join(cacheDir, `${risoCacheKey(beat)}.mp4`);
}

/** The cached render for this beat, or '' (analyze never renders; assetUrl stays empty and is never uploaded). */
export function cachedRisoAsset(beat: Pick<VisualBackendBeat, 'templateId' | 'payload'>, cacheDir = VISUAL_BACKEND_CACHE_DIR): string {
  const path = risoCachePath(beat, cacheDir);
  return existsSync(path) ? path : '';
}

const DATA_BLOCK = /const DATA = \{[\s\S]*?\n\};/;

/** Copy templates/<name>.html and swap the top `const DATA` for the grounded one. Throws only on a missing template (callers map it to riso:bad_template). */
export function buildRisoCompositionHtml(root: string, payload: RisoPayload): string {
  const file = join(root, 'templates', `${payload.template}.html`);
  const html = readFileSync(file, 'utf8');
  if (!DATA_BLOCK.test(html)) throw new Error(`no DATA block in ${file}`);
  const literal = `const DATA = ${JSON.stringify(payload.data, null, 2)};`;
  return html.replace(DATA_BLOCK, () => literal);
}

function binaryOnPath(name: string): boolean {
  return (process.env.PATH ?? '').split(':').some(dir => dir && existsSync(join(dir, name)));
}

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function chromeAvailable(): boolean {
  const fromEnv = process.env.CHROME;
  if (fromEnv) return existsSync(fromEnv);
  return CHROME_CANDIDATES.some(existsSync) || ['google-chrome', 'chromium', 'chromium-browser'].some(binaryOnPath);
}

export function risoAvailable(configuredRoot?: string): boolean {
  return resolveRisoRoot(configuredRoot) !== null && chromeAvailable() && binaryOnPath('ffmpeg');
}

/**
 * Render one draft (silent H.264). NOT called from analyze or vitest; use from a script with VISUAL_BACKEND_RENDER=1.
 * `alpha` is optional (ProRes 4444 .mov for overlaying on the talking head); the pipeline proof uses the default silent H.264.
 */
export async function renderRisoDraft(beat: Pick<VisualBackendBeat, 'templateId' | 'payload'>, options: {root?: string; out?: string; alpha?: boolean; timeoutMs?: number} = {}): Promise<RisoResult> {
  const payload = risoPayloadOf(beat);
  if (!payload) return {ok: false, reason: 'riso:bad_template', detail: 'not a riso payload'};
  const root = resolveRisoRoot(options.root);
  if (!root || !chromeAvailable() || !binaryOnPath('ffmpeg')) return {ok: false, reason: 'riso:unavailable'};
  let html: string;
  try {
    html = buildRisoCompositionHtml(root, payload);
  } catch (error) {
    return {ok: false, reason: 'riso:bad_template', detail: error instanceof Error ? error.message : String(error)};
  }
  const key = risoCacheKey(beat);
  const compositionDir = join(root, 'compositions');
  mkdirSync(compositionDir, {recursive: true});
  const composition = join(compositionDir, `fp-${key}.html`);
  writeFileSync(composition, html);
  const out = options.out ?? join(VISUAL_BACKEND_CACHE_DIR, `${key}${options.alpha ? '.mov' : '.mp4'}`);
  mkdirSync(dirname(out), {recursive: true});
  const args = [join(root, 'scripts/render.mjs'), composition, '--draft', ...(options.alpha ? ['--alpha'] : []), '-o', out];
  return new Promise<RisoResult>(done => {
    const child = spawn('node', args, {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => (stderr += String(chunk)));
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? 180_000);
    child.on('error', error => {
      clearTimeout(timer);
      done({ok: false, reason: 'riso:unavailable', detail: error.message});
    });
    child.on('close', code => {
      clearTimeout(timer);
      done(code === 0 && existsSync(out) ? {ok: true, path: out} : {ok: false, reason: 'riso:render_failed', detail: stderr.slice(-500)});
    });
  });
}
