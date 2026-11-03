/**
 * WP32: photo-as-world ImageRun backdrop + chest-band bare type. Offline: no render, no network, no model.
 *   1. ImageRun composition: `backdrop` ('blur_self' | 'dim' | 'none'); dim stays the default; blur_self draws each still's own blurred bleed behind the sharp framed one
 *   2. library registry carries `backdrop` to the module (blur_self / none only; dim = absent; junk ignored)
 *   3. editorial runs ask for blur_self, labeled runs keep the dim veil, and it reaches the published module source
 *   4. polish bare type is chest-band weight through ONE path (the caption direction): fontScale 1.4 + 2 words a line; explicit non-pill caller templates keep their size; idempotent; schema-valid
 *   5. renderer + wiring pins (KineticCaptions honours maxWords; analyze still runs the single switch)
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {captionDirectionSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {POLISH_BARE_FONT_SCALE, POLISH_BARE_MAX_WORDS, PILL_CHROME_TEMPLATES, isGlossyPillCaption, polishBareCaption} from '../../lib/polishBareCaption.ts';
import type {MotionGraphicResult} from '../../motionWorker/worker.ts';
import {resolveLibraryGraphic} from '../motionDirector/libraryRegistry.ts';
import {EDITORIAL_BACKDROP, planEditorialStillMontage, type EditorialPhotoResolver} from './editorialStillMontage.ts';
import {publishImageRuns, type ImageRunPublisher} from './imageRunPublish.ts';
import {shineCaptionDirection} from './geminiDirector.ts';
import type {ImageRunPlan} from './labeledAssetPlacement.ts';
import type {CaptionWordLike} from './klipyContextQuery.ts';
import type {CaptionDirection} from '../../types/blueprint.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const imageRun = read('../../../../remotion/src/motion/compositions/ImageRun.tsx');
const kinetic = read('../../../../remotion/src/components/KineticCaptions.tsx');
const analyze = read('../../pipeline/analyzeVideo.ts');

const brief = (content: Record<string, unknown>) => ({goal: 'show', visualDescription: 'stills', placement: 'full_screen' as const, content});
const ITEMS = [{src: 'https://cdn.example.com/a.jpg'}, {src: 'https://cdn.example.com/b.jpg'}, {src: 'https://cdn.example.com/c.jpg'}];

describe('WP32 1) ImageRun backdrop', () => {
  it('declares the backdrop prop with blur_self / dim / none; dim (the veil) is still the default', () => {
    expect(imageRun).toContain("export type ImageRunBackdrop = 'blur_self' | 'dim' | 'none';");
    expect(imageRun).toContain('backdrop?: ImageRunBackdrop;');
    expect(imageRun).toContain("const world: ImageRunBackdrop = backdrop ?? 'dim';");
    expect(imageRun).toMatch(/world === 'dim' \? <AbsoluteFill style=\{\{backgroundColor: fill\}\} \/> : null/);
  });
  it('blur_self paints the still\'s OWN copy (cover, blurred, darkened, slow push-in), per still and outside the pop, so the photo is the world', () => {
    expect(imageRun).toContain('const PhotoWorld');
    expect(imageRun).toMatch(/<Img src=\{src\} style=\{\{[^\n]*objectFit: 'cover'[^\n]*filter: IMAGE_RUN_BACKDROP_FILTER/);
    expect(imageRun).toContain('IMAGE_RUN_BACKDROP_FILTER = `blur(');
    // WP35: the per-still world is handed to StillSlide, which draws it first and the CutPop card on top (the world is dropped while the card flies out)
    expect(imageRun).toContain("world={world === 'blur_self' ? <PhotoWorld src={item.src} /> : null}");
    expect(imageRun).toMatch(/\{world\}\s*<CutPop>\{children\}<\/CutPop>/);
    expect(imageRun).toMatch(/world === 'blur_self' \? <PhotoWorld src=\{lead!\.src\} \/> : veil/);
  });
  it('the bleed is not a flat colour world: it is the photo, blurred (>= 18 px), darkened and slightly desaturated, never opaque black alone', () => {
    const blur = Number(/IMAGE_RUN_BACKDROP_BLUR_PX = (\d+)/.exec(imageRun)?.[1]);
    expect(blur).toBeGreaterThanOrEqual(18);
    expect(blur).toBeLessThanOrEqual(40);
    expect(imageRun).toMatch(/IMAGE_RUN_BACKDROP_FILTER = `blur\(\$\{IMAGE_RUN_BACKDROP_BLUR_PX\}px\) saturate\(0\.\d+\) brightness\(0\.[5-9]\d*\)`/);
    expect(imageRun).toMatch(/IMAGE_RUN_BACKDROP_SCALE_TO = 1\.\d+/);
  });
  it('the composition is exported with the backdrop type', () => {
    expect(read('../../../../remotion/src/motion/index.ts')).toContain('type ImageRunBackdrop');
  });
});

describe('WP32 2) registry passes the backdrop', () => {
  it('blur_self and none reach the ImageRun props; dim / absent / junk add nothing (the default veil)', () => {
    const blur = resolveLibraryGraphic(brief({imageRun: ITEMS, backdrop: 'blur_self', fit: 'cover'}));
    expect(blur?.compositionId).toBe('ImageRun');
    expect(blur?.props).toMatchObject({backdrop: 'blur_self', fit: 'cover'});
    const none = resolveLibraryGraphic(brief({imageRun: ITEMS, backdrop: 'none'}));
    expect(none?.props).toMatchObject({backdrop: 'none'});
    for (const backdrop of ['dim', undefined, 'sparkle', 3]) {
      const hit = resolveLibraryGraphic(brief({imageRun: ITEMS, ...(backdrop === undefined ? {} : {backdrop})}));
      expect(hit?.compositionId).toBe('ImageRun');
      expect(hit?.props).not.toHaveProperty('backdrop');
    }
  });
  it('the prop schema string advertises it', () => {
    expect(read('../motionDirector/libraryRegistry.ts')).toContain("backdrop?:'dim'|'blur_self'|'none'");
  });
});

describe('WP32 3) editorial runs own the frame with blur_self; labeled runs keep the veil', () => {
  const SENTENCES = ['He built a startup in a tiny office and raised a billion dollars', 'Then the company collapsed and everyone was fired in a single week', 'Everybody scrolling their phone watched the news headline spread'];
  const words: CaptionWordLike[] = [];
  let at = 0.2;
  for (const sentence of SENTENCES) {
    for (const text of sentence.split(/\s+/)) {
      words.push({text, start: Math.round(at * 1000) / 1000, end: Math.round((at + 0.3) * 1000) / 1000});
      at += 0.35;
    }
    at += 0.7;
  }
  const resolver = (): EditorialPhotoResolver => {
    let next = 5000;
    return async () => {
      next += 1;
      return {assetUrl: `https://images.example.com/p${next}.jpg`, provider: 'pexels', providerId: next};
    };
  };
  const okPublisher: ImageRunPublisher = async (briefInput, source) => {
    const b = briefInput as {id: string; assets: Array<{id: string; url: string}>};
    return {id: b.id, module: {url: 'https://r2.example.com/m.js', sha256: 'x'}, placement: {mode: 'full_screen'}, props: {content: {}, assets: Object.fromEntries(b.assets.map(a => [a.id, {src: a.url}]))}, brief: {}, source} as unknown as MotionGraphicResult;
  };

  it('every editorial run is planned with backdrop blur_self (and still fit cover)', async () => {
    const montage = await planEditorialStillMontage({words, outputDurationSec: 30, resolver: resolver()});
    expect(montage.runs.length).toBeGreaterThan(0);
    expect(EDITORIAL_BACKDROP).toBe('blur_self');
    for (const run of montage.runs) expect(run).toMatchObject({fit: 'cover', backdrop: 'blur_self'});
  });
  it('the published module source carries "backdrop": "blur_self" for editorial runs and nothing for a labeled run', async () => {
    const montage = await planEditorialStillMontage({words, outputDurationSec: 30, resolver: resolver()});
    const seen: string[] = [];
    const spy: ImageRunPublisher = async (b, source) => { seen.push(source); return okPublisher(b, source); };
    await publishImageRuns(montage.runs.slice(0, 1), {publisher: spy, idPrefix: 'editorial_run'});
    expect(seen[0]).toMatch(/"backdrop": "blur_self"/);
    const labeled: ImageRunPlan = {start: 1, end: 5, mode: 'sequence', items: ITEMS.map(item => ({src: item.src})), slotIds: ['logo_a', 'logo_b', 'logo_c'], cutAts: []};
    const result = await publishImageRuns([labeled], {publisher: spy});
    expect(result.published).toHaveLength(1);
    expect(seen[1]).not.toMatch(/"backdrop"/);
  });
  it('the labeled-asset planner never sets a backdrop (logos / screenshots are not photo worlds)', () => {
    expect(read('./labeledAssetPlacement.ts')).not.toMatch(/backdrop:\s*'blur_self'/);
  });
});

describe('WP32 4) chest-band bare type through the caption direction', () => {
  const bare = (over: Partial<CaptionDirection> = {}, templateLocked = false) => polishBareCaption({...shineCaptionDirection(), ...over}, {lookId: 'clean_mono', templateLocked});

  it('the tokens: scale 1.4 (the largest the caption-split legibility band is built for) and 2 words a line', () => {
    expect(POLISH_BARE_FONT_SCALE).toBe(1.4);
    expect(POLISH_BARE_MAX_WORDS).toBe(2);
    expect(read('../../../../remotion/src/lib/captionSplit.ts')).toContain('100 px at fontScale 1.4');
  });
  it('a polish edit ships bigger, shorter-line bare type: fontScale 1.4, maxWords 2, still no pill / plate / glow', () => {
    const {caption, warnings} = bare();
    expect(caption.fontScale).toBe(POLISH_BARE_FONT_SCALE);
    expect(caption.maxWords).toBe(POLISH_BARE_MAX_WORDS);
    expect(isGlossyPillCaption(caption)).toBe(false);
    expect(caption.boxColor).toBeNull();
    expect(caption.glow).toBe(false);
    expect(caption.animation).not.toBe('highlight');
    expect(warnings).toContain('polish_caption_scale:1.4:2');
    expect(() => captionDirectionSchema.parse(caption)).not.toThrow();
  });
  it('the size is look-independent: every look gets the same chest-band weight with its own ink', () => {
    for (const lookId of ['paper_lime', 'ink_white', 'night_amber', 'clean_mono'] as const) {
      const {caption} = polishBareCaption(shineCaptionDirection(), {lookId, templateLocked: false});
      expect(caption).toMatchObject({fontScale: 1.4, maxWords: 2});
    }
  });
  it('already-typed polish captions (the WP13C block ran first) are still sized', () => {
    const typed = {...shineCaptionDirection(), animation: 'scale' as const, activeStyle: 'fill' as const, strokeColor: '#000000', strokeWidthEm: 0.08, glow: false as const};
    const {caption} = polishBareCaption(typed, {lookId: 'ink_white', templateLocked: false});
    expect(caption).toMatchObject({fontScale: 1.4, maxWords: 2});
  });
  it('never shrinks what the Director already made bigger or tighter (max scale, min words)', () => {
    const {caption} = bare({fontScale: 1.4, maxWords: 1});
    expect(caption).toMatchObject({fontScale: 1.4, maxWords: 1});
    const bigger = polishBareCaption({...shineCaptionDirection(), fontScale: 1.6}, {lookId: 'ink_white', templateLocked: false});
    expect(bigger.caption.fontScale).toBe(1.6);
  });
  it('a replaced plate template is sized too, even when the caller locked it; an explicit non-pill caller template keeps its own size', () => {
    for (const id of PILL_CHROME_TEMPLATES) {
      const {caption} = bare({template: id, animation: 'box', boxColor: 'rgba(0,0,0,0.72)'}, true);
      expect(caption).toMatchObject({template: 'karaoke', fontScale: 1.4, maxWords: 2});
    }
    const hormozi = {...shineCaptionDirection(), template: 'hormozi' as const, animation: 'scale' as const, boxColor: null, textColor: '#FFFFFF', highlightColor: '#00FFFF'};
    const locked = polishBareCaption(hormozi, {lookId: 'ink_white', templateLocked: true});
    expect(locked.caption).toBe(hormozi);
    expect(locked.caption.fontScale).toBe(1);
  });
  it('is idempotent and does not mutate its input', () => {
    const input = shineCaptionDirection();
    const snapshot = JSON.stringify(input);
    const once = polishBareCaption(input, {lookId: 'ink_white', templateLocked: false});
    expect(JSON.stringify(input)).toBe(snapshot);
    const twice = polishBareCaption(once.caption, {lookId: 'ink_white', templateLocked: false});
    expect(twice.caption).toBe(once.caption);
    expect(twice.warnings).toEqual([]);
  });
});

describe('WP32 5) renderer + wiring pins', () => {
  it('KineticCaptions caps the words on screen with the direction\'s maxWords (it wins over the content-type default)', () => {
    expect(kinetic).toMatch(/direction\?\.maxWords \?\?/);
    expect(kinetic).toContain('[words, design?.contentType, direction?.maxWords]');
  });
  it('the direction schema accepts maxWords (1-6) and rejects nonsense', () => {
    const base = {position: 'bottom' as const, bottomFrac: 0.2};
    expect(captionDirectionSchema.parse({...base, maxWords: 2}).maxWords).toBe(2);
    expect(() => captionDirectionSchema.parse({...base, maxWords: 0})).toThrow();
    expect(() => captionDirectionSchema.parse({...base, maxWords: 2.5})).toThrow();
  });
  it('analyze still has ONE polish bare-type switch (no second sizing path) and the editorial montage path is unchanged', () => {
    expect(analyze.split('\n').filter(line => line.includes('polishBareCaption(')).length).toBe(1);
    expect(analyze).not.toMatch(/POLISH_BARE_FONT_SCALE|fontScale:\s*1\.4/);
    expect(analyze).toMatch(/idPrefix: 'editorial_run'/);
  });
  it('the offline proof renders the PRODUCTION ImageRun with the backdrop prop and the real server directions', () => {
    const entry = read('../../../../remotion/scripts/wp32/entry.tsx');
    expect(entry).toContain("import {ImageRun, type ImageRunBackdrop} from '../../src/motion/compositions/ImageRun';");
    expect(entry).toContain("{new: 'blur_self', old: 'dim'}");
    expect(entry).toContain("wp32-directions.json");
    expect(read('../../../../remotion/scripts/wp32-preview.mjs')).toContain('polishBareCaption.ts');
  });
});
