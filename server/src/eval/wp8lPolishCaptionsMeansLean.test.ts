/**
 * WP8L tests: on polish, a captions-only edit list (what the HTTP route and the CLI hand over for "no edits named") means the polish default, never captions-only. This is the Gate 2 failure
 * mode: the Director's visual toolkits stayed off, so the edit had captions and one library graphic. Pure tests with the real entry-point resolver, plus source pins. No network, no render.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {
  defaultRequestedEdits,
  isCaptionsOnlyEdits,
  parseEditAllowlist,
  POLISH_LEAN_EDITS,
  polishRequestedEdits,
  resolvePipelineEdits,
  visualToolkitsRequested,
} from '../lib/editToolkits.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const LEAN = [...POLISH_LEAN_EDITS];

describe('the pure table', () => {
  it('polish + omitted / empty / captions-only (any spelling) -> the polish lean list', () => {
    for (const input of [undefined, [], [''], ['captions'], ['Captions'], ['CAPTIONS'], [' captions '], ['caption'], ['captions,captions'], ['captions', 'captions'], ['caption_style']]) {
      expect(polishRequestedEdits(input as never), JSON.stringify(input)).toEqual(LEAN);
    }
  });
  it('POLISH_DEFAULT_EDITS=all expands the same inputs to every toolkit instead', () => {
    for (const input of [undefined, [], ['captions'], ['Captions']]) expect(polishRequestedEdits(input as never, 'all'), JSON.stringify(input)).toBeNull();
  });
  it('explicit lists are untouched: [captions, zoom], [zoom], [cutaway], a captions + anything mix', () => {
    expect(polishRequestedEdits(['captions', 'zoom'])).toEqual(['captions', 'zoom']);
    expect(polishRequestedEdits(['captions,zoom'])).toEqual(['captions', 'zoom']);
    expect(polishRequestedEdits(['zoom'])).toEqual(['zoom']);
    expect(polishRequestedEdits(['cutaway'])).toEqual(['cutaway']);
    expect(polishRequestedEdits(['captions', 'delivery_shaping'])).toEqual(['captions', 'delivery_shaping']);
    for (const input of [['captions', 'zoom'], ['zoom'], ['cutaway']]) expect(polishRequestedEdits(input, 'all')).toEqual(input);
  });
  it('every toolkit stays every toolkit: null (--full-edits) and "all"', () => {
    expect(polishRequestedEdits(null)).toBeNull();
    expect(polishRequestedEdits(null, 'all')).toBeNull();
    expect(polishRequestedEdits(['all'])).toBeNull();
    expect(polishRequestedEdits(['ALL'])).toBeNull();
    expect(polishRequestedEdits(['captions', 'all'])).toBeNull();
  });
  it('the singleton test itself', () => {
    expect(isCaptionsOnlyEdits(['captions'])).toBe(true);
    expect(isCaptionsOnlyEdits(['Caption'])).toBe(true);
    for (const input of [['captions', 'zoom'], ['zoom'], [], [''], null, undefined, ['all'], ['nonsense']]) expect(isCaptionsOnlyEdits(input as never), JSON.stringify(input)).toBe(false);
  });
  it('the expanded list turns the visual Director on; the captions-only list did not (the Gate 2 failure)', () => {
    expect(visualToolkitsRequested(['captions'])).toBe(false);
    expect(visualToolkitsRequested(polishRequestedEdits(['captions']))).toBe(true);
  });
  it('cuts, mvp and legacy keep the generic default: captions-only stays captions-only (no polish function is applied to them)', () => {
    expect(defaultRequestedEdits(['captions'], 'lean')).toEqual(['captions']);
    expect(defaultRequestedEdits(['Captions'], 'lean')).toEqual(['Captions']);
    expect(defaultRequestedEdits(undefined, 'lean')).toEqual(['captions']);
    expect(defaultRequestedEdits(['all'], 'lean')).toBeNull();
    expect(defaultRequestedEdits(null, 'lean')).toBeNull();
  });
});

describe('the real entry points: what the HTTP route and the CLI hand to analyze', () => {
  it('"no edits named" is resolved to ["captions"] by BOTH entry points, and polish expands exactly that', () => {
    const http = resolvePipelineEdits({...parseEditAllowlist(undefined), pipelineMode: 'lean'});
    const cli = resolvePipelineEdits({...parseEditAllowlist(undefined), fullEdits: false, pipelineMode: 'lean'});
    expect(http).toEqual(['captions']);
    expect(cli).toEqual(['captions']);
    expect(polishRequestedEdits(http)).toEqual(LEAN);
    expect(polishRequestedEdits(cli)).toEqual(LEAN);
  });
  it('--full-edits and --edits=all reach analyze as null and stay every toolkit; an explicit list stays itself', () => {
    expect(polishRequestedEdits(resolvePipelineEdits({...parseEditAllowlist(undefined), fullEdits: true, pipelineMode: 'lean'}))).toBeNull();
    expect(polishRequestedEdits(resolvePipelineEdits({...parseEditAllowlist(['all']), pipelineMode: 'lean'}))).toBeNull();
    expect(polishRequestedEdits(resolvePipelineEdits({...parseEditAllowlist(['zoom,card']), pipelineMode: 'lean'}))?.sort()).toEqual(['card', 'zoom']);
  });
  it('a pipeline mode of full already means every toolkit before polish sees it', () => {
    expect(polishRequestedEdits(resolvePipelineEdits({...parseEditAllowlist(undefined), pipelineMode: 'full'}))).toBeNull();
  });
});

describe('source pins: the Gate 2 failure cannot recur', () => {
  it('analyzeVideo uses the polish resolver on polish (so a captions-only list is expanded) and says so once', () => {
    const analyze = read('server/src/pipeline/analyzeVideo.ts');
    expect(analyze).toContain("const requestedEdits = input.editProfile === 'polish' ? polishRequestedEdits(input.requestedEdits, env.POLISH_DEFAULT_EDITS) : defaultRequestedEdits(input.requestedEdits, env.PIPELINE_MODE);");
    expect(analyze).toContain("if (input.editProfile === 'polish' && isCaptionsOnlyEdits(input.requestedEdits)) {");
    expect(analyze).toContain("'polish_edits_expanded:captions_to_all' : 'polish_edits_expanded:captions_to_lean'");
    expect(analyze.indexOf('polish_edits_expanded')).toBeLessThan(analyze.indexOf("const requestedEdits = input.editProfile === 'polish'"));
  });
  it('the resolver itself expands the singleton before its explicit-list branch', () => {
    const toolkits = read('server/src/lib/editToolkits.ts');
    expect(toolkits.indexOf('if (isCaptionsOnlyEdits(requested)) {')).toBeGreaterThan(toolkits.indexOf('export function polishRequestedEdits('));
    expect(toolkits.indexOf('if (isCaptionsOnlyEdits(requested)) {')).toBeLessThan(toolkits.indexOf("if (requested === null || explicit !== null || (requested ?? []).some(value => value.trim())) {"));
  });
  it('the HTTP runner hashes the expanded list through the same resolver (re-pinned WP8I behaviour); the CLI fingerprint does too', () => {
    const runner = read('server/src/pipeline/analysisRunner.ts');
    expect(runner).toContain("const polishEdits = editProfile === 'polish' ? polishRequestedEdits(input.requestedEdits, env.POLISH_DEFAULT_EDITS) : undefined;");
    expect(runner).toContain("requestedEdits: editProfile === 'polish' ? (polishEdits === null ? 'all' : (polishEdits ?? []).slice().sort().join(',')) : (input.requestedEdits ?? []).slice().sort().join(','),");
    const first = read('server/src/scripts/firstVideo.ts');
    expect(first).toContain("requestedEdits: editProfile === 'polish' ? (polishRequestedEdits(requestedEdits, env.POLISH_DEFAULT_EDITS) ?? ['all']).slice().sort().join(',') : (requestedEdits ?? []).slice().sort().join(','),");
  });
  it('a captions-only and an omitted polish request now share one cache key input; cuts is not expanded', () => {
    expect([...(polishRequestedEdits(['captions']) ?? [])].sort().join(',')).toBe([...(polishRequestedEdits(undefined) ?? [])].sort().join(','));
    expect(read('server/src/pipeline/analyzeVideo.ts')).toContain(': defaultRequestedEdits(input.requestedEdits, env.PIPELINE_MODE);');
  });
  it('the CLI help says so, and MOTION_GRAPHICS_ENABLED still defaults off', () => {
    expect(read('server/src/scripts/firstVideo.ts')).toContain('On polish, omitting --edits (the default captions-only lean) uses POLISH_LEAN_EDITS');
    expect(read('server/src/config/env.ts')).toContain('MOTION_GRAPHICS_ENABLED: bool(false),');
    expect(read('server/src/config/env.ts')).toContain("PRODUCT_EDIT_PROFILE: str('cuts'),");
  });
});
