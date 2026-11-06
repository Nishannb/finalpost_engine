/**
 * WP4H pure tests: on the mvp profile with an unmeasured speaker (occupancy source fallback) a directed zoom keeps its times and scale and loses its focus. stages/filters/autoZoom.ts imports
 * only types and ./timeline.ts (pure); analyzeVideo.ts (logger) and the renderer's zoom math are read as text. No render, no model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {dropUnmeasuredZoomFocus} from '../stages/filters/autoZoom.ts';
import type {ZoomTrigger} from '../types/blueprint.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(SRC, '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const zoom = (over: Partial<ZoomTrigger> = {}): ZoomTrigger => ({start: 4, end: 6.4, scale: 1.25, focus: {x: 0.8, y: 0.2}, sentenceIndex: 2, ...over});

describe('mvp with an unmeasured speaker (fallback)', () => {
  it('drops the focus and keeps the zoom: times, scale and sentence index are unchanged', () => {
    const original = zoom();
    const result = dropUnmeasuredZoomFocus([original], {profile: 'mvp', source: 'fallback'});
    expect(result.dropped).toBe(1);
    expect(result.triggers).toEqual([{start: 4, end: 6.4, scale: 1.25, sentenceIndex: 2}]);
    expect('focus' in result.triggers[0]!).toBe(false);
    expect(original.focus).toEqual({x: 0.8, y: 0.2}); // the input is not mutated
  });
  it('counts only zooms that had a focus; a zoom with no focus is the same object', () => {
    const plain = zoom({focus: undefined});
    delete (plain as {focus?: unknown}).focus;
    const withFocus = zoom({start: 9, end: 11});
    const result = dropUnmeasuredZoomFocus([plain, withFocus, zoom({start: 14, end: 16, focus: {x: 0.5, y: 0.5}})], {profile: 'mvp', source: 'fallback'});
    expect(result.dropped).toBe(2);
    expect(result.triggers[0]).toBe(plain);
    expect(result.triggers.map(item => [item.start, item.end, item.scale])).toEqual([[4, 6.4, 1.25], [9, 11, 1.25], [14, 16, 1.25]]);
    expect(result.triggers.every(item => item.focus === undefined)).toBe(true);
  });
  it('no zooms: nothing to drop; zero dropped when none had a focus', () => {
    expect(dropUnmeasuredZoomFocus([], {profile: 'mvp', source: 'fallback'})).toEqual({triggers: [], dropped: 0});
    const plain = zoom();
    delete (plain as {focus?: unknown}).focus;
    expect(dropUnmeasuredZoomFocus([plain], {profile: 'mvp', source: 'fallback'}).dropped).toBe(0);
  });
});

describe('everything else keeps today\'s focus', () => {
  it('a measured speaker (vision) keeps the focus on the same objects', () => {
    const original = zoom();
    const result = dropUnmeasuredZoomFocus([original], {profile: 'mvp', source: 'vision'});
    expect(result.dropped).toBe(0);
    expect(result.triggers[0]).toBe(original);
  });
  it('legacy and an unset profile keep the focus even with a fallback box', () => {
    for (const profile of ['legacy', undefined] as const) {
      const original = zoom();
      const result = dropUnmeasuredZoomFocus([original], {profile, source: 'fallback'});
      expect(result.dropped).toBe(0);
      expect(result.triggers[0]).toBe(original);
    }
  });
  it('an unset source is not treated as unmeasured', () => {
    const original = zoom();
    expect(dropUnmeasuredZoomFocus([original], {profile: 'mvp'}).triggers[0]).toBe(original);
  });
});

describe('the default origin and the VISUAL_CONTEXT_V2 gate are untouched (source text)', () => {
  const timeline = stripComments(read('remotion/src/lib/timeline.ts'));
  const analyze = stripComments(read('server/src/pipeline/analyzeVideo.ts'));
  const zoomSource = stripComments(read('server/src/stages/filters/autoZoom.ts'));
  it('the renderer still grows an un-focused zoom about 50% 32% and the scale and duration come from the trigger', () => {
    expect(timeline).toContain('if (!zoom.focus || zoom.scale <= 1) {');
    expect(read('remotion/src/lib/timeline.ts')).toContain('about 50% 32%');
  });
  it('the focus-evidence gate (VISUAL_CONTEXT_V2) is as before: the resolver call keeps it and the new step runs after it', () => {
    expect(analyze).toContain('...(flags.visualContextV2'); // the job's EffectiveFlags (env unless a style pins it)
    expect(analyze).toContain('const decision = evaluateFocus(broll.visualContext, window, focus);');
    expect(analyze.indexOf('dropUnmeasuredZoomFocus(zoomTriggers')).toBeGreaterThan(analyze.indexOf('zoomTriggers = resolveDirectedZooms({'));
  });
  it('analyzeVideo calls the helper once, with the profile and the occupancy source, and records the warning only when something was dropped', () => {
    expect(analyze.match(/dropUnmeasuredZoomFocus\(/g)).toHaveLength(1);
    expect(analyze).toContain('dropUnmeasuredZoomFocus(zoomTriggers, {profile: input.editProfile, source: occupancy.source});');
    expect(analyze).toContain('zoomTriggers = unmeasuredZoom.triggers;');
    expect(analyze).toContain('if (unmeasuredZoom.dropped > 0) warnings.push(`zoom_focus_unmeasured_dropped:${unmeasuredZoom.dropped}`);');
  });
  it('the helper is pure: autoZoom.ts imports only types and ./timeline.ts, and resolveDirectedZooms is not changed', () => {
    expect([...zoomSource.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1])).toEqual(expect.arrayContaining(['./timeline.ts']));
    expect(zoomSource).not.toMatch(/logger|from '\.\.\/\.\.\/lib\/logger/);
    expect(zoomSource).toContain('let focus = normalizeZoomFocus(zoom.focus);');
    expect(zoomSource).toContain('...(focus ? {focus} : {}),');
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
