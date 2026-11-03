/**
 * WP3R pure tests: row 6 now also reads the words a viewer can read on generated graphics, text overlays and behind-subject text. Inline fixtures. The matcher is the shared one
 * (stages/broll/groundedText.ts); the scorer holds no matching code. Import graph: rubricScorer.ts (-> lib/renderIntegrity.ts -> lib/errors.ts -> lib/billingGuard.ts; groundedText.ts).
 * The renderer components and worker files are read as text. No logger, `.env`, SDK, FFmpeg, Chromium, network or model call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {scoreRubric} from './rubricScorer.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const read = (...parts: string[]) => readFileSync(resolve(...parts), 'utf8');

type Json = Record<string, unknown>;
const TRANSCRIPT = 'Today I use After Effects and Premiere Pro to cut my videos. The hook is key, so save twenty percent of your time. Spend 5M less on ads, 20% of it.';
const generated = (content: unknown, over: Json = {}) => ({
  id: 'g1', start: 4, end: 7, placement: {mode: 'split_screen', graphicSide: 'top'}, module: {url: 'staticFile:p/x.js', sha256: 'a'.repeat(64)},
  props: {content, theme: {primary: '#2DD4BF', text: '#EAF2F8', fontDisplay: 'space_grotesk', fontBody: 'inter'}}, brief: {kind: 'list', purpose: 'Show the tools', visualIntent: 'A clean checklist'}, ...over,
});
const overlay = (layout: string, over: Json = {}) => ({start: 1, end: 3, layout, mediaKind: 'text', anchor: 'top_left', keyword: '', overlayText: '', assetUrl: '', provider: 'generated', providerId: 0, ...over});
const bp = (over: Json = {}): Json => ({width: 1080, height: 1920, outputDurationSec: 30, hookTitle: 'x', motionGraphics: [], semanticEmphasis: [], generatedGraphics: [], visualOverlays: [], behindSubjectTexts: [], brollClips: [], ...over});
// transcript = null means "none passed" (an explicit undefined would select the default)
const row6 = (blueprint: Json, transcript: string | null = TRANSCRIPT) => scoreRubric({blueprint, ...(transcript === null ? {} : {transcript})}).rows.find(item => item.row === 6)!;
const check = (r: ReturnType<typeof row6>, id: string) => r.checks.find(item => item.id === id)!;

describe('generated graphics (the words in props.content)', () => {
  it('a headline that was not spoken fails, naming the leaf path, the text and the missing words', () => {
    const r = row6(bp({generatedGraphics: [generated({title: 'Recommended Software', items: ['After Effects', 'Premiere Pro']})]}));
    expect(r.status).toBe('fail');
    const c = check(r, 'generated_graphic_text_in_transcript');
    expect(c.status).toBe('fail');
    expect(c.evidence).toEqual([
      {path: 'generatedGraphics[0].props.content.title', value: 'Recommended Software'},
      {path: 'generatedGraphics[0].props.content.title.wordsNotInTranscript', value: ['recommended', 'software']},
    ]);
  });
  it('words that were all spoken pass, including list items, nested rows, and $ and % figures', () => {
    const content = {title: 'Save time', items: ['After Effects', 'Premiere Pro'], rows: [{label: 'ads', value: '$5M'}, {label: 'of it', value: '20%'}]};
    const r = row6(bp({generatedGraphics: [generated(content)]}));
    expect(check(r, 'generated_graphic_text_in_transcript').status).toBe('pass');
    expect(r.status).toBe('pass');
  });
  it('an unspoken item inside a list is found at its index; a spoken sibling is not reported', () => {
    const c = check(row6(bp({generatedGraphics: [generated({items: ['After Effects', 'DaVinci Resolve', 'Premiere Pro']})]})), 'generated_graphic_text_in_transcript');
    expect(c.evidence.map(e => e.path)).toEqual(['generatedGraphics[0].props.content.items[1]', 'generatedGraphics[0].props.content.items[1].wordsNotInTranscript']);
  });
  it('only the copy is read: theme, fonts, colours, the brief, assets and addresses are not words a viewer reads', () => {
    const g = generated({title: 'Save time', accent: '#00E5FF', logo: 'https://cdn.example/logo.png', local: 'staticFile:p/i.png', embedded: 'data:image/png;base64,AAAA', n: 42, ok: true},
      {props: {content: {title: 'Save time', accent: '#00E5FF', logo: 'https://cdn.example/logo.png', local: 'staticFile:p/i.png', embedded: 'data:image/png;base64,AAAA', n: 42, ok: true}, theme: {fontDisplay: 'space_grotesk', primary: '#2DD4BF'}, assets: {logo: {src: 'https://cdn.example/logo.png'}}}});
    expect(check(row6(bp({generatedGraphics: [g]})), 'generated_graphic_text_in_transcript').status).toBe('pass');
  });
  it('a graphic with no text (numbers and addresses only, empty content, no props) does not fail', () => {
    for (const g of [generated({value: 42, series: [1, 2, 3]}), generated({}), generated({logo: 'https://cdn.example/a.png'}), generated(undefined, {props: undefined}), {id: 'bare'}]) {
      expect(check(row6(bp({generatedGraphics: [g]})), 'generated_graphic_text_in_transcript').status).toBe('pass');
    }
  });
  it('the brief is not read (the renderer does not draw it): an unspoken purpose does not fail', () => {
    expect(check(row6(bp({generatedGraphics: [generated({title: 'Save time'}, {brief: {kind: 'x', purpose: 'Totally invented purpose', visualIntent: 'unspoken'}})]})), 'generated_graphic_text_in_transcript').status).toBe('pass');
  });
});

describe('overlays (the words the renderer draws for the text layouts)', () => {
  it('an overlay that is only a URL does not fail: media layouts draw no words, whatever their text fields hold', () => {
    for (const layout of ['card', 'pip', 'sticker', 'cutaway', 'split', 'composite', 'cutout']) {
      const r = row6(bp({visualOverlays: [overlay(layout, {mediaKind: 'image', assetUrl: 'https://cdn.example/a.png', provider: 'user', providerId: 1, keyword: 'sunset beach', overlayText: 'Totally invented'})]}));
      expect(check(r, 'overlay_text_in_transcript').status, layout).toBe('pass');
    }
  });
  it('a text overlay with no text at all does not fail', () => {
    expect(check(row6(bp({visualOverlays: [overlay('lockup'), overlay('banner', {overlayText: '   '})]})), 'overlay_text_in_transcript').status).toBe('pass');
  });
  it('a text layout with overlayText that was not spoken fails; one that was spoken passes (every text layout)', () => {
    for (const layout of ['lockup', 'stat', 'banner', 'bubble', 'chip']) {
      const bad = check(row6(bp({visualOverlays: [overlay(layout, {overlayText: 'Totally invented claim'})]})), 'overlay_text_in_transcript');
      expect(bad.status, layout).toBe('fail');
      expect(bad.evidence[0]).toEqual({path: 'visualOverlays[0].overlayText', value: 'Totally invented claim'});
      expect(check(row6(bp({visualOverlays: [overlay(layout, {overlayText: 'HOOK IS KEY'})]})), 'overlay_text_in_transcript').status, layout).toBe('pass');
    }
  });
  it('as the renderer does, a text layout with empty overlayText draws its keyword, so the keyword is checked', () => {
    const c = check(row6(bp({visualOverlays: [overlay('lockup', {keyword: 'editing monitor'})]})), 'overlay_text_in_transcript');
    expect(c.status).toBe('fail');
    expect(c.evidence[0]).toEqual({path: 'visualOverlays[0].keyword', value: 'editing monitor'});
    expect(check(row6(bp({visualOverlays: [overlay('lockup', {keyword: 'premiere pro'})]})), 'overlay_text_in_transcript').status).toBe('pass');
    // a blank-but-truthy overlayText is what the renderer draws (blank), so the keyword is not shown and not checked
    expect(check(row6(bp({visualOverlays: [overlay('lockup', {overlayText: ' ', keyword: 'editing monitor'})]})), 'overlay_text_in_transcript').status).toBe('pass');
  });
  it('the renderer rule is what the source says (source text)', () => {
    const track = read(SRC, '..', '..', 'remotion', 'src', 'components', 'VisualOverlayTrack.tsx');
    expect(track.match(/overlay\.overlayText \|\| overlay\.keyword/g)).toHaveLength(4);
    expect(track).toContain("if (overlay.layout === 'lockup' || overlay.layout === 'stat') {");
    expect(track).toContain("if (overlay.layout === 'banner') {");
    expect(track).toContain("if (overlay.layout === 'bubble') {");
    expect(track).toContain("if (overlay.layout === 'chip') {");
    expect(track).toContain("if (overlay.layout === 'pip' || overlay.layout === 'sticker' || overlay.layout === 'card') {\n    return <MediaCardView overlay={overlay} />;");
  });
});

describe('behind-subject text', () => {
  const entry = (text: string) => ({start: 0, end: 3, text, centerY: 0.3, widthFrac: 0.8, heightFrac: 0.2, curvature: 0, reveal: 'fade', reason: 'r', color: '#FFFFFF'});
  it('text that was not spoken fails; spoken text passes; an empty entry does not fail', () => {
    const bad = check(row6(bp({behindSubjectTexts: [entry('Totally invented')]})), 'behind_subject_text_in_transcript');
    expect(bad.status).toBe('fail');
    expect(bad.evidence[0]).toEqual({path: 'behindSubjectTexts[0].text', value: 'Totally invented'});
    expect(check(row6(bp({behindSubjectTexts: [entry('HOOK IS KEY')]})), 'behind_subject_text_in_transcript').status).toBe('pass');
    expect(check(row6(bp({behindSubjectTexts: [entry('')]})), 'behind_subject_text_in_transcript').status).toBe('pass');
  });
  it('the renderer draws clip.text (source text)', () => {
    expect(read(SRC, '..', '..', 'remotion', 'src', 'components', 'TextBehindSubjectTrack.tsx')).toContain('text={clip.text}');
  });
});

describe('the row as a whole', () => {
  it('no transcript still makes the whole row not_checked, even with unspoken text everywhere', () => {
    const everything = bp({generatedGraphics: [generated({title: 'Invented'})], visualOverlays: [overlay('lockup', {overlayText: 'Invented'})], behindSubjectTexts: [{text: 'Invented'}], motionGraphics: [{text: 'Invented'}]});
    for (const transcript of [null, '', '  ']) {
      const r = row6(everything, transcript);
      expect(r).toMatchObject({status: 'not_checked', complete: false});
      expect(r.checks.map(c => c.id)).toEqual(['graphic_text_in_transcript']);
    }
  });
  it('the five text checks are independent, and every failing one is reported', () => {
    const r = row6(bp({
      motionGraphics: [{text: 'Invented one'}], semanticEmphasis: [{text: 'Invented two'}], generatedGraphics: [generated({title: 'Invented three'})],
      visualOverlays: [overlay('chip', {overlayText: 'Invented four'})], behindSubjectTexts: [{text: 'Invented five'}],
    }));
    expect(r.checks.filter(c => c.status === 'fail').map(c => c.id)).toEqual(['motion_graphic_text_in_transcript', 'emphasis_text_in_transcript', 'generated_graphic_text_in_transcript', 'overlay_text_in_transcript', 'behind_subject_text_in_transcript']);
  });
  it('an edit with no text anywhere passes the text checks (five, plus the WP4P canvas-title and inset checks); the row is still incomplete', () => {
    const r = row6(bp());
    expect(r.checks.filter(c => c.status === 'pass').map(c => c.id)).toEqual(['motion_graphic_text_in_transcript', 'emphasis_text_in_transcript', 'generated_graphic_text_in_transcript', 'overlay_text_in_transcript', 'behind_subject_text_in_transcript', 'canvas_title_in_transcript', 'inset_text_in_transcript']);
    expect(r).toMatchObject({status: 'pass', complete: false});
  });
  it('the hook title and the opening treatment are not part of this row', () => {
    const r = row6(bp({hookTitle: 'Recommended Software', openingTreatment: {text: 'Totally invented opening', kind: 'plain'}}));
    expect(r.status).toBe('pass');
  });
  it('pixel quality, layout repetition and paraphrase fairness stay not_checked and are never passed', () => {
    for (const blueprint of [bp(), bp({generatedGraphics: [generated({title: 'Save time'})]})]) {
      const r = row6(blueprint);
      for (const id of ['pixel_quality', 'layout_repetition', 'paraphrase_fairness']) expect(check(r, id).status, id).toBe('not_checked');
    }
  });
  it('nothing is dropped or rewritten: a deep-frozen blueprint scores and comes out unchanged', () => {
    const deepFreeze = <T,>(value: T): T => {
      if (typeof value === 'object' && value !== null) {
        Object.values(value as object).forEach(deepFreeze);
        Object.freeze(value);
      }
      return value;
    };
    const blueprint = deepFreeze(bp({generatedGraphics: [generated({title: 'Recommended Software'})], visualOverlays: [overlay('lockup', {overlayText: 'Invented'})], behindSubjectTexts: [{text: 'Invented'}]}));
    const before = JSON.stringify(blueprint);
    expect(() => scoreRubric({blueprint, transcript: TRANSCRIPT})).not.toThrow();
    expect(JSON.stringify(blueprint)).toBe(before);
  });
  it('hostile shapes do not throw', () => {
    for (const blueprint of [{generatedGraphics: 'x', visualOverlays: [null, 3, {layout: 'lockup', overlayText: 5, keyword: {}}], behindSubjectTexts: [null, {text: 7}]}, {generatedGraphics: [{props: {content: {a: {b: {c: {d: {e: {f: {g: {h: {i: {j: 'deep words'}}}}}}}}}}}}]}, {generatedGraphics: [{props: 'x'}, {props: {content: null}}]}]) {
      expect(() => scoreRubric({blueprint, transcript: TRANSCRIPT})).not.toThrow();
    }
  });
});

describe('what the generated-graphic copy is (source text) and that there is still one matcher', () => {
  it('the worker passes only `content` (plus assets) as the graphic\'s props, and the brief schema calls it the exact copy', () => {
    const worker = read(SRC, 'motionWorker', 'worker.ts');
    expect(worker).toContain('props: Object.keys(assets).length > 0 ? {content: brief.content, assets} : {content: brief.content},');
    expect(read(SRC, 'motionWorker', 'brief.ts')).toContain('/** Exact copy and data; passed to the graphic at render time as `content`. */');
  });
  it('the scorer\'s row code still contains no matcher: it calls ungroundedWords and nothing else tokenises', () => {
    const code = read(HERE, 'rubricScorer.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const row = code.slice(code.indexOf('function scoreGraphics'), code.indexOf('function scoreIntegrity'));
    expect(row).toContain('ungroundedWords(entry.text, transcript)');
    expect(row).not.toMatch(/toLowerCase|normalize\(|\.split\(|new Set\(|\\p\{L\}/);
    expect(code).toContain("import {ungroundedWords} from '../stages/broll/groundedText.ts';");
  });
  it('the defaults are unchanged and the renderer and the writer do not know the scorer', () => {
    const env = read(SRC, 'config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
    for (const path of [['stages', 'broll', 'legibility.ts'], ['..', '..', 'remotion', 'src', 'components', 'VisualOverlayTrack.tsx']]) expect(read(SRC, ...path)).not.toMatch(/rubricScorer|scoreRubric/);
  });
});
