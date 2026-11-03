/**
 * Accepted-but-ignored guard: every v2 element parameter the Director schema accepts must have a consumer, or be listed here
 * with the reason it is intentionally unused. A new accepted parameter nobody reads fails this test.
 */
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {classifyReason} from '../lib/reasonRegistry.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'eval' && name !== 'node_modules') {
        sources(full, out);
      }
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Parameters that are parsed but intentionally not applied to every kind they could appear on. */
const INTENTIONALLY_PARTIAL: Record<string, string> = {
  transitionSec: 'read for frame_inset only; a transition element takes its timing from its word range (start/end)',
};

describe('every accepted v2 element parameter has a consumer', () => {
  const typesText = readFileSync(join(src, 'stages/directorV2/types.ts'), 'utf8');
  const keys = [...(/export type ElementParams = \{([\s\S]*?)\n\};/.exec(typesText)![1]!).matchAll(/^\s+(\w+)\??:/gm)].map(match => match[1]!);
  const parserFiles = new Set(['stages/directorV2/types.ts', 'stages/directorV2/creativeDirector.ts', 'stages/directorV2/schemas.ts']);
  const consumers = sources(src).filter(file => !parserFiles.has(relative(src, file)));

  it('has a non-trivial parameter list', () => {
    expect(keys.length).toBeGreaterThan(30);
  });

  it.each(keys)('%s is read somewhere after parsing (or is listed as intentionally partial)', key => {
    const read = consumers.some(file => new RegExp(`\\b${key}\\b`).test(readFileSync(file, 'utf8')));
    expect(read || key in INTENTIONALLY_PARTIAL, `${key} is accepted by the Director schema but nothing reads it`).toBe(true);
  });
});

describe('the reasons used to report these cases are registered', () => {
  it.each(['transition_has_no_asset_so_TransitionTrack_skips_it', 'accepted_but_not_handed_to_renderer', 'no_keyed_speaker_video', 'stock_disabled_or_unconfigured', 'needs_speaker_mask', 'text_missing', 'focus_without_visual_evidence'])('%s', reason => {
    expect(classifyReason(reason).registered).toBe(true);
  });
});
