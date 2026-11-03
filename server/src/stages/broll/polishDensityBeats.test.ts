/**
 * WP8P (second suite, alongside polishDensityFill.test.ts): look caps, duration-scaled seeds, the Gate 4 shaped fixture, the look bias, prompt text and source pins. Pure: no model, no network, no render.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {
  biasEditLook,
  editLookPromptBlock,
  editLookWarnings,
  EDIT_LOOKS,
  enforceEditLook,
  profileCarriesDesignedGraphics,
  POLISH_LOOK_MAX_GRAPHICS,
  resolveEditLook,
} from '../directorV2/editLooks.ts';
import {MIN_SEPARATION_SEC, seedLibraryGraphics, seedLimitForDuration} from '../motionDirector/transcriptLibrarySeed.ts';
import {applyPolishDensityFill, beatTarget, designedBeatCount, MIN_BEAT_GAP_SEC, zoomFloor} from './polishDensityFill.ts';
import type {VisualDirection} from './geminiDirector.ts';
import type {WordToken} from '../../types/blueprint.ts';

const look = (id: string) => EDIT_LOOKS.find(entry => entry.id === id)!;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** A ~36 s talk: nine sentences of four seconds, every word timed. */
const SENTENCES = [
  'Most people never learn how to use artificial intelligence properly.',
  'The best engineers already work with it every single day.',
  'Companies hire people who understand automation, not people who fear it.',
  'Your profession matters less than your willingness to adapt quickly.',
  'Doctors, lawyers, teachers and designers are all learning the same tools.',
  'Nobody ever became an expert by watching from the sidelines.',
  'Productivity improves by 40 percent when teams collaborate with assistants.',
  'Curiosity is the only advantage that keeps compounding over time.',
  'Start building something real with these tools today.',
];

function transcript(sentences = SENTENCES, secPerSentence = 4): WordToken[] {
  const words: WordToken[] = [];
  sentences.forEach((sentence, index) => {
    const tokens = sentence.split(' ');
    const slot = (secPerSentence - 0.5) / tokens.length;
    tokens.forEach((text, i) => words.push({text, start: Math.round((index * secPerSentence + i * slot) * 1000) / 1000, end: Math.round((index * secPerSentence + (i + 1) * slot) * 1000) / 1000}));
  });
  return words;
}
const WORDS = transcript();
const DURATION = 36;
const norm = (text: string) => text.replace(/[.,]/g, '').toLowerCase();
const heardIn = (words: WordToken[]) => ` ${words.map(word => norm(word.text)).join(' ')} `;
const fillTexts = (direction: VisualDirection) => [...direction.motionGraphics.map(item => item.text), ...direction.semanticEmphasis.map(item => item.text), ...direction.moments.map(item => item.overlayText)].filter(text => text.trim() !== ''); // WP8W: a cutaway moment carries no on-screen text

const direction = (over: Partial<VisualDirection> = {}): VisualDirection => ({
  hookTitle: 'Learn AI', hookSubtitle: '', hookStyle: 'bold' as never, topic: 't', visualQueries: [],
  caption: {} as never, suggestedLutIds: [], preferredLutId: '',
  zooms: [], moments: [], depthOverlays: [], insetReveals: [], motionGraphics: [], mediaContainers: [], frameInsets: [], semanticEmphasis: [],
  estimatedCostUsd: 0, source: 'gemini', ...over,
});
/** Gate 4 shape: 3 zooms, 1 overlay, hook; the lean toolkits requested, little placed. */
const gate4 = (): VisualDirection => direction({
  zooms: [{timestamp: 6, durationSec: 2.5}, {timestamp: 15, durationSec: 2.5}, {timestamp: 27, durationSec: 2.5}],
  moments: [{timestamp: 20, searchKeyword: 'x', media: 'text', layout: 'chip', anchor: 'top_right', overlayText: 'Companies hire people', textStyle: 'bar', accentColor: '#fff'} as never],
});
const LEAN = new Set(['captions', 'zoom', 'hook_title', 'kinetic_text', 'lockup', 'card', 'bubble', 'emphasis', 'counter']);

describe('WP8P look caps', () => {
  it('talking_head and explainer_cutaway allow at least 4 designed graphics; minimal_captions stays at 0', () => {
    expect(POLISH_LOOK_MAX_GRAPHICS).toBeGreaterThanOrEqual(4);
    expect(look('talking_head').maxGraphics).toBe(POLISH_LOOK_MAX_GRAPHICS);
    expect(look('explainer_cutaway').maxGraphics).toBe(POLISH_LOOK_MAX_GRAPHICS);
    expect(look('minimal_captions').maxGraphics).toBe(0);
  });
  it('explainer: cards and pills (WP52: bubble removed from the look) are not graphic kinds, so the cap never starves them', () => {
    const explainer = look('explainer_cutaway');
    expect(explainer.graphicKinds).toEqual(['cutaway', 'media_container']);
    const elements = Array.from({length: 9}, (_, i) => ({id: `c${i}`, kind: i % 2 ? 'emphasis' : 'card'}));
    const {kept, dropped} = enforceEditLook(elements, explainer);
    expect(kept).toHaveLength(9);
    expect(dropped).toHaveLength(0);
    const cutaways = Array.from({length: 8}, (_, i) => ({id: `x${i}`, kind: 'cutaway'}));
    expect(enforceEditLook(cutaways, explainer).kept).toHaveLength(POLISH_LOOK_MAX_GRAPHICS);
  });
});

describe('WP8P seed limits', () => {
  it('are duration scaled: 20 s -> 2, 36 s -> 4, 40 s -> 4, 90 s -> 6, tiny / bad -> 2; separation is below the old 6 s', () => {
    expect(seedLimitForDuration(20)).toBe(2);
    expect(seedLimitForDuration(36)).toBe(4);
    expect(seedLimitForDuration(40)).toBe(4);
    expect(seedLimitForDuration(90)).toBe(6);
    expect(seedLimitForDuration(5)).toBe(2);
    expect(seedLimitForDuration(Number.NaN)).toBe(2);
    expect(MIN_SEPARATION_SEC).toBeLessThan(6);
  });
  it('a 36 s talk gets 3-4 seeds under talking_head, every word of them spoken; none under minimal_captions', () => {
    const seeds = seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: 'talking_head'});
    expect(seeds.limit).toBe(4);
    expect(seeds.raw.graphics.length).toBeGreaterThanOrEqual(3);
    expect(seeds.raw.graphics.length).toBeLessThanOrEqual(4);
    const heard = heardIn(WORDS);
    for (const graphic of seeds.raw.graphics) {
      // Content strings only (skip schema keys like value.suffix / to).
      const walk = (node: unknown): string[] => {
        if (typeof node === 'string') return [node];
        if (Array.isArray(node)) return node.flatMap(walk);
        if (node && typeof node === 'object') {
          return Object.entries(node as Record<string, unknown>)
            .filter(([key]) => !['suffix', 'to', 'from', 'prefix', 'unit'].includes(key))
            .flatMap(([, value]) => walk(value));
        }
        return [];
      };
      for (const text of walk(JSON.parse(graphic.contentJson))) {
        for (const token of norm(text).split(/\s+/).filter(token => token.length >= 4)) expect(heard).toContain(` ${token} `);
      }
    }
    expect(seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: 'minimal_captions'}).none).toBe('look_allows_no_graphics');
  });
  it('a short clip keeps the limit of 2', () => {
    expect(seedLibraryGraphics({words: transcript(SENTENCES.slice(0, 4)), outputDurationSec: 16, lookId: 'talking_head'}).limit).toBe(2);
  });
});

describe('WP8P Gate 4 shaped fill', () => {
  it('~36 s, 3 zooms + 1 overlay + hook: after the fill there are >= 4 designed beats and >= 4 zooms, Director items untouched, beats spaced, none inside the hook', () => {
    const before = gate4();
    expect(designedBeatCount(before)).toBe(1);
    const result = applyPolishDensityFill({direction: before, look: look('talking_head'), words: WORDS, outputDurationSec: DURATION, requested: LEAN});
    expect(designedBeatCount(result.direction)).toBeGreaterThanOrEqual(4);
    expect(result.direction.zooms.length).toBeGreaterThanOrEqual(4);
    for (const zoom of before.zooms) expect(result.direction.zooms).toContainEqual(zoom);
    expect(result.direction.moments[0]).toBe(before.moments[0]);
    expect(result.direction.hookTitle).toBe(before.hookTitle);
    const starts = [...result.direction.motionGraphics.map(item => item.start), ...result.direction.semanticEmphasis.map(item => item.start), ...result.direction.moments.map(item => item.timestamp)].sort((a, b) => a - b);
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(MIN_BEAT_GAP_SEC - 1e-6);
    expect(starts[0]!).toBeGreaterThanOrEqual(3.2);
    expect(result.warnings.some(warning => warning.startsWith('polish_density_fill:kinetic_text:') || warning.startsWith('polish_density_fill:emphasis:') || warning.startsWith('polish_density_fill:lockup:'))).toBe(true);
    expect(result.warnings).toContain('polish_density_fill:zoom:1');
  });
  it('an empty Director: grounded text beats and zooms; every text is a run of spoken words', () => {
    const result = applyPolishDensityFill({direction: direction(), look: look('talking_head'), words: WORDS, outputDurationSec: DURATION, requested: LEAN});
    const texts = fillTexts(result.direction);
    expect(texts.length).toBeGreaterThanOrEqual(beatTarget(DURATION));
    for (const text of texts) expect(heardIn(WORDS)).toContain(` ${norm(text)} `);
    expect(result.direction.zooms.length).toBeGreaterThanOrEqual(zoomFloor(DURATION));
  });
  it('never writes an unspoken word, whatever the transcript (fixture sweep, both looks)', () => {
    for (const sentences of [SENTENCES, SENTENCES.slice(2), SENTENCES.map(text => text.toUpperCase()), SENTENCES.map(text => `um ${text.replace(/,/g, '')}`)]) {
      const words = transcript(sentences);
      for (const id of ['talking_head', 'explainer_cutaway', 'split_story']) {
        const result = applyPolishDensityFill({direction: direction(), look: look(id), words, outputDurationSec: words[words.length - 1]!.end, requested: null});
        for (const text of fillTexts(result.direction)) expect(heardIn(words), `${id}: ${text}`).toContain(` ${norm(text)} `);
      }
    }
  });
  it('the cap stops the fill: a 72 s clip whose target (8) is above the cap (5) gets nothing more when 5 graphics are already placed', () => {
    const longWords = transcript([...SENTENCES, ...SENTENCES]);
    expect(beatTarget(72)).toBeGreaterThan(POLISH_LOOK_MAX_GRAPHICS);
    const full = direction({motionGraphics: Array.from({length: POLISH_LOOK_MAX_GRAPHICS}, (_, i) => ({start: 4 + i * 14, end: 6 + i * 14, text: 'Most people', role: 'primary', shape: 'none', accentColor: '#fff', textColor: '#fff', anchor: 'top', entrance: 'fade_blur', exit: 'fade', fontScale: 1} as never))});
    const capped = applyPolishDensityFill({direction: full, look: look('talking_head'), words: longWords, outputDurationSec: 72, requested: new Set(['kinetic_text', 'lockup'])});
    expect(capped.warnings).toEqual([]);
    expect(capped.direction.motionGraphics).toHaveLength(POLISH_LOOK_MAX_GRAPHICS);
    expect(capped.direction.moments).toHaveLength(0);
  });
  it('fills only what the look allows and the caller asked for', () => {
    const explainer = applyPolishDensityFill({direction: direction(), look: look('explainer_cutaway'), words: WORDS, outputDurationSec: DURATION, requested: LEAN});
    expect(explainer.direction.motionGraphics).toHaveLength(0); // kinetic_text is not in explainer_cutaway
    expect(explainer.direction.moments.length).toBeGreaterThan(0);
    expect(explainer.direction.moments.every(moment => moment.layout === 'chip' && moment.media === 'text')).toBe(true);
    const zoomOnly = applyPolishDensityFill({direction: direction(), look: look('talking_head'), words: WORDS, outputDurationSec: DURATION, requested: new Set(['zoom'])});
    expect(fillTexts(zoomOnly.direction)).toEqual([]);
    expect(zoomOnly.direction.zooms.length).toBeGreaterThanOrEqual(4);
    const noZoom = applyPolishDensityFill({direction: direction(), look: look('talking_head'), words: WORDS, outputDurationSec: DURATION, requested: new Set(['kinetic_text'])});
    expect(noZoom.direction.zooms).toHaveLength(0);
    expect(applyPolishDensityFill({direction: direction(), look: look('minimal_captions'), words: WORDS, outputDurationSec: DURATION, requested: LEAN}).warnings).toEqual([]);
  });
  it('zoom floor: a short zoom list is topped up on sentence starts, spaced >= 5 s, never past the floor; enough zooms -> no warning', () => {
    const result = applyPolishDensityFill({direction: direction({zooms: [{timestamp: 8, durationSec: 2.5}]}), look: look('talking_head'), words: WORDS, outputDurationSec: DURATION, requested: new Set(['zoom'])});
    expect(result.direction.zooms.length).toBe(zoomFloor(DURATION));
    const sentenceStarts = SENTENCES.map((_, i) => i * 4);
    for (const zoom of result.direction.zooms.filter(item => item.timestamp !== 8)) expect(sentenceStarts.some(start => Math.abs(start - zoom.timestamp) < 0.01)).toBe(true);
    const starts = result.direction.zooms.map(zoom => zoom.timestamp);
    for (let i = 1; i < starts.length; i += 1) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(5 - 1e-6);
    const enough = applyPolishDensityFill({direction: direction({zooms: [2, 10, 18, 26].map(timestamp => ({timestamp, durationSec: 2}))}), look: look('talking_head'), words: WORDS, outputDurationSec: DURATION, requested: new Set(['zoom'])});
    expect(enough.warnings).toEqual([]);
  });
  it('is a no-op for too-short input', () => {
    expect(applyPolishDensityFill({direction: direction(), look: look('talking_head'), words: WORDS.slice(0, 4), outputDurationSec: 5, requested: LEAN}).warnings).toEqual([]);
  });
});

describe('WP8S generic look bias', () => {
  it('a sparse or missing pick becomes explainer_cutaway when the profile carries designed graphics, reported as edit_look_bias', () => {
    for (const profile of [{density: 'moderate'}, {density: 'rich', structure: 'conversational'}, {density: 'sparse', structure: 'enumerated'}, {density: 'sparse', structure: 'argument'}]) {
      const biased = biasEditLook(resolveEditLook('minimal_captions'), profile);
      expect(biased.resolution.look.id).toBe('explainer_cutaway');
      expect(biased.biasedFrom).toBe('minimal_captions');
    }
    const missing = biasEditLook(resolveEditLook(undefined), {density: 'moderate', structure: 'narrative'});
    expect(missing.resolution.look.id).toBe('explainer_cutaway');
    expect(missing.resolution.fellBack).toBe(false);
    expect(editLookWarnings({id: 'explainer_cutaway', requested: 'minimal_captions', fellBack: false, dropped: [], biasedFrom: 'minimal_captions'})).toContain('edit_look_bias:minimal_captions->explainer_cutaway');
  });
  it('an explicit dense pick is never rewritten; no profile or no density keeps the sparse look', () => {
    for (const id of ['talking_head', 'split_story', 'explainer_cutaway']) expect(biasEditLook(resolveEditLook(id), {density: 'rich', structure: 'enumerated'}).biasedFrom).toBeUndefined();
    expect(biasEditLook(resolveEditLook('talking_head'), {density: 'rich', structure: 'enumerated'}).resolution.look.id).toBe('talking_head');
    expect(biasEditLook(resolveEditLook('minimal_captions'), {density: 'none', structure: 'enumerated'}).biasedFrom).toBeUndefined();
    expect(biasEditLook(resolveEditLook('minimal_captions'), {density: 'sparse', structure: 'conversational'}).biasedFrom).toBeUndefined();
    expect(biasEditLook(resolveEditLook('minimal_captions'), {contentType: 'motivational'}).biasedFrom).toBeUndefined();
    expect(biasEditLook(resolveEditLook('minimal_captions'), undefined).biasedFrom).toBeUndefined();
    expect(profileCarriesDesignedGraphics({density: 'sparse'})).toBe(false);
  });
});

describe('WP8P prompts and wiring pins', () => {
  it('the Stage-2 look block states the beat rate, the fill promise and keeps the copy rule', () => {
    const block = editLookPromptBlock();
    expect(block).toContain('BEAT RATE');
    expect(block).toContain('every 6-8 seconds');
    expect(block).toContain('filled by the engine from the speaker');
    expect(block).toContain('COPY RULE');
  });
  it('the fill is polish-gated: one call, inside the editLooks branch of the planner; ensureRequestedEdits stays log-only; the helper has no env / logger / network', () => {
    const planner = read('./brollPlanner.ts');
    const gate = planner.indexOf('if (input.editLooks && (input.directorV2 || northStar))');
    const call = planner.indexOf('applyPolishDensityFill({');
    const end = planner.indexOf("observe(() => ({type: 'director_result'");
    expect(gate).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(gate);
    expect(call).toBeLessThan(end);
    expect(planner.match(/applyPolishDensityFill\(/g)).toHaveLength(1);
    expect(read('./ensureRequestedEdits.ts')).toContain('Never fill, retime, or invent placements.');
    expect(read('./ensureRequestedEdits.ts')).not.toContain('polishDensityFill');
    const helper = read('./polishDensityFill.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(helper).not.toMatch(/process\.env|fetch\(|node:fs|logger/);
  });
  it('the look bias and the profile-cap lift stay polish-only', () => {
    expect(read('../../pipeline/analyzeVideo.ts')).toContain('lookBias: polishPath && contentProfile');
    const fallback = read('../motionDirector/libraryFallback.ts');
    expect(fallback).toContain('Math.max(input.contentProfile.policy.maxGraphics, seed.limit)');
    expect(fallback).toContain('policy.maxGraphics > 0');
  });
});
