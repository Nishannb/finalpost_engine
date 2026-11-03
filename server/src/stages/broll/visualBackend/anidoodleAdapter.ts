/**
 * WP53 anidoodle adapter — INTERFACE + SKIP only (Apache-2.0 engine is never vendored, ~48k files). Skipped when POLISH_ANIDOODLE is off or ANIDOODLE_ENGINE_ROOT is unset/missing. This WP authors no anidoodle films.
 * When configured, a later job spawns the engine's own renderer with the score discarded (no music, no SFX, ever):
 *   node <root>/tools/render.mjs <film> --out <mp4>      then strip audio:  ffmpeg -i <mp4> -an -c:v copy <silent.mp4>
 * Style is a prop from the professional allowlist only (cut-paper | pencil-watercolor | isometric | risograph | marker-comic | pixel | chalkboard | cyanotype); default cut-paper.
 */
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {DOODLE_STYLE_ALLOWLIST, DOODLE_DEFAULT_STYLE, type DoodleStyle} from './planVisualBackendBeats.ts';

export function resolveAnidoodleRoot(configured?: string): string | null {
  const root = configured?.trim() ? resolve(configured.trim()) : '';
  return root && existsSync(join(root, 'tools/render.mjs')) ? root : null;
}

export function isAllowedDoodleStyle(style: string): style is DoodleStyle {
  return (DOODLE_STYLE_ALLOWLIST as readonly string[]).includes(style);
}

export function safeDoodleStyle(style: string | undefined): DoodleStyle {
  return style && isAllowedDoodleStyle(style) ? style : DOODLE_DEFAULT_STYLE;
}

export type AnidoodleResult = {ok: false; reason: 'anidoodle:unconfigured' | 'anidoodle:flag_off' | 'anidoodle:not_implemented'};

export function anidoodleRenderArgs(root: string, film: string, out: string): string[] {
  return [join(root, 'tools/render.mjs'), film, '--out', out];
}

/** Analyze-safe: never spawns. Unconfigured -> skipped; configured -> films are not authored in this WP, so also not rendered. */
export function prepareAnidoodle(options: {flagOn: boolean; root?: string}): AnidoodleResult {
  if (!options.flagOn) return {ok: false, reason: 'anidoodle:flag_off'};
  return resolveAnidoodleRoot(options.root) ? {ok: false, reason: 'anidoodle:not_implemented'} : {ok: false, reason: 'anidoodle:unconfigured'};
}
