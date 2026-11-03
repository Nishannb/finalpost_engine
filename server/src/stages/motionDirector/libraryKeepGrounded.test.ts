/**
 * WP8N tests: Gate 3 ended with no graphic, hook or overlay because the legibility pass removed copy the speaker never said (`legibility:ungrounded_*`), NOT because the speaker box was
 * unmeasured. The real defect was upstream: a Director library brief with invented copy counted as a library hit and so suppressed the transcript seed, then was dropped. These tests
 * simulate that and pin the fix (library-only mode drops ungrounded briefs before the hit count, so the seeds, which are spoken words by construction, survive), and pin that the grounding
 * rule itself does not depend on occupancy. Pure; no network, no model, no render.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {applyLegibility, dropUngroundedGeneratedGraphics, generatedGraphicIsGrounded} from '../broll/legibility.ts';
import {decideMatteGate} from '../../lib/matteGate.ts';
import {EDIT_LOOKS, editLookPromptBlock, enforceEditLook} from '../directorV2/editLooks.ts';
import {addLibrarySeeds} from './libraryFallback.ts';
import {libraryContentKeysPromptBlock} from './libraryRegistry.ts';
import {assembleDirectedGraphics, type MotionDirectorResult, type TimedWord} from './motionDirector.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(ROOT, ...parts), 'utf8');

function timed(parts: string[], startSec = 0.4): {words: TimedWord[]; transcript: string; duration: number} {
  const words: TimedWord[] = [];
  let cursor = startSec;
  for (const part of parts) {
    for (const text of part.split(/\s+/)) {
      words.push({text, start: Math.round(cursor * 100) / 100, end: Math.round((cursor + 0.3) * 100) / 100});
      cursor += 0.34;
    }
    cursor += 1;
  }
  return {words, transcript: words.map(word => word.text).join(' '), duration: Math.ceil(cursor + 1)};
}

// A clip in which the speaker never says "expert", "advice", "transform" or "profession".
const CLIP = timed([
  'Today and I have a choice between two one that have no clue and one that have a plan in every field.',
  'Most people just keep guessing what to learn next.',
  'We remove the guessing for you.',
]);
const empty: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};
const base = {words: CLIP.words, outputDurationSec: CLIP.duration, occupied: [], captionBand: {top: 0.82, bottom: 0.96}, lookId: 'talking_head'};

/** A Director brief the library can draw, with invented copy (the Gate 3 shape: headline + sublabel the speaker never said). */
const invented = () =>
  assembleDirectedGraphics(
    {graphics: [{id: 'be-an-expert-in-ai', anchorWordIndex: 22, durationSeconds: 3.5, reason: 'r', goal: 'g', visualDescription: 'big type', placement: 'split_screen', graphicSide: 'top', contentJson: JSON.stringify({headline: 'BE AN EXPERT IN AI', sublabel: 'Advice for every college student & professional'})}]},
    {words: CLIP.words, outputDurationSec: CLIP.duration, occupied: [], maxGraphics: 4},
  ).graphics;
/** What analyzeVideo hands the stage: the legibility pass's own rule, over the whole transcript. */
const isCopyGrounded = (content: Record<string, unknown>) => generatedGraphicIsGrounded({props: {content}}, CLIP.transcript);
const asPublished = (graphics: MotionDirectorResult['graphics']) => graphics.map(graphic => ({id: graphic.brief.id, props: {content: graphic.brief.content}}));

describe('the Gate 3 simulation', () => {
  it('without grounding, an invented library brief is kept (and WP8R may top up other seeds); the legibility pass still removes the invented copy', () => {
    const brief = invented();
    expect(brief).toHaveLength(1);
    const result = addLibrarySeeds({...empty, graphics: brief}, base);
    expect(result.director.graphics.some(graphic => graphic.brief.id === brief[0]!.brief.id)).toBe(true);
    const after = dropUngroundedGeneratedGraphics(asPublished(result.director.graphics), CLIP.transcript);
    expect(after.kept.every(graphic => generatedGraphicIsGrounded(graphic, CLIP.transcript))).toBe(true);
  });
  it('with the transcript the invented brief is dropped first, the seeds take its place, and at least one generated graphic survives the legibility pass', () => {
    const result = addLibrarySeeds({...empty, graphics: invented()}, {...base, isCopyGrounded});
    expect(result.warnings).toContain('motion_graphic:ungrounded_brief_dropped:be-an-expert-in-ai');
    expect(result.director.graphics.some(graphic => graphic.brief.id === 'be-an-expert-in-ai')).toBe(false);
    expect(result.warnings.some(warning => warning.startsWith('motion_graphic:library_seed:') && !warning.endsWith(':none'))).toBe(true);
    const seeds = result.director.graphics;
    expect(seeds.length).toBeGreaterThanOrEqual(1);
    const after = dropUngroundedGeneratedGraphics(asPublished(seeds), CLIP.transcript);
    expect(after.dropped).toEqual([]);
    expect(after.kept.length).toBe(seeds.length);
    for (const graphic of seeds) expect(generatedGraphicIsGrounded({props: {content: graphic.brief.content}}, CLIP.transcript)).toBe(true);
  });
  it('a Director library brief made of spoken words is kept; WP8R may top up more seeds into empty gaps', () => {
    const spoken = assembleDirectedGraphics(
      {graphics: [{id: 'spoken', anchorWordIndex: 22, durationSeconds: 3, reason: 'r', goal: 'g', visualDescription: 'big type', placement: 'full_screen', contentJson: JSON.stringify({statement: 'We remove the guessing for you'})}]},
      {words: CLIP.words, outputDurationSec: CLIP.duration, occupied: [], maxGraphics: 4},
    ).graphics;
    expect(spoken).toHaveLength(1);
    const result = addLibrarySeeds({...empty, graphics: spoken}, {...base, isCopyGrounded});
    expect(result.director.graphics.some(graphic => graphic.brief.id === 'spoken')).toBe(true);
    expect(result.director.graphics.length).toBeGreaterThanOrEqual(1);
  });
  it('a mix: the invented brief is dropped, the spoken one stays; WP8R may top up seeds beside it', () => {
    const mixed = assembleDirectedGraphics(
      {graphics: [
        {id: 'invented', anchorWordIndex: 0, durationSeconds: 3, reason: 'r', goal: 'g', visualDescription: 'big type', placement: 'full_screen', contentJson: JSON.stringify({statement: 'Transform your job with AI'})},
        {id: 'spoken', anchorWordIndex: 22, durationSeconds: 3, reason: 'r', goal: 'g', visualDescription: 'big type', placement: 'full_screen', contentJson: JSON.stringify({statement: 'We remove the guessing for you'})},
      ]},
      {words: CLIP.words, outputDurationSec: CLIP.duration, occupied: [], maxGraphics: 4},
    ).graphics;
    const result = addLibrarySeeds({...empty, graphics: mixed}, {...base, isCopyGrounded});
    expect(result.warnings).toContain('motion_graphic:ungrounded_brief_dropped:invented');
    expect(result.director.graphics.some(graphic => graphic.brief.id === 'spoken')).toBe(true);
    expect(result.director.graphics.some(graphic => graphic.brief.id === 'invented')).toBe(false);
  });
  it('a failed Director (an empty stand-in) is unchanged: seeds only, no ungrounded-brief warning', () => {
    const result = addLibrarySeeds(empty, {...base, isCopyGrounded});
    expect(result.warnings.every(warning => warning.startsWith('motion_graphic:library_seed:'))).toBe(true);
    expect(result.director.graphics.length).toBeGreaterThan(0);
  });
});

describe('the grounding rule has nothing to do with the speaker box', () => {
  it('the same graphic is grounded or not by its words alone; an unmeasured speaker changes nothing', () => {
    const spoken = {props: {content: {statement: 'We remove the guessing for you'}}};
    const made = {props: {content: {headline: 'BE AN EXPERT IN AI'}}};
    expect(generatedGraphicIsGrounded(spoken, CLIP.transcript)).toBe(true);
    expect(generatedGraphicIsGrounded(made, CLIP.transcript)).toBe(false);
    expect(dropUngroundedGeneratedGraphics([spoken, made], CLIP.transcript)).toEqual({kept: [spoken], dropped: [made]});
  });
  it('the hook rule likewise: a spoken hook survives with a fallback (unmeasured) speaker; an unspoken one is cleared with a measured one', () => {
    const run = (hookTitle: string, speakerSource: 'vision' | 'fallback') =>
      applyLegibility({hookTitle, canvasWidth: 1080, canvasHeight: 1920, speakerTopFrac: 0.2, speakerSource, caption: {position: 'bottom', bottomFrac: 0.16, textColor: '#FFFFFF', highlightColor: '#F5B942', boxColor: null, template: 'karaoke', animation: 'highlight', fontScale: 1, uppercase: false} as never, motionGraphics: [], semanticEmphasis: [], transcript: CLIP.transcript});
    expect(run('We remove the guessing', 'fallback').hookTitle).not.toBe('');
    expect(run('Who gets hired', 'vision').hookTitle).toBe('');
    expect(run('Who gets hired', 'vision').warnings).toContain('legibility:ungrounded_hook_cleared');
  });
  it('source: the grounding functions and the analyzeVideo drop site never read occupancy or the speaker box', () => {
    const legibility = read('server/src/stages/broll/legibility.ts');
    const groundingBlock = legibility.slice(legibility.indexOf('export function generatedGraphicIsGrounded'), legibility.indexOf('export const TEXT_OVERLAY_LAYOUTS'));
    expect(groundingBlock).not.toMatch(/occupancy|speakerBox|speakerSource|unmeasured/);
    const analyze = read('server/src/pipeline/analyzeVideo.ts');
    const site = analyze.slice(analyze.indexOf('const grounded = dropUngroundedGeneratedGraphics('), analyze.indexOf('const canvasTitles = groundCanvasTitles('));
    expect(site.length).toBeGreaterThan(500);
    expect(site).not.toMatch(/occupancy|unmeasured|speakerBox/);
  });
});

describe('what did not change', () => {
  it('the matte rules: an unmeasured speaker is still an unusable matte and the look still strips cutout / depth overlay (no text-behind on a bad matte)', () => {
    expect(decideMatteGate({occupancy: {source: 'fallback', unmeasured: true}, cutout: {available: true}})).toEqual({usable: false, reason: 'unmeasured'});
    const talking = EDIT_LOOKS.find(look => look.id === 'talking_head')!;
    expect(enforceEditLook([{id: 'a', kind: 'cutout'}, {id: 'b', kind: 'depth_overlay'}, {id: 'c', kind: 'zoom'}], talking, {matteUsable: false}).kept.map(item => item.kind)).toEqual(['zoom']);
  });
  it('the grounding rule itself is untouched: the hook, overlay and emphasis words must still be spoken (WP2C / WP3S / WP4R)', () => {
    const legibility = read('server/src/stages/broll/legibility.ts');
    expect(legibility).toContain("!isGroundedInTranscript(trimmedHook, input.transcript)");
    expect(legibility).toContain('? {title: \'\', fit: null, warnings: [\'legibility:ungrounded_hook_cleared\']}');
    expect(read('server/src/stages/broll/groundedText.ts')).toContain('export function isGroundedInTranscript');
  });
  it('the backing plate stays opt-in and the defaults stand', () => {
    expect(read('remotion/src/lib/captionSplit.ts')).toContain('return captions?.backingPlate === true;');
    expect(read('server/src/config/env.ts')).toContain('MOTION_GRAPHICS_ENABLED: bool(false),');
    expect(read('server/src/config/env.ts')).toContain("PRODUCT_EDIT_PROFILE: str('cuts'),");
  });
});

describe('the prompts say the copy must be spoken (so fewer briefs are wasted), and the wiring passes the transcript', () => {
  it('the Edit Look block (polish Director v2) and the library keys block carry the rule', () => {
    expect(editLookPromptBlock()).toContain('COPY RULE: every word of the hook title');
    expect(editLookPromptBlock('talking_head')).toContain('Text with any other word (a slogan, a paraphrase, an added claim) is removed from the edit.');
    expect(libraryContentKeysPromptBlock()).toContain('EVERY word of every string must be a word the speaker says in the transcript');
  });
  it('the stage passes the grounding rule to the seed step (from analyzeVideo, the same function its drop site uses), and the fallback module imports neither the legibility nor the matcher module', () => {
    expect(read('server/src/stages/motionDirector/index.ts')).toContain('isCopyGrounded: input.isCopyGrounded, // WP8N: the grounding rule the legibility pass applies later (passed in by analyzeVideo)');
    expect(read('server/src/pipeline/analyzeVideo.ts')).toContain('isCopyGrounded: content => generatedGraphicIsGrounded({props: {content}}, transcription.transcript), // WP8N');
    const fallback = read('server/src/stages/motionDirector/libraryFallback.ts');
    const imports = [...fallback.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]);
    expect(imports).toEqual(['./motionDirector.ts', './libraryRegistry.ts', './transcriptLibrarySeed.ts']); // no legibility or matcher import: those keep their one importer (analyzeVideo); the rule is passed in
    expect(fallback).toContain('motion_graphic:ungrounded_brief_dropped:');
    expect(fallback).toContain('motion_seed_ungrounded:');
    for (const word of ['callDirectorModel', 'requestJson', 'anthropic', 'fetch(']) expect(fallback).not.toContain(word);
  });
});
