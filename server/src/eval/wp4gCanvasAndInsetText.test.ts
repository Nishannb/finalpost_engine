/**
 * WP4G pure tests: a media container's canvasTitle and an inset graphic's text / data.label are held to the transcript on the mvp profile, and an empty inset text draws no fallback words
 * on a blueprint with legibility. stages/broll/legibility.ts and remotion/src/lib/insetText.ts are pure. analyzeVideo.ts (logger) and the Remotion components are read as text.
 * No render, no Chromium, no model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {insetDisplayText} from '../../../remotion/src/lib/insetText.ts';
import {groundCanvasTitles, groundInsetText, isGroundedInTranscript} from '../stages/broll/legibility.ts';
import {PROVENANCE} from '../types/blueprint.ts';
import {provenanceOf, stampProvenance} from '../lib/provenance.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const TRANSCRIPT = 'Today I use Premiere Pro and After Effects to cut my videos, it saves time.';
const container = (canvasTitle: string | undefined) => ({start: 2, end: 6, mode: 'card', canvasColor: '#102030', canvasTitle, canvasTitleColor: '#ffffff', scale: 0.62, cornerRadius: 24, transitionSec: 0.4});
const reveal = (graphic: {text?: string; data?: Record<string, string | number>} | undefined, variant = 'motion_graphic', templateId = 'stat_callout') => ({
  type: 'inset_reveal' as const, start: 3, end: 7, params: {insetScale: 0.6, variant, graphic: graphic && {templateId, enterOffset: 0.2, exitOffset: 0.2, ...graphic}},
});

describe('canvas titles', () => {
  it('a title with a word that was not spoken is cleared; the container, its times and its colours stay', () => {
    const original = container('Recommended Software');
    const result = groundCanvasTitles([original], TRANSCRIPT);
    expect(result.containers).toHaveLength(1);
    expect(result.cleared).toHaveLength(1);
    const next = result.containers[0]!;
    expect(next.canvasTitle).toBe('');
    expect({...next, canvasTitle: original.canvasTitle}).toEqual(original);
    expect(next.canvasTitleColor).toBe('#ffffff');
    expect(next.canvasColor).toBe('#102030');
    expect([next.start, next.end]).toEqual([2, 6]);
    expect(original.canvasTitle).toBe('Recommended Software'); // the input is not mutated
  });
  it('spoken words, an empty title, a blank title and no title stay as the same objects', () => {
    for (const title of ['Premiere Pro', 'save time', 'After Effects!', '', '   ', undefined]) {
      const original = container(title);
      const result = groundCanvasTitles([original], TRANSCRIPT);
      expect(result.containers[0], String(title)).toBe(original);
      expect(result.cleared).toEqual([]);
    }
  });
  it('a title with one spoken and one unspoken word is cleared (all words must be spoken)', () => {
    expect(groundCanvasTitles([container('Premiere Wizardry')], TRANSCRIPT).containers[0]!.canvasTitle).toBe('');
  });
  it('only the offending containers change; order is kept', () => {
    const a = container('Premiere'); const b = container('Zebra'); const c = container('time');
    const result = groundCanvasTitles([a, b, c], TRANSCRIPT);
    expect(result.containers[0]).toBe(a);
    expect(result.containers[1]).not.toBe(b);
    expect(result.containers[2]).toBe(c);
    expect(result.cleared).toHaveLength(1);
  });
  it('provenance is carried onto the rebuilt container', () => {
    const original = stampProvenance(container('Zebra'), {canvasColor: 'director'} as never);
    const next = groundCanvasTitles([original], TRANSCRIPT).containers[0]!;
    expect(provenanceOf(next, 'canvasColor')).toBe(provenanceOf(original, 'canvasColor'));
    expect(PROVENANCE in next).toBe(true);
  });
  it('uses the shared matcher', () => {
    expect(isGroundedInTranscript('Premiere Pro', TRANSCRIPT)).toBe(true);
    const src = stripComments(read('server/src/stages/broll/legibility.ts'));
    const body = src.slice(src.indexOf('export function groundCanvasTitles'), src.indexOf('export function groundInsetText'));
    expect(body).toContain('isGroundedInTranscript(title, transcript)');
    expect(body).not.toMatch(/toLowerCase|split\(|normalize\(/);
  });
});

describe('inset graphic text', () => {
  it('an unspoken text is cleared; the reveal, its times and its template stay', () => {
    const original = reveal({text: 'Master your feelings'}, 'motion_graphic', 'keyword_title');
    const result = groundInsetText([original], TRANSCRIPT);
    expect(result.cleared).toHaveLength(1);
    const next = result.insetReveals[0]!;
    expect(next.params.graphic!.text).toBe('');
    expect(next.params.graphic!.templateId).toBe('keyword_title');
    expect([next.start, next.end, next.type]).toEqual([3, 7, 'inset_reveal']);
    expect(next.params.insetScale).toBe(0.6);
    expect(original.params.graphic!.text).toBe('Master your feelings'); // not mutated
  });
  it('an unspoken data.label is cleared and the other data keys stay; spoken text stays', () => {
    const next = groundInsetText([reveal({text: 'time', data: {label: 'Recommended', value: 42}})], TRANSCRIPT).insetReveals[0]!;
    expect(next.params.graphic!.text).toBe('time');
    expect(next.params.graphic!.data).toEqual({label: '', value: 42});
  });
  it('both unspoken: both cleared, counted once', () => {
    const result = groundInsetText([reveal({text: 'Zebra', data: {label: 'Giraffe'}})], TRANSCRIPT);
    expect(result.cleared).toHaveLength(1);
    expect(result.insetReveals[0]!.params.graphic).toMatchObject({text: '', data: {label: ''}});
  });
  it('spoken words stay (the same object), and an empty field stays empty', () => {
    for (const graphic of [{text: 'Premiere Pro', data: {label: 'time'}}, {text: ''}, {text: '', data: {label: ''}}, {data: {value: 3}}, {text: '   '}]) {
      const original = reveal(graphic);
      const result = groundInsetText([original], TRANSCRIPT);
      expect(result.insetReveals[0], JSON.stringify(graphic)).toBe(original);
      expect(result.cleared).toEqual([]);
    }
  });
  it('a numeric label goes through the same matcher as text', () => {
    expect(groundInsetText([reveal({text: '', data: {label: 5}})], TRANSCRIPT).cleared).toHaveLength(1);
  });
  it('a reveal with no graphic, or a variant that draws no graphic, is untouched', () => {
    const none = reveal(undefined);
    const other = reveal({text: 'Zebra'}, 'plain');
    const result = groundInsetText([none, other], TRANSCRIPT);
    expect(result.insetReveals[0]).toBe(none);
    expect(result.insetReveals[1]).toBe(other);
    expect(result.cleared).toEqual([]);
  });
  it('is never a drop: the same number of reveals comes back', () => {
    const clips = [reveal({text: 'Zebra'}), reveal({text: 'time'}), reveal({text: 'Giraffe', data: {label: 'x'}})];
    expect(groundInsetText(clips, TRANSCRIPT).insetReveals).toHaveLength(3);
  });
});

describe('the fallback words', () => {
  it('on a blueprint with legibility an empty text draws no words', () => {
    expect(insetDisplayText('', 'KEY POINT', true)).toBe('');
    expect(insetDisplayText('', '—', true)).toBe('');
  });
  it('without legibility the fallbacks are exactly as before', () => {
    expect(insetDisplayText('', 'KEY POINT', false)).toBe('KEY POINT');
    expect(insetDisplayText('', '—', false)).toBe('—');
  });
  it('a non-empty text is drawn as written in both cases (including blank-but-truthy text, as before)', () => {
    for (const legible of [true, false]) {
      expect(insetDisplayText('Premiere', 'KEY POINT', legible)).toBe('Premiere');
      expect(insetDisplayText(' ', '—', legible)).toBe(' ');
    }
  });
});

describe('wiring (source text)', () => {
  const analyze = stripComments(read('server/src/pipeline/analyzeVideo.ts'));
  const templates = stripComments(read('remotion/src/insetReveal/templates.tsx'));
  const track = stripComments(read('remotion/src/components/InsetRevealTrack.tsx'));
  const video = stripComments(read('remotion/src/ShortVideo.tsx'));
  it('analyzeVideo calls both once, inside the mvp non-caption-only block, before the shared validator, with the stated warnings and no ledger drop', () => {
    expect(analyze.match(/groundCanvasTitles\(/g)).toHaveLength(1);
    expect(analyze.match(/groundInsetText\(/g)).toHaveLength(1);
    const mvp = analyze.indexOf("input.editProfile === 'mvp' && !captionsOnly");
    const at = analyze.indexOf('groundCanvasTitles(');
    expect(at).toBeGreaterThan(mvp);
    expect(at).toBeLessThan(analyze.indexOf('const finalized = finalizeEdits({'));
    const block = analyze.slice(at, analyze.indexOf('if (!openingSpec) {', at));
    expect(block).toContain('groundCanvasTitles(broll.mediaContainers ?? [], transcription.transcript)');
    expect(block).toContain('groundInsetText(broll.insetReveals ?? [], transcription.transcript)');
    expect(block).toContain('`legibility:ungrounded_canvas_title_cleared:${canvasTitles.cleared.length}`');
    expect(block).toContain('`legibility:ungrounded_inset_text_cleared:${insetText.cleared.length}`');
    expect(block).not.toMatch(/ledger\.drop|\.start\s*=|\.end\s*=/);
  });
  it('the templates draw the fallbacks only through insetDisplayText, with the legible flag', () => {
    expect(templates).toContain("{insetDisplayText(text, '—', Boolean(legible))}");
    expect(templates).toContain("{insetDisplayText(text, 'KEY POINT', Boolean(legible))}");
    expect(templates).not.toMatch(/text \|\| /);
    expect(templates).toContain('legible?: boolean;');
  });
  it('the keyword title keeps its accent bar and the stat keeps its label pill', () => {
    expect(templates).toContain('backgroundColor: accent,\n          borderRadius: 999,\n          height: 6,');
    expect(templates).toContain('{label ? (');
  });
  it('the flag reaches the template from the blueprint: ShortVideo passes legibility presence, the track forwards it', () => {
    expect(video).toContain('legible={Boolean(blueprint.legibility)}');
    expect(track).toContain('legible?: boolean;');
    expect(track).toContain('legible={legible}');
    expect(track).toContain('            legible,\n          })}');
  });
  it('the scorer and the matcher module are untouched by this package', () => {
    expect([...stripComments(read('server/src/stages/broll/groundedText.ts')).matchAll(/^import .*$/gm)]).toEqual([]);
    expect(stripComments(read('server/src/eval/rubricScorer.ts'))).not.toMatch(/groundCanvasTitles|groundInsetText/); // WP4P: the scorer now reads canvasTitle itself, but never calls the writer's functions
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('server/src/config/env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
