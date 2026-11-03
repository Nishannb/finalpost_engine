import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {visualOverlaySchema} from '../../../../remotion/src/blueprintSchema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const overlay = (extra: Record<string, unknown> = {}) => ({start: 4, end: 9, layout: 'split', mediaKind: 'image', keyword: 'k', overlayText: '', assetUrl: 'a.png', provider: 'pexels', providerId: 1, width: 900, height: 1200, credit: '', creditUrl: '', ...extra});

describe('slideshow transition contract', () => {
  it('accepts crossfade and defaults to it', () => {
    expect(visualOverlaySchema.parse(overlay({slideTransition: 'crossfade'})).slideTransition).toBe('crossfade');
    expect(visualOverlaySchema.parse(overlay()).slideTransition).toBe('crossfade');
  });

  it('refuses ken_burns explicitly: it was accepted and silently rendered as the same crossfade', () => {
    const result = visualOverlaySchema.safeParse(overlay({slideTransition: 'ken_burns'}));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error!.issues)).toContain('slideTransition');
  });

  it('the Phase 11 hand-built evidence blueprint that used ken_burns is unchanged on disk and is now refused by the schema', () => {
    const props = JSON.parse(readFileSync(join(here, '../../../../remotion/out/phase11-validation/props/slideshow_kenburns.json'), 'utf8'));
    expect(props.blueprint.visualOverlays[0].slideTransition).toBe('ken_burns');
    expect(visualOverlaySchema.safeParse(props.blueprint.visualOverlays[0]).success).toBe(false);
  });

  it('the planner only ever emits crossfade for a slideshow (no producer can create the removed value)', () => {
    const planner = readFileSync(join(here, 'brollPlanner.ts'), 'utf8');
    expect([...planner.matchAll(/slideTransition:\s*'([a-z_]+)'/g)].map(match => match[1])).toEqual(['crossfade']);
  });
});
