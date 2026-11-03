/**
 * WP3S pure tests: on the mvp profile, generated-graphic copy, text-overlay words and behind-subject text are held to the same rule as the motion graphics and emphasis (words the
 * speaker said). The pure functions are imported from stages/broll/legibility.ts; the matcher is the shared one. The offline scorer is run on the same fixtures to show the writer and
 * the scorer agree. analyzeVideo.ts imports the logger and is read as text. Import graph: legibility.ts (-> contrast, provenance, types, colorRoles, groundedText) and rubricScorer.ts
 * (-> lib/renderIntegrity.ts, groundedText.ts). No logger, `.env`, SDK, FFmpeg, Chromium, network, Gemini or Claude call.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {provenanceOf, stampProvenance} from '../lib/provenance.ts';
import {dropUngroundedBehindSubject, dropUngroundedGeneratedGraphics, generatedGraphicIsGrounded, groundOverlayText, TEXT_OVERLAY_LAYOUTS} from '../stages/broll/legibility.ts';
import {scoreRubric} from './rubricScorer.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');

type Json = Record<string, unknown>;
const TRANSCRIPT = 'Today I use After Effects and Premiere Pro to cut my videos. The hook is key, so save time. Spend 5M less on ads, 20% of it.';
const graphic = (content: unknown, over: Json = {}) => ({id: 'g', start: 4, end: 7, placement: {mode: 'split_screen', graphicSide: 'top'}, module: {url: 'staticFile:x.js', sha256: 'a'}, props: {content, theme: {fontDisplay: 'space_grotesk', primary: '#2DD4BF'}}, ...over});
const overlay = (layout: string, over: Json = {}) => ({start: 1, end: 3, layout, mediaKind: 'text', anchor: 'top_left', keyword: '', overlayText: '', assetUrl: '', provider: 'generated', providerId: 0, ...over});
const behind = (text: string, start = 0) => ({start, end: start + 3, text, centerY: 0.3, widthFrac: 0.8, heightFrac: 0.2, curvature: 0, reveal: 'fade', reason: 'r', color: '#FFFFFF'});
const TEXT_LAYOUTS = ['lockup', 'stat', 'banner', 'bubble', 'chip'];
const MEDIA_LAYOUTS = ['cutaway', 'split', 'composite', 'cutout', 'card', 'pip', 'sticker'];

describe('generated graphics', () => {
  it('a graphic whose copy has a word that was not said is dropped; its times and order are not touched', () => {
    const bad = graphic({title: 'Recommended Software', items: ['After Effects']}, {id: 'bad', start: 10});
    const good = graphic({title: 'Save time', items: ['After Effects', 'Premiere Pro']}, {id: 'good', start: 20});
    const r = dropUngroundedGeneratedGraphics([bad, good], TRANSCRIPT);
    expect(r.dropped).toEqual([bad]);
    expect(r.kept).toEqual([good]);
    expect(r.kept[0]).toBe(good);
    expect(r.kept[0]!.start).toBe(20);
  });
  it('one unspoken string anywhere in the copy (a nested row, a list item) is enough', () => {
    expect(generatedGraphicIsGrounded(graphic({rows: [{label: 'ads', value: '$5M'}, {label: 'Invented', value: '20%'}]}), TRANSCRIPT)).toBe(false);
    expect(generatedGraphicIsGrounded(graphic({rows: [{label: 'ads', value: '$5M'}, {label: 'of it', value: '20%'}]}), TRANSCRIPT)).toBe(true);
  });
  it('a graphic with no text stays: numbers, addresses, colours, an empty or missing content, no props', () => {
    for (const g of [graphic({value: 42, series: [1, 2]}), graphic({logo: 'https://cdn.example/a.png', c: '#00E5FF', l: 'staticFile:x'}), graphic({}), graphic(undefined, {props: undefined}), {id: 'bare', start: 1, end: 2}]) {
      expect(dropUngroundedGeneratedGraphics([g], 'anything').kept).toHaveLength(1);
    }
  });
  it('the theme, fonts and the brief are not copy', () => {
    expect(generatedGraphicIsGrounded(graphic({title: 'Save time'}, {brief: {purpose: 'Totally invented'}}), TRANSCRIPT)).toBe(true);
  });
});

describe('text overlays', () => {
  it('spoken words: the same object, untouched', () => {
    for (const layout of TEXT_LAYOUTS) {
      const o = overlay(layout, {overlayText: 'HOOK IS KEY'});
      const r = groundOverlayText([o], TRANSCRIPT);
      expect(r.overlays[0], layout).toBe(o);
      expect(r.dropped).toEqual([]);
      expect(r.cleared).toEqual([]);
    }
  });
  it('unspoken words and nothing else on the overlay: the overlay is dropped (every text layout)', () => {
    for (const layout of TEXT_LAYOUTS) {
      const o = overlay(layout, {overlayText: 'Totally invented claim'});
      const r = groundOverlayText([o], TRANSCRIPT);
      expect(r.overlays, layout).toEqual([]);
      expect(r.dropped, layout).toEqual([o]);
    }
  });
  it('with no overlayText the drawn words are the keyword, so an unspoken keyword drops a text-only overlay, a spoken one keeps it', () => {
    expect(groundOverlayText([overlay('lockup', {keyword: 'editing monitor'})], TRANSCRIPT).dropped).toHaveLength(1);
    expect(groundOverlayText([overlay('lockup', {keyword: 'premiere pro'})], TRANSCRIPT).dropped).toHaveLength(0);
  });
  it('spoken overlayText with an unspoken keyword stays: the keyword is not drawn when overlayText is present', () => {
    const o = overlay('chip', {overlayText: 'HOOK IS KEY', keyword: 'editing monitor'});
    expect(groundOverlayText([o], TRANSCRIPT).overlays[0]).toBe(o);
  });
  it('a blank but truthy overlayText draws blank, so nothing is claimed and nothing changes', () => {
    const o = overlay('lockup', {overlayText: ' ', keyword: 'editing monitor'});
    expect(groundOverlayText([o], TRANSCRIPT).overlays[0]).toBe(o);
  });
  it('unspoken words on an overlay that carries media: the overlay stays and loses its text (both fields, so no keyword fallback), times and the rest untouched', () => {
    for (const media of [{assetUrl: 'https://cdn.example/a.png'}, {slides: [{assetUrl: 'https://cdn.example/s1.png'}, {assetUrl: 'https://cdn.example/s2.png'}]}]) {
      const o = stampProvenance(overlay('stat', {overlayText: 'Invented', keyword: 'also invented', start: 12, end: 15, accentColor: '#fff', ...media}), {overlayText: 'director'});
      const r = groundOverlayText([o], TRANSCRIPT);
      expect(r.dropped).toEqual([]);
      expect(r.cleared).toHaveLength(1);
      const kept = r.overlays[0] as Json;
      expect(kept).not.toBe(o);
      expect(kept.overlayText).toBe('');
      expect(kept.keyword).toBe('');
      expect([kept.start, kept.end, kept.layout, kept.anchor, kept.accentColor]).toEqual([12, 15, 'stat', 'top_left', '#fff']);
      expect(provenanceOf(kept as object, 'overlayText')).toBe('director');
    }
  });
  it('a URL-only overlay stays: no words, nothing to remove', () => {
    for (const layout of [...TEXT_LAYOUTS, ...MEDIA_LAYOUTS]) {
      const o = overlay(layout, {mediaKind: 'image', assetUrl: 'https://cdn.example/a.png', provider: 'user', providerId: 1});
      const r = groundOverlayText([o], TRANSCRIPT);
      expect(r.overlays[0], layout).toBe(o);
      expect(r.cleared).toEqual([]);
      expect(r.dropped).toEqual([]);
    }
  });
  it('media layouts always stay: an ungrounded keyword is left alone, an ungrounded overlayText is cleared, a spoken one is untouched', () => {
    for (const layout of MEDIA_LAYOUTS) {
      const withKeyword = overlay(layout, {assetUrl: 'https://cdn.example/a.mp4', keyword: 'sunset beach'});
      expect(groundOverlayText([withKeyword], TRANSCRIPT).overlays[0], layout).toBe(withKeyword);
      const withText = overlay(layout, {assetUrl: 'https://cdn.example/a.mp4', overlayText: 'Invented', keyword: 'sunset beach', start: 8, end: 11});
      const r = groundOverlayText([withText], TRANSCRIPT);
      expect(r.dropped, layout).toEqual([]);
      expect((r.overlays[0] as Json).overlayText, layout).toBe('');
      expect((r.overlays[0] as Json).keyword, layout).toBe('sunset beach');
      expect([(r.overlays[0] as Json).start, (r.overlays[0] as Json).end]).toEqual([8, 11]);
      const spoken = overlay(layout, {assetUrl: 'https://cdn.example/a.mp4', overlayText: 'HOOK IS KEY'});
      expect(groundOverlayText([spoken], TRANSCRIPT).overlays[0]).toBe(spoken);
    }
  });
  it('order and count are kept except for dropped overlays; the text-layout set is the renderer\'s', () => {
    const a = overlay('lockup', {overlayText: 'HOOK IS KEY', start: 1});
    const b = overlay('lockup', {overlayText: 'Invented', start: 5});
    const c = overlay('card', {assetUrl: 'https://cdn.example/a.png', start: 9});
    expect(groundOverlayText([a, b, c], TRANSCRIPT).overlays).toEqual([a, c]);
    expect([...TEXT_OVERLAY_LAYOUTS].sort()).toEqual([...TEXT_LAYOUTS].sort());
  });
});

describe('behind-subject text', () => {
  it('text that was not spoken is not placed; spoken text is kept as the same object; empty text states nothing', () => {
    const bad = behind('Totally invented');
    const good = behind('HOOK IS KEY', 4);
    const empty = behind('', 8);
    const r = dropUngroundedBehindSubject([bad, good, empty], TRANSCRIPT);
    expect(r.dropped).toEqual([bad]);
    expect(r.kept).toEqual([good, empty]);
    expect(r.kept[0]).toBe(good);
  });
});

describe('the writer and the offline scorer agree', () => {
  const blueprint = (over: Json): Json => ({width: 1080, height: 1920, outputDurationSec: 30, hookTitle: 'Recommended Software', motionGraphics: [], semanticEmphasis: [], generatedGraphics: [], visualOverlays: [], behindSubjectTexts: [], brollClips: [], ...over});
  const scoreChecks = (bp: Json) => Object.fromEntries(scoreRubric({blueprint: bp, transcript: TRANSCRIPT}).rows.find(r => r.row === 6)!.checks.map(c => [c.id, c.status]));
  it('a blueprint that fails the scorer\'s three new checks passes all of them after the writer\'s functions are applied (the hook title is untouched)', () => {
    const graphics = [graphic({title: 'Recommended Software'}, {id: 'a'}), graphic({title: 'Save time'}, {id: 'b'})];
    const overlays = [overlay('lockup', {overlayText: 'Invented'}), overlay('chip', {overlayText: 'Invented', assetUrl: 'https://cdn.example/i.png'}), overlay('card', {assetUrl: 'https://cdn.example/a.png', overlayText: 'Invented', keyword: 'sunset'}), overlay('banner', {overlayText: 'HOOK IS KEY'})];
    const texts = [behind('Totally invented'), behind('HOOK IS KEY', 5)];
    const before = scoreChecks(blueprint({generatedGraphics: graphics, visualOverlays: overlays, behindSubjectTexts: texts}));
    expect(before).toMatchObject({generated_graphic_text_in_transcript: 'fail', overlay_text_in_transcript: 'fail', behind_subject_text_in_transcript: 'fail'});
    const after = blueprint({
      generatedGraphics: dropUngroundedGeneratedGraphics(graphics, TRANSCRIPT).kept,
      visualOverlays: groundOverlayText(overlays, TRANSCRIPT).overlays,
      behindSubjectTexts: dropUngroundedBehindSubject(texts, TRANSCRIPT).kept,
    });
    expect(scoreChecks(after)).toMatchObject({generated_graphic_text_in_transcript: 'pass', overlay_text_in_transcript: 'pass', behind_subject_text_in_transcript: 'pass'});
    expect((after.hookTitle as string)).toBe('Recommended Software');
  });
  it('on a grid of contents the writer drops a graphic exactly when the scorer would fail it', () => {
    const contents = [{title: 'Save time'}, {title: 'Recommended Software'}, {items: ['After Effects', 'Invented']}, {rows: [{a: '$5M'}, {a: '20%'}]}, {a: 1, b: 'https://x.test/y.png'}, {}, {title: 'Premiere Pro', sub: {deep: {text: 'unspoken words'}}}];
    for (const content of contents) {
      const g = graphic(content);
      const writerDrops = dropUngroundedGeneratedGraphics([g], TRANSCRIPT).dropped.length === 1;
      const scorerFails = scoreChecks(blueprint({generatedGraphics: [g]})).generated_graphic_text_in_transcript === 'fail';
      expect(writerDrops, JSON.stringify(content)).toBe(scorerFails);
    }
  });
  it('and the same for overlays: the writer touches an overlay exactly when the scorer would fail it', () => {
    const cases = [overlay('lockup', {overlayText: 'HOOK IS KEY'}), overlay('lockup', {overlayText: 'Invented'}), overlay('lockup', {keyword: 'editing monitor'}), overlay('chip', {overlayText: 'Invented', assetUrl: 'https://x/a.png'}), overlay('card', {assetUrl: 'https://x/a.png', keyword: 'sunset'}), overlay('cutaway', {assetUrl: 'https://x/a.mp4', overlayText: 'Invented'}), overlay('banner', {overlayText: ' ', keyword: 'editing monitor'})];
    for (const o of cases) {
      const r = groundOverlayText([o], TRANSCRIPT);
      const touched = r.dropped.length + r.cleared.length > 0;
      const scorerFails = scoreChecks(blueprint({visualOverlays: [o]})).overlay_text_in_transcript === 'fail';
      // A media layout's ungrounded overlayText is cleared though the scorer (which reads only words the renderer draws) does not fail it.
      const mediaLayout = !TEXT_OVERLAY_LAYOUTS.has(String(o.layout));
      expect(touched, JSON.stringify(o)).toBe(mediaLayout ? o.overlayText === 'Invented' : scorerFails);
    }
  });
});

describe('wiring (source text; analyzeVideo imports the logger)', () => {
  const av = read('pipeline', 'analyzeVideo.ts');
  const block = av.slice(av.indexOf("if (mvpLike && !captionsOnly) {"), av.indexOf('const finalized = finalizeEdits({'));
  it('runs only for mvp outside caption-only mode, before the shared validator, with the transcript the motion filter uses', () => {
    expect(av.match(/dropUngroundedGeneratedGraphics\(/g)).toHaveLength(1);
    expect(av.match(/groundOverlayText\(/g)).toHaveLength(1);
    expect(block).toContain('dropUngroundedGeneratedGraphics(motion.generatedGraphics, transcription.transcript)');
    expect(block).toContain('dropUngroundedBehindSubject(motion.behindSubjectTexts, transcription.transcript)');
    expect(block).toContain('groundOverlayText(broll.overlays, transcription.transcript)');
    expect(block.indexOf('groundOverlayText(')).toBeLessThan(block.length);
  });
  it('records every drop in the ledger as ungrounded_text, moves nothing in time, never touches the hook, and builds no new treatment', () => {
    expect(block.match(/ledger\.drop\([^)]*'ungrounded_text'\)/g)).toHaveLength(5); // the earlier motion-graphic/emphasis drop (WP2C), the three added here, and the baked-text drop added in WP3T
    expect(block).toContain("ledger.findByLabel('generated_graphic', graphic.id, graphic.start)");
    expect(block).toContain("ledger.find('generated_graphic', text.start, 0.001)");
    expect(block).toContain('motion = {...motion, generatedGraphics: grounded.kept, behindSubjectTexts: behind.kept};');
    const added = block.slice(block.indexOf('// WP3S'), block.indexOf('if (!openingSpec) {'));
    expect(added).not.toMatch(/hookTitle|decideTextTreatment|runMotionGraphicsStage|callDirectorModel|\.start\s*=|\.end\s*=/);
  });
  it('the behind-subject fallback is a stage-time decision (a layered panel built by the Claude worker), so after the fact the entry is dropped', () => {
    const treatment = read('stages', 'textTreatment', 'textTreatment.ts');
    expect(treatment).toContain("treatment: {...treatment, kind: 'layered', reveal: treatment.reveal ?? 'wipe-right'},");
    expect(read('stages', 'motionDirector', 'index.ts')).toContain('toolkitGraphics.push({...graphic, brief: {...graphic.brief, textTreatment: decision.treatment}});');
  });
  it('there is still one matcher: the new functions call isGroundedInTranscript and the writer has no tokeniser of its own', () => {
    const legibility = read('stages', 'broll', 'legibility.ts');
    expect(legibility).toContain("import {isGroundedInTranscript} from './groundedText.ts';");
    expect(legibility).not.toMatch(/\\p\{L\}|toLowerCase|normalize\(/);
    expect(read('stages', 'broll', 'groundedText.ts')).toContain('[^\\p{L}\\p{N}$%€£]+');
  });
  it('the legacy path cannot reach any of this: only analyzeVideo imports the writer, and the scorer was not changed', () => {
    const scorerCode = read('eval', 'rubricScorer.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(scorerCode).not.toMatch(/groundOverlayText|dropUngroundedGeneratedGraphics|from '[^']*legibility\.ts'/);
    const env = read('config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
