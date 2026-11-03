/**
 * WP2B pure tests: hook fit, caption rules, plate-text contrast, ungrounded fallback text, the B-roll-split caption placement, and (by source text) the gating of every wiring point.
 * Import graph: legibility.ts -> contrast.ts, provenance.ts -> types/blueprint.ts (constants only), colorRoles.ts -> contrast.ts; remotion/src/lib/captionSplit.ts (type-only import).
 * No logger, `.env`, SDK, FFmpeg or network. The wired modules (analyzeVideo, HookTitle, ShortVideo) import the logger / React / Remotion and are checked by reading their source.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {contrastRatio, hexLuminance} from '../lib/contrast.ts';
import {provenanceOf, stampProvenance} from '../lib/provenance.ts';
import {applyLegibility, CAPTION, dropUngroundedText, fitHookTitle, HOOK, isGroundedInTranscript, legibleCaption, legibleOnScreenText} from '../stages/broll/legibility.ts';
import type {CaptionDirection, MotionGraphic, SemanticEmphasis} from '../types/blueprint.ts';
import {captionsForBrollSplit} from '../../../remotion/src/lib/captionSplit.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REMOTION = resolve(SRC, '..', '..', 'remotion', 'src');
const read = (...parts: string[]) => readFileSync(resolve(...parts), 'utf8');
const W = 1080;
const H = 1920;

describe('contrast helper (moved, behaviour unchanged)', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(hexLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#FFFFFF', '#FACC15')).toBeLessThan(2); // the fallback "block" graphic
  });
  it('contentProfile re-exports it instead of keeping a second copy', () => {
    const text = read(SRC, 'stages', 'contentProfile', 'contentProfile.ts');
    expect(text).toContain("from '../../lib/contrast.ts'");
    expect(text).toContain('export {contrastRatio, hexLuminance};');
    expect(text).not.toContain('export function contrastRatio');
  });
});

describe('fitHookTitle', () => {
  const fit = (title: string, extra: Partial<Parameters<typeof fitHookTitle>[0]> = {}) => fitHookTitle({title, canvasWidth: W, canvasHeight: H, ...extra});
  const bottomOf = (r: ReturnType<typeof fit>) => r.fit!.topFrac + r.fit!.heightFrac;

  it('keeps a short title whole, at the large size, in the top safe band', () => {
    const r = fit('STOP SCROLLING');
    expect(r.title).toBe('STOP SCROLLING');
    expect(r.fit!.sizeFrac).toBe(HOOK.sizeMaxFrac);
    expect(r.fit!.topFrac).toBeGreaterThanOrEqual(0.06);
    expect(r.fit!.clearBand).toBe(true);
    expect(r.warnings).toEqual([]);
  });
  it('reduces size before it drops any word, and never goes under the readable floor', () => {
    const r = fit('Why most people never finish anything');
    expect(r.fit!.sizeFrac).toBeLessThan(HOOK.sizeMaxFrac);
    expect(r.fit!.sizeFrac).toBeGreaterThanOrEqual(HOOK.sizeFloorFrac);
    expect(r.title).toBe('Why most people never finish anything');
  });
  it('drops words from the END only, when no size fits', () => {
    const r = fit('Understanding extraordinarily complicated international regulations quickly');
    expect(r.fit!.sizeFrac).toBeGreaterThanOrEqual(HOOK.sizeFloorFrac);
    expect('Understanding extraordinarily complicated international regulations quickly'.startsWith(r.title)).toBe(true);
    expect(r.title.split(' ').length).toBeLessThan(6);
    expect(r.warnings.some(item => item.startsWith('hook_shortened:'))).toBe(true);
    expect(r.fit!.lines).toBeLessThanOrEqual(HOOK.maxLines);
  });
  it('never exceeds two lines or the band above a measured head region', () => {
    for (const title of ['A', 'ONE TWO', 'THE SECRET NOBODY TELLS YOU', 'HOW I BUILT A BUSINESS FROM ZERO IN SIX MONTHS']) {
      for (const top of [0.16, 0.22, 0.3]) {
        const r = fit(title, {speakerTopFrac: top, speakerSource: 'vision'});
        if (r.fit!.clearBand) expect(bottomOf(r)).toBeLessThanOrEqual(top - HOOK.marginFrac + 1e-9);
        expect(r.fit!.lines).toBeLessThanOrEqual(2);
        expect(r.fit!.sizeFrac).toBeGreaterThanOrEqual(HOOK.sizeFloorFrac);
      }
    }
  });
  it('without a measured speaker box it still stays above the assumed head line', () => {
    const r = fit('THE SECRET NOBODY TELLS YOU', {speakerSource: 'fallback', speakerTopFrac: 0.01});
    expect(bottomOf(r)).toBeLessThanOrEqual(HOOK.defaultClearBottomFrac);
  });
  it('reports, and does not hide, a head that leaves no clear band', () => {
    const r = fit('STOP SCROLLING NOW', {speakerTopFrac: 0.08, speakerSource: 'vision'});
    expect(r.fit!.clearBand).toBe(false);
    expect(r.warnings).toContain('hook_no_clear_band');
    expect(r.fit!.topFrac).toBe(HOOK.noBandTopFrac);
  });
  it('a single word wider than the safe width is kept as given and reported (letters are never cut)', () => {
    const r = fit('Supercalifragilisticexpialidocious');
    expect(r.title).toBe('Supercalifragilisticexpialidocious');
    expect(r.warnings).toContain('hook_word_wider_than_safe_width');
  });
  it('an empty title yields no fit', () => {
    expect(fit('   ')).toEqual({title: '', fit: null, warnings: []});
  });
  it('the hook ink, accent and plate reach 4.5:1', () => {
    expect(contrastRatio(HOOK.inkColor, HOOK.plateColor)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(HOOK.accentColor, HOOK.plateColor)).toBeGreaterThanOrEqual(4.5);
  });
  it('has no time input at all: the hook is never moved in time', () => {
    const text = read(SRC, 'stages', 'broll', 'legibility.ts');
    expect(text).not.toMatch(/hookStartSec|hookDurationSec|startSec|timestamp/);
  });
});

describe('legibleCaption', () => {
  const base: CaptionDirection = {position: 'bottom', bottomFrac: 0.18, textColor: '#FFFFFF', highlightColor: '#FFD700', boxColor: null, template: 'hormozi'};
  it('leaves an already legible caption untouched', () => {
    const r = legibleCaption(base);
    expect(r.changes).toEqual([]);
    expect(r.caption).toEqual(base);
  });
  it('replaces one-word templates and leaves line-grouped ones', () => {
    for (const template of ['simple-one-word', 'simple-one-word-theme', 'kinetic-slam'] as const) {
      expect(legibleCaption({...base, template}).caption.template).toBe(CAPTION.replacementTemplate);
    }
    expect(legibleCaption({...base, template: 'kinetic-01'}).caption.template).toBe('kinetic-01');
  });
  it('lifts a tiny scale to the floor, caps a huge one, and leaves an absent scale absent', () => {
    expect(legibleCaption({...base, fontScale: 0.7}).caption.fontScale).toBe(1);
    expect(legibleCaption({...base, fontScale: 2}).caption.fontScale).toBe(1.4);
    expect(legibleCaption({...base, fontScale: 1.2}).caption.fontScale).toBe(1.2);
    expect('fontScale' in legibleCaption(base).caption && legibleCaption(base).caption.fontScale !== undefined).toBe(false);
  });
  it('moves top/centre/lower-third captions off the face and clamps the bottom offset', () => {
    for (const position of ['top', 'center', 'lower_third'] as const) expect(legibleCaption({...base, position}).caption.position).toBe('bottom');
    expect(legibleCaption({...base, bottomFrac: 0.05}).caption.bottomFrac).toBe(CAPTION.minBottomFrac);
    expect(legibleCaption({...base, bottomFrac: 0.6}).caption.bottomFrac).toBe(CAPTION.maxBottomFrac);
  });
  it('fixes light text on a light box, and is idempotent', () => {
    const r = legibleCaption({...base, textColor: '#FFFFFF', boxColor: '#F7F4EE'});
    expect(contrastRatio(r.caption.textColor, '#F7F4EE')).toBeGreaterThanOrEqual(4.5);
    expect(r.changes).toContain('caption_text_vs_box');
    expect(legibleCaption(r.caption).changes).toEqual([]);
  });
  it('the split box colour keeps white text above 4.5:1 even over white footage', () => {
    const worst = 0.82 * 0 + 0.18 * 255; // darkest channel after 82% of near-black over pure white
    const blended = `#${[0, 1, 2].map(() => Math.round(worst).toString(16).padStart(2, '0')).join('')}`;
    expect(contrastRatio('#FFFFFF', blended)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('on-screen text on a plate', () => {
  const graphic = (over: Partial<MotionGraphic>): MotionGraphic => ({
    start: 4, end: 6, text: 'CONTROL EMOTIONS', role: 'primary', shape: 'block', accentColor: '#FACC15', textColor: '#FFFFFF', anchor: 'top_right', entrance: 'scale_pop', exit: 'fade', fontScale: 1.18, ...over,
  });
  it('white text on the yellow block plate becomes readable', () => {
    const r = legibleOnScreenText({motionGraphics: [graphic({})], semanticEmphasis: []});
    expect(contrastRatio(r.motionGraphics[0]!.textColor, '#FACC15')).toBeGreaterThanOrEqual(4.5);
    expect(r.recolored).toBe(1);
  });
  it('covers every plate shape and leaves plate-less shapes and already readable pairs alone', () => {
    for (const shape of ['pill', 'bar', 'block', 'bubble'] as const) {
      const r = legibleOnScreenText({motionGraphics: [graphic({shape, accentColor: '#FDE68A', textColor: '#FFFFFF'})], semanticEmphasis: []});
      expect(contrastRatio(r.motionGraphics[0]!.textColor, '#FDE68A'), shape).toBeGreaterThanOrEqual(4.5);
    }
    for (const shape of ['none', 'underline', 'outline_box'] as const) {
      const item = graphic({shape});
      expect(legibleOnScreenText({motionGraphics: [item], semanticEmphasis: []}).motionGraphics[0]).toBe(item);
    }
    const ok = graphic({accentColor: '#22D3EE', textColor: '#0F172A', shape: 'pill'});
    expect(legibleOnScreenText({motionGraphics: [ok], semanticEmphasis: []}).motionGraphics[0]).toBe(ok);
  });
  it('treats highlight_shape emphasis the same way and ignores other treatments', () => {
    const emphasis = (treatment: SemanticEmphasis['treatment']): SemanticEmphasis => ({start: 1, end: 2, text: 'FAST', weight: 'primary', treatment, accentColor: '#FDE68A'});
    const r = legibleOnScreenText({motionGraphics: [], semanticEmphasis: [emphasis('highlight_shape'), emphasis('scale')]});
    expect(contrastRatio(r.semanticEmphasis[0]!.textColor!, '#FDE68A')).toBeGreaterThanOrEqual(4.5);
    expect(r.semanticEmphasis[1]!.textColor).toBeUndefined();
  });
  it('keeps the provenance of fields it did not change', () => {
    const item = stampProvenance(graphic({}), {accentColor: 'fallback', textColor: 'fallback', start: 'director'});
    const out = legibleOnScreenText({motionGraphics: [item], semanticEmphasis: []}).motionGraphics[0]!;
    expect(provenanceOf(out, 'accentColor')).toBe('fallback');
    expect(provenanceOf(out, 'start')).toBe('director');
    expect(provenanceOf(out, 'textColor')).toBeUndefined(); // changed value: origin unknown, never invented
  });
});

describe('ungrounded on-screen text (WP2B rule superseded by WP2C: see wp2cContrastAndUngrounded.test.ts)', () => {
  const transcript = 'Today I want to talk about controlling your emotions when work gets stressful.';
  const item = (text: string, fallback: boolean): MotionGraphic => {
    const g: MotionGraphic = {start: 1, end: 3, text, role: 'primary', shape: 'pill', accentColor: '#22D3EE', textColor: '#0F172A', anchor: 'top_left', entrance: 'scale_pop', exit: 'fade', fontScale: 1};
    return fallback ? stampProvenance(g, {accentColor: 'fallback', textColor: 'fallback'}) : g;
  };
  it('groundedness ignores case and punctuation and requires every word', () => {
    expect(isGroundedInTranscript('Controlling your EMOTIONS!', transcript)).toBe(true);
    expect(isGroundedInTranscript('Recommended Software', transcript)).toBe(false);
  });
  it('drops the placeholder and every ungrounded item, fallback or Director; keeps grounded ones', () => {
    const items = [item('WATCH THIS', false), item('Recommended Software', true), item('your emotions', true), item('Recommended Software', false)];
    const r = dropUngroundedText(items, transcript);
    expect(r.dropped.map(x => x.text)).toEqual(['WATCH THIS', 'Recommended Software', 'Recommended Software']);
    expect(r.kept.map(x => x.text)).toEqual(['your emotions']);
  });
});

describe('applyLegibility', () => {
  const caption: CaptionDirection = {position: 'center', bottomFrac: 0.1, textColor: '#FFFFFF', highlightColor: '#FFD700', boxColor: null, template: 'simple-one-word', fontScale: 0.8};
  const out = applyLegibility({hookTitle: 'THE SECRET NOBODY TELLS YOU', canvasWidth: W, canvasHeight: H, speakerTopFrac: 0.3, speakerSource: 'vision', caption, motionGraphics: [], semanticEmphasis: [], transcript: 'the secret nobody tells you'});
  it('returns the spec the renderer reads, with no time field', () => {
    expect(out.legibility.version).toBe(1);
    expect(out.legibility.hook?.clearBand).toBe(true);
    expect(out.legibility.captions.avoidSplitFace).toBe(true);
    expect(JSON.stringify(out.legibility)).not.toMatch(/start|duration|time/i);
  });
  it('applies the caption rules and reports each change', () => {
    expect(out.caption).toMatchObject({template: 'classic', position: 'bottom', fontScale: 1, bottomFrac: 0.14});
    expect(out.warnings).toEqual(expect.arrayContaining(['legibility:caption_template_not_one_word', 'legibility:caption_position_off_face', 'legibility:caption_font_scale']));
  });
});

describe('captionsForBrollSplit', () => {
  const layout = {position: 'bottom' as const, bottomFrac: 0.2, frameTopFrac: 0, frameHeightFrac: 1};
  it('creator on the bottom: captions leave the lower half for the media half, above the seam', () => {
    const r = captionsForBrollSplit(layout, 'bottom', H);
    expect(r.layout).toMatchObject({position: 'bottom', frameTopFrac: 0, frameHeightFrac: 0.5});
    expect(r.band.bottom).toBeLessThanOrEqual(H * 0.5);
  });
  it('creator on top: captions stay in the bottom (media) half and never lower than before', () => {
    const r = captionsForBrollSplit({...layout, bottomFrac: 0.3}, 'top', H);
    expect(r.layout.bottomFrac).toBeLessThanOrEqual(0.3);
    expect(r.band.top).toBeGreaterThanOrEqual(H * 0.5);
  });
});

describe('wiring is gated (source text; the wired modules import the logger / Remotion)', () => {
  const av = read(SRC, 'pipeline', 'analyzeVideo.ts');
  it('analyzeVideo applies legibility only for the mvp profile and never in caption-only mode, before the conflict validator', () => {
    expect(av).toContain("if (mvpLike && !captionsOnly) {");
    expect(av.indexOf('applyLegibility({')).toBeLessThan(av.indexOf('const finalized = finalizeEdits({'));
    expect(av).toContain("ledger.drop(id, 'plan_assembly', 'ungrounded_text')");
    expect(av).toContain('...(legibility ? {legibility} : {}),');
    expect(av).not.toMatch(/strictProvenance:\s*true/);
  });
  it('production defaults are unchanged', () => {
    const env = read(SRC, 'config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
    expect(env).toMatch(/HOOK_TITLE_POLICY/);
  });
  it('the renderer takes every new path only from blueprint.legibility / fit', () => {
    const hook = read(REMOTION, 'components', 'HookTitle.tsx');
    expect(hook).toContain('const palette = fit ? legiblePalette(fit, shownStyle) : paletteFor(trimmed, styleId, design);');
    expect(hook).toContain('const slot = fit ? fittedSlot(fit, width, height) : slotFor(anchor, width, height, styleId);');
    expect(hook).toContain("const shownStyle: HookStyle = fit && (styleId === 'stack' || styleId === 'minimal' || styleId === 'poster') ? 'boxed' : styleId;");
    const video = read(REMOTION, 'ShortVideo.tsx');
    expect(video).toContain('const splitCaptions = legibleCaptions && captionSplit ?'); // WP3U: captionSplit = the split on screen, or the one held 6 frames
    expect(video).toContain('fit={blueprint.legibility?.hook}');
    expect(video).toContain('(blueprint.legibility && isPackageCaptionThemeId(captionTemplateId) ? PACKAGE_THEME_DEFAULT_FONT_SIZE : 34)');
    const schema = read(REMOTION, 'blueprintSchema.ts');
    expect(schema).toMatch(/legibility: z\s*\.object\(/);
    expect(schema).toMatch(/captions: z\.object\(\{\s*avoidSplitFace: z\.literal\(true\)/);
    expect(schema).toMatch(/\}\)\s*\.optional\(\),\s*\n\s*colorGradeLut/); // the whole legibility object is optional
  });
  it('the default hook policy and the placeholder text are not touched by this package', () => {
    expect(read(SRC, 'stages', 'broll', 'hookTitlePolicy.ts')).toContain("case 'placeholder':");
    expect(read(SRC, 'stages', 'broll', 'geminiDirector.ts')).toContain("cleanHookTitle(value) || 'WATCH THIS'");
  });
});
