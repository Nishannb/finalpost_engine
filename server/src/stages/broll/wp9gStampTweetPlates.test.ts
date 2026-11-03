/**
 * WP9G: StampTitle / TweetCard plates (registry, seeds, gap briefs) and library gap fills when Claude is disallowed. Offline: mock generator, no model, no render, no network.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {validateGraphicSource} from '../../motionWorker/worker.ts';
import {remapLookForUnusableMatte, resolveEditLook} from '../directorV2/editLooks.ts';
import {runClaudeExplainPlates} from '../motionDirector/claudePlates.ts';
import {libraryGraphicSource, resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import type {MotionDirectorResult} from '../motionDirector/motionDirector.ts';
import {plateShapeAt, seedLibraryGraphics} from '../motionDirector/transcriptLibrarySeed.ts';
import {LEAVE_THE_FACE_COMPOSITIONS, libraryCoverStarts} from './engagementCadence.ts';
import {buildClaudePlateBriefs, detectExplainPlateGaps, MAX_CLAUDE_PLATES} from './explainPlateGaps.ts';
import {isGroundedInTranscript} from './groundedText.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const SENTENCES = [
  'Number two market size matters more than anything else.',
  'Someone tweeted that nobody reads the documentation anymore.',
  'Clarity beats effort when the goal is unclear to everyone.',
  'Write the plan down and share it with your whole team.',
  'Then keep the standard high and ship it anyway today.',
  'Start building something real with these tools right now.',
  'Small habits compound into something very large over time.',
  'Pick one metric and protect it from everything else around you.',
  'Never confuse being busy with making real progress forward.',
];
const WORDS = SENTENCES.flatMap((sentence, index) => {
  const tokens = sentence.split(' ');
  const slot = 3.5 / tokens.length;
  return tokens.map((text, i) => ({text, start: Math.round((index * 4 + i * slot) * 1000) / 1000, end: Math.round((index * 4 + (i + 1) * slot) * 1000) / 1000}));
});
const DURATION = 36;
const transcript = WORDS.map(word => word.text).join(' ');
const remapped = remapLookForUnusableMatte(resolveEditLook('talking_head'), false).resolution.look;
const brief = (content: Record<string, unknown>, placement = 'full_screen') => ({goal: 'g', visualDescription: 'v', placement, content});
const emptyDirector: MotionDirectorResult = {graphics: [], refusals: [], notes: '', costUsd: 0, model: 'x', latencyMs: 0, raw: null};
const edit = {brollClips: [], visualOverlays: [], motionGraphics: [], mediaContainers: [], hookTitle: '', hookStartSec: 0, hookDurationSec: 0, insetReveals: [], depthOverlays: [], semanticEmphasis: [], frameInsets: []} as never;
const upload = async (_code: string, sha: string) => `https://cdn.example/${sha}.js`;

describe('WP9G registry: StampTitle and TweetCard', () => {
  it('stamp + title -> StampTitle (optional subtitle); opaque on full / split screen, transparent on overlay', () => {
    const hit = resolveLibraryGraphic(brief({stamp: '02 —', title: 'Market size', subtitle: 'matters most'}))!;
    expect(hit.compositionId).toBe('StampTitle');
    expect(hit.props).toEqual({stamp: '02 —', title: 'Market size', subtitle: 'matters most', background: true});
    expect(resolveLibraryGraphic(brief({stamp: '02 —', title: 'Market size'}, 'overlay'))!.props.background).toBe(false);
    expect(resolveLibraryGraphic(brief({stamp: '02 —', title: 'Market size'}, 'split_screen'))!.props.background).toBe(true);
  });
  it('a title alone is still a FullscreenStatement; a stamp without a title, or a too-long title, is not a StampTitle', () => {
    expect(resolveLibraryGraphic(brief({title: 'Market size'}))!.compositionId).toBe('FullscreenStatement');
    expect(resolveLibraryGraphic(brief({stamp: '02 —'}))).toBeNull();
    expect(resolveLibraryGraphic(brief({stamp: '02 —', title: 'x'.repeat(90)}))?.compositionId).not.toBe('StampTitle');
  });
  it('body -> TweetCard with optional name, handle, highlight; header keys only when given', () => {
    const plain = resolveLibraryGraphic(brief({body: 'Nobody reads the documentation anymore'}))!;
    expect(plain).toMatchObject({compositionId: 'TweetCard', props: {body: 'Nobody reads the documentation anymore', background: true}});
    expect(Object.keys(plain.props).sort()).toEqual(['background', 'body']);
    const full = resolveLibraryGraphic(brief({body: 'Ship small things', name: 'Ada', handle: '@ada', highlight: ['Ship small']}))!;
    expect(full.props).toMatchObject({name: 'Ada', handle: '@ada', highlight: ['Ship small']});
    expect(resolveLibraryGraphic(brief({body: 'x', name: 'n'.repeat(60)}))).toBeNull();
    expect(resolveLibraryGraphic(brief({body: ''}))).toBeNull();
  });
  it('both comps are exported and in the compositions map, documented, typed as plates that leave the face', () => {
    const index = read('../../../../remotion/src/motion/index.ts');
    for (const id of ['StampTitle', 'TweetCard']) {
      expect(index).toMatch(new RegExp(`export \\{${id}\\b`));
      expect(index).toMatch(new RegExp(`export const compositions = \\{[^}]*\\b${id}\\b`));
      expect(read('../../../../remotion/src/motion/README.md')).toContain(`| \`${id}\` |`);
      expect(LEAVE_THE_FACE_COMPOSITIONS.has(id)).toBe(true);
    }
  });
  it.each([
    ['StampTitle', {stamp: '02 —', title: 'Market size matters', subtitle: 'more than anything'}],
    ['TweetCard', {body: 'Nobody reads the documentation anymore', name: 'Ada', handle: '@ada', highlight: ['Nobody reads']}],
  ])('%s: the generated module passes the worker validation (contract, typecheck, compile); no image URLs or network in the comp source', async (id, content) => {
    const hit = resolveLibraryGraphic(brief(content))!;
    expect(hit.compositionId).toBe(id);
    const { report, compiled } = await validateGraphicSource(libraryGraphicSource(hit));
    expect(report).toEqual({safety: [], typecheck: [], compile: [], runtime: []});
    expect(compiled?.bytes).toBeGreaterThan(0);
    const source = read(`../../../../remotion/src/motion/compositions/${id}.tsx`);
    for (const word of ['fetch(', 'http://', 'https://', 'AssetImage', '<img', 'staticFile', 'Math.random', 'Date.now']) expect(source, word).not.toContain(word);
  }, 60_000);
});

describe('WP9G grounding of the new content', () => {
  it('the stamp is chrome (ordinal + dash); the title, subtitle and post body must still be spoken', () => {
    expect(isGroundedInTranscript('02 —', transcript)).toBe(true);
    expect(isGroundedInTranscript('02 — market size', transcript)).toBe(true);
    expect(isGroundedInTranscript('market size matters', transcript)).toBe(true);
    expect(isGroundedInTranscript('02 — market unicorn', transcript)).toBe(false);
    expect(isGroundedInTranscript('Nobody reads the documentation anymore', transcript)).toBe(true);
    expect(isGroundedInTranscript('Nobody reads the manual', transcript)).toBe(false);
  });
});

describe('WP9G seeds and gap briefs emit the new shapes', () => {
  const at = (index: number) => plateShapeAt(WORDS, index * 4 + 0.2);
  it('"Number two ..." -> StampTitle {stamp: "02 —", title: spoken words}; "Someone tweeted that ..." -> TweetCard {body}', () => {
    expect(at(0)).toMatchObject({composition: 'StampTitle', content: {stamp: '02 —'}});
    expect(at(0)!.content.title).toBe('market size matters more');
    expect(at(1)).toMatchObject({composition: 'TweetCard', content: {body: 'nobody reads the documentation anymore'}});
    expect(Object.keys(at(1)!.content).sort()).toEqual(['body', 'highlight']); // no invented name / handle (WP10A adds the highlighter words)
    expect(at(2)).toBeNull();
  });
  it('"Step 3" and a digit work; a bare "Number one" with nothing after it does not', () => {
    const make = (line: string) => line.split(' ').map((text, i) => ({text, start: i * 0.4, end: i * 0.4 + 0.35}));
    expect(plateShapeAt(make('Step 3 write the plan down today'), 0.2)).toMatchObject({composition: 'StampTitle', content: {stamp: '03 —'}});
    expect(plateShapeAt(make('Number one.'), 0.2)).toBeNull();
  });
  it('explainPlates seeding places them (and only then), each resolves to its own composition', () => {
    const seed = seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: remapped.id, explainPlates: true});
    const comps = Object.values(seed.compositions);
    // WP10A: the opening line "Number two ..." is now the open plate carrying the StampTitle ordinal, so it counts as the stamp plate.
    const stampedOpen = seed.raw.graphics.some(graphic => seed.compositions[graphic.id] === 'OpenPlate' && 'stamp' in JSON.parse(graphic.contentJson));
    expect(comps.some(id => id === 'StampTitle' || id === 'TweetCard') || stampedOpen).toBe(true);
    for (const graphic of seed.raw.graphics) {
      const content = JSON.parse(graphic.contentJson);
      const hit = resolveLibraryGraphic({goal: graphic.goal, visualDescription: graphic.visualDescription, placement: graphic.placement, content});
      expect(hit!.compositionId, graphic.id).toBe(seed.compositions[graphic.id]);
    }
    const standard = Object.values(seedLibraryGraphics({words: WORDS, outputDurationSec: DURATION, lookId: remapped.id}).compositions);
    expect(standard).not.toContain('StampTitle');
    expect(standard).not.toContain('TweetCard');
    expect(libraryCoverStarts(seed, WORDS).length).toBe(seed.raw.graphics.length);
  });
  it('gap briefs use them with a matching description', () => {
    const gaps = detectExplainPlateGaps({durationSec: DURATION, words: WORDS, coverStarts: []});
    const briefs = buildClaudePlateBriefs(gaps, WORDS, 4);
    const descriptions = briefs.map(item => item.visualDescription);
    expect(descriptions.some(text => /section stamp title card|social-post style card/.test(text))).toBe(true);
    for (const item of briefs) expect(resolveLibraryGraphic({goal: item.goal, visualDescription: item.visualDescription, placement: item.placement, content: JSON.parse(item.contentJson)}), item.id).not.toBeNull();
  });
});

describe('WP9G library gap fills with Claude disallowed', () => {
  const calls: unknown[] = [];
  const generator = async (request: unknown) => {
    calls.push(request);
    throw new Error('the generator must not be called');
  };
  const run = (over: Record<string, unknown> = {}) =>
    runClaudeExplainPlates({director: emptyDirector, edit, words: WORDS, outputDurationSec: DURATION, captionBand: {top: 0.8, bottom: 0.95}, lookId: remapped.id, claudeAllowed: false, buildOptions: {upload, runtimeCheck: false, generator, maxRepairAttempts: 0}, ...over} as never);
  it('structured gap briefs that resolve are published from the library; no generator call; hits reported', async () => {
    calls.length = 0;
    const result = await run();
    expect(calls).toEqual([]);
    expect(result.outcome!.generatedGraphics.length).toBe(MAX_CLAUDE_PLATES);
    expect(result.outcome!.provenance.every(item => item.source === 'library')).toBe(true);
    expect(result.outcome!.claudeCostUsd).toBe(0);
    expect(result.warnings.filter(warning => warning.startsWith('explain_plates:library_hit:')).length).toBe(MAX_CLAUDE_PLATES);
    expect(result.warnings.some(warning => warning.startsWith('explain_plates:claude_plate'))).toBe(false);
  }, 90_000);
  it('only the unresolved briefs stay skipped: a mix publishes the resolvable one and reports the other', async () => {
    calls.length = 0;
    const makeBriefs = (gaps: ReadonlyArray<{windowIndex: number; phraseStartSec: number}>) =>
      gaps.slice(0, 2).map((gap, i) => ({id: `claude-plate-${gap.windowIndex + 1}`, anchorWordIndex: WORDS.findIndex(word => word.start >= gap.phraseStartSec), durationSeconds: 3.5, reason: 'r', goal: 'g', visualDescription: 'v', placement: 'full_screen' as const, contentJson: JSON.stringify(i === 0 ? {headline: 'market size matters'} : {mood: 'calm'})}));
    const result = await run({makeBriefs});
    expect(calls).toEqual([]);
    expect(result.outcome!.generatedGraphics.length).toBe(1);
    expect(result.warnings.filter(warning => warning.startsWith('explain_plates:library_hit:')).length).toBe(1);
    expect(result.warnings).toContain(`explain_plates:claude_gap_skipped:${result.gaps.length - 1}`);
  }, 90_000);
  it('the look cap still applies: minimal_captions gets nothing even though the library is free', async () => {
    calls.length = 0;
    const result = await run({lookId: 'minimal_captions'});
    expect(result.outcome).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('WP9G guards', () => {
  it('source pins: library tried first when Claude is off, new detectors gated on explainPlates, no clip / content-type / stock / network branching', () => {
    const plates = read('../motionDirector/claudePlates.ts');
    expect(plates).toContain('const libraryOnly = input.claudeAllowed === false;');
    expect(plates).toContain('claudeAllowed: !libraryOnly');
    expect(read('../motionDirector/transcriptLibrarySeed.ts')).toContain('stampTitle(sentence), tweetCard(sentence)] : [])');
    for (const file of ['../motionDirector/claudePlates.ts', '../motionDirector/transcriptLibrarySeed.ts', '../../../../remotion/src/motion/compositions/StampTitle.tsx', '../../../../remotion/src/motion/compositions/TweetCard.tsx']) {
      expect(read(file), file).not.toMatch(/jensen|contentType\s*===|'motivational'|'opinion'|pexels|stockSearch|fetch\(/i);
    }
  });
});
