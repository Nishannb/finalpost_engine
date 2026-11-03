/**
 * WP2C pure tests: (1) split-caption colours and the dark band for EVERY caption template (package themes, utility templates, kinetic), (2) removal of on-screen text the speaker
 * did not say, whoever wrote it. Import graph: legibility.ts (-> contrast.ts, provenance.ts, types/blueprint.ts constants, colorRoles.ts -> contrast.ts) and
 * remotion/src/lib/captionSplit.ts (type-only import). The wired modules (analyzeVideo, ShortVideo, DynamicCaptionRenderer) and the theme package are read as text.
 * No logger, `.env`, SDK, FFmpeg or network.
 */
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {contrastRatio} from '../lib/contrast.ts';
import {stampProvenance} from '../lib/provenance.ts';
import {applyLegibility, CAPTION, captionSplitSpec, dropUngroundedText, isGroundedInTranscript} from '../stages/broll/legibility.ts';
import type {CaptionDirection, MotionGraphic, SemanticEmphasis} from '../types/blueprint.ts';
import {captionsForBrollSplit, PLATE_HEIGHT_FRAC} from '../../../remotion/src/lib/captionSplit.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(SRC, '..', '..');
const read = (...parts: string[]) => readFileSync(resolve(...parts), 'utf8');
const H = 1920;

// The lightest background a split caption can sit on: 82% of #0B0B0F over pure white footage.
const blend = (dark: number, alpha: number) => Math.round(alpha * dark + (1 - alpha) * 255);
const WORST = `#${[blend(11, 0.82), blend(11, 0.82), blend(15, 0.82)].map(v => v.toString(16).padStart(2, '0')).join('')}`;

describe('split caption colours', () => {
  it('the worst-case plate constant is the real blend of the translucent plate over white', () => {
    const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
    for (let i = 0; i < 3; i += 1) expect(Math.abs(channel(CAPTION.splitPlateWorstCase, i) - channel(WORST, i))).toBeLessThanOrEqual(5);
    expect(CAPTION.splitBoxColor).toBe('rgba(11,11,15,0.82)');
  });
  it('white text reaches 4.5:1 even on the worst-case plate, and 4.5:1 on the opaque plate colour', () => {
    expect(contrastRatio(CAPTION.splitTextColor, CAPTION.splitPlateWorstCase)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(CAPTION.splitTextColor, WORST)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(CAPTION.splitTextColor, CAPTION.splitPlateColor)).toBeGreaterThanOrEqual(4.5);
  });
  it('every highlight, light or dark, comes out >= 4.5:1 against the worst-case plate; a good one is kept', () => {
    for (const highlight of ['#FFD700', '#F5B942', '#FFFFFF', '#B45309', '#C2410C', '#111111', '#000000', '#6D28D9', '#1E3A8A', 'red', '', '#12']) {
      const spec = captionSplitSpec({highlightColor: highlight});
      expect(contrastRatio(spec.splitHighlightColor, CAPTION.splitPlateWorstCase), highlight).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(spec.splitHighlightColor, WORST), highlight).toBeGreaterThanOrEqual(4.5);
    }
    expect(captionSplitSpec({highlightColor: '#FFD700'}).splitHighlightColor).toBe('#FFD700');
    expect(captionSplitSpec({highlightColor: '#B45309'}).splitHighlightColor).not.toBe('#B45309');
  });
  it('the spec carries the opaque plate colour and the translucent box', () => {
    const spec = captionSplitSpec({highlightColor: '#FFD700'});
    expect(spec).toMatchObject({avoidSplitFace: true, splitPlateColor: '#0B0B0F', splitBoxColor: 'rgba(11,11,15,0.82)', splitTextColor: '#FFFFFF'});
  });
  it('applyLegibility writes it from the caption it returns', () => {
    const caption: CaptionDirection = {position: 'bottom', bottomFrac: 0.18, textColor: '#FFFFFF', highlightColor: '#B45309', boxColor: null, template: 'karaoke-theme'};
    const out = applyLegibility({hookTitle: 'X', canvasWidth: 1080, canvasHeight: H, caption, motionGraphics: [], semanticEmphasis: [], transcript: 'x'});
    expect(contrastRatio(out.legibility.captions.splitHighlightColor, CAPTION.splitPlateWorstCase)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the caption themes read against the band (the package source is read as text)', () => {
  const themesDir = resolve(ROOT, 'node_modules', 'remotion-captions-themes', 'src', 'themes');
  const present = existsSync(themesDir);
  it.runIf(present)('only the grape theme paints a background from the primary colour; every other theme draws text from primary/secondary', () => {
    const paintsFromPrimary = readdirSync(themesDir)
      .filter(file => file.endsWith('.tsx'))
      .filter(file => /background[^\n]*(primaryColor|backgroundColor)|backgroundColor = primaryColor/.test(readFileSync(resolve(themesDir, file), 'utf8')))
      .sort();
    expect(paintsFromPrimary).toEqual(['grape.tsx']);
  });
  it.runIf(present)('grape: a dark primary makes its text white by its own rule, so the dark plate colour is what the renderer passes', () => {
    const grape = readFileSync(resolve(themesDir, 'grape.tsx'), 'utf8');
    expect(grape).toContain('const backgroundColor = primaryColor;');
    expect(grape).toContain('isLightBg ? "#111827" : "#ffffff"');
    expect(grape).toContain('isActive ? secondaryColor : baseTextColor');
    expect(CAPTION.splitPlateColor.toLowerCase()).not.toBe('#ffffff');
  });
  it('the renderer: utility templates and kinetic templates other than the box-aware one never receive a box, so the band is drawn behind all templates', () => {
    const renderer = read(ROOT, 'remotion', 'src', 'captions', 'DynamicCaptionRenderer.tsx');
    for (const component of ['KineticSlamCaptions', 'MovingPillCaptions', 'SimpleOneWordCaptions', 'Kinetic01Captions', 'AaritCaptions', 'SoftAiCaptions', 'WeightShiftCaptions', 'EditorialEmphasisCaptions']) {
      expect(renderer, component).toContain(`function ${component}(`);
    }
    // none of them is handed `direction`, only options + position, so `boxColor` cannot reach them
    expect(renderer).not.toMatch(/<(MovingPillCaptions|SoftAiCaptions|AaritCaptions)[^>]*direction=/);
  });
});

describe('captionsForBrollSplit: band and plate', () => {
  const layout = {position: 'bottom' as const, bottomFrac: 0.2, frameTopFrac: 0, frameHeightFrac: 1};
  it('creator on the bottom: the plate lies in the top (media) half, above the seam, and holds the caption band', () => {
    const r = captionsForBrollSplit(layout, 'bottom', H);
    expect(r.plate.top).toBeGreaterThanOrEqual(0);
    expect(r.plate.top + r.plate.height).toBeLessThanOrEqual(H * 0.5);
    expect(r.band.top).toBeGreaterThanOrEqual(r.plate.top);
    expect(r.band.bottom).toBeLessThanOrEqual(r.plate.top + r.plate.height);
  });
  it('creator on top: the plate lies in the bottom (media) half and holds the caption band', () => {
    for (const bottomFrac of [0.1, 0.14, 0.2, 0.3]) {
      const r = captionsForBrollSplit({...layout, bottomFrac}, 'top', H);
      expect(r.plate.top).toBeGreaterThanOrEqual(H * 0.5);
      expect(r.plate.top + r.plate.height).toBeLessThanOrEqual(H);
      expect(r.band.top).toBeGreaterThanOrEqual(r.plate.top - 1e-6);
      expect(r.band.bottom).toBeLessThanOrEqual(r.plate.top + r.plate.height + 1e-6);
    }
  });
  it('the plate is tall enough for two lines of the largest allowed caption (100 px)', () => {
    expect(PLATE_HEIGHT_FRAC * H).toBeGreaterThanOrEqual(2 * 100 * 1.2);
  });
});

describe('renderer wiring (source text; ShortVideo imports Remotion)', () => {
  const video = read(ROOT, 'remotion', 'src', 'ShortVideo.tsx');
  it('the band is drawn only with legibility.captions on an active split, behind the captions', () => {
    expect(video).toContain('const legibleCaptions = blueprint.legibility?.captions;');
    expect(video).toContain('{!openingShowing && legibleCaptions && blueprint.captionWords.length > 0 && (splitCaptions?.plate ?? backingPlate) ? ('); // WP4D / WP4K: the same plate div, now also for a backing plate off a split
    expect(video.indexOf('top: splitCaptions.plate.top')).toBeLessThan(video.indexOf('<DynamicCaptionRenderer'));
    expect(video).toContain('backgroundColor: legibleCaptions.splitBoxColor');
  });
  it('colours: white text, the checked highlight, and the plate colour for the grape pill', () => {
    expect(video).toContain("captionTemplateId === 'grape-theme'");
    expect(video).toContain('? legibleCaptions.splitPlateColor');
    expect(video).toContain(': legibleCaptions.splitTextColor');
    expect(video).toContain('(splitCaptions || backingPlate) && legibleCaptions ? legibleCaptions.splitHighlightColor : blueprint.captionDirection?.highlightColor'); // WP4D
  });
  it('without legibility every one of these expressions falls back to the old value', () => {
    expect(video).toContain(': blueprint.captionDirection?.textColor,');
    expect(video).toContain(': blueprint.captionDirection?.highlightColor,');
  });
});

describe('on-screen text the speaker did not say', () => {
  const transcript = "Honestly, the biggest mistake is trying to control every emotion. Software won't fix that. Spend 5M less on ads.";
  const graphic = (text: string, start = 4): MotionGraphic => ({start, end: start + 2, text, role: 'primary', shape: 'pill', accentColor: '#22D3EE', textColor: '#0F172A', anchor: 'top_left', entrance: 'scale_pop', exit: 'fade', fontScale: 1});
  const emphasis = (text: string): SemanticEmphasis => ({start: 8, end: 10, text, weight: 'primary', treatment: 'scale', accentColor: '#FACC15'});

  it('grounded means every word was said; case, punctuation and a plural s do not matter', () => {
    expect(isGroundedInTranscript('CONTROL EVERY EMOTIONS', transcript)).toBe(true);
    expect(isGroundedInTranscript('biggest mistake', transcript)).toBe(true);
    expect(isGroundedInTranscript('$5M', transcript)).toBe(true);
    expect(isGroundedInTranscript('', transcript)).toBe(true);
  });
  it('a paraphrase, an invented phrase or a number written as a word is not grounded', () => {
    expect(isGroundedInTranscript('Recommended Software', transcript)).toBe(false);
    expect(isGroundedInTranscript('Master your feelings', transcript)).toBe(false);
    expect(isGroundedInTranscript('FIVE MILLION', transcript)).toBe(false);
  });
  it('drops a Director item that is not in the transcript (the "Recommended Software" case), keeps a spoken one', () => {
    const director = graphic('Recommended Software');
    const r = dropUngroundedText([director, graphic('biggest mistake')], transcript);
    expect(r.dropped).toEqual([director]);
    expect(r.kept.map(item => item.text)).toEqual(['biggest mistake']);
  });
  it('treats the placeholder as ungrounded even when the words happen to be spoken', () => {
    expect(dropUngroundedText([graphic('WATCH THIS')], 'watch this now').dropped).toHaveLength(1);
  });
  it('never changes or moves what it keeps (same objects, same times) and has no time input', () => {
    const keep = graphic('biggest mistake', 7.25);
    const out = dropUngroundedText([graphic('Recommended Software', 3), keep], transcript);
    expect(out.kept[0]).toBe(keep);
    expect(out.kept[0]!.start).toBe(7.25);
    expect(read(SRC, 'stages', 'broll', 'legibility.ts')).not.toMatch(/\.start\s*=|\.end\s*=|start:\s*[a-z.]+\.start \+/);
  });
  it('carries no paraphrase flag on these types, so absence from the transcript is the rule', () => {
    const types = read(SRC, 'types', 'blueprint.ts');
    const section = (name: string) => types.slice(types.indexOf(`export type ${name} = {`), types.indexOf('};', types.indexOf(`export type ${name} = {`)));
    expect(section('MotionGraphic')).not.toMatch(/paraphrase|wording_source|wordingSource/i);
    expect(section('SemanticEmphasis')).not.toMatch(/paraphrase|wording_source|wordingSource/i);
  });
  it('applyLegibility removes both kinds, returns them for the ledger, reports the count (and, since WP4R, clears an unspoken hook title)', () => {
    const caption: CaptionDirection = {position: 'bottom', bottomFrac: 0.18, textColor: '#FFFFFF', highlightColor: '#FFD700', boxColor: null, template: 'classic'};
    const spoken = graphic('biggest mistake');
    const out = applyLegibility({
      hookTitle: 'Recommended Software',
      canvasWidth: 1080,
      canvasHeight: H,
      caption,
      motionGraphics: [graphic('Recommended Software'), spoken],
      semanticEmphasis: [emphasis('Master your feelings'), emphasis('Software')],
      transcript,
    });
    expect(out.hookTitle).toBe(''); // WP4R: the hook title is grounded too; this one is not in the transcript
    expect(out.warnings).toContain('legibility:ungrounded_hook_cleared');
    expect(out.motionGraphics).toEqual([spoken]);
    expect(out.semanticEmphasis.map(item => item.text)).toEqual(['Software']);
    expect(out.droppedText.map(item => item.text)).toEqual(['Recommended Software', 'Master your feelings']);
    expect(out.warnings).toContain('legibility:ungrounded_text_dropped:2');
    expect(out.motionGraphics[0]!.start).toBe(4);
  });
  it('keeps the provenance of what it keeps', () => {
    const item = stampProvenance(graphic('biggest mistake'), {accentColor: 'director'});
    expect(dropUngroundedText([item], transcript).kept[0]).toBe(item);
  });
});

describe('wiring: mvp only, recorded in the ledger (source text)', () => {
  const av = read(SRC, 'pipeline', 'analyzeVideo.ts');
  it('analyzeVideo applies it only for the mvp profile outside caption-only mode and records each drop', () => {
    expect(av).toContain("if (mvpLike && !captionsOnly) {");
    expect(av).toContain("ledger.drop(id, 'plan_assembly', 'ungrounded_text')");
    expect(av).toContain('const id = ledgerIdOf(item);');
    expect(av).toContain('legibility = {...legibility, captions: captionSplitSpec(broll.caption)};');
  });
  it('no other server module imports the legibility module (the legacy path cannot reach it)', () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && /broll\/legibility\.ts'|\.\/legibility\.ts'/.test(readFileSync(path, 'utf8'))) importers.push(path.slice(SRC.length + 1));
      }
    };
    walk(SRC);
    expect(importers).toEqual(['pipeline/analyzeVideo.ts']);
  });
  it('the hook title is not passed through the text filter, and the hook policy files are untouched', () => {
    const legibility = read(SRC, 'stages', 'broll', 'legibility.ts');
    expect(legibility).toContain('dropUngroundedText(input.motionGraphics');
    expect(legibility).toContain('dropUngroundedText(input.semanticEmphasis');
    expect(legibility).not.toMatch(/dropUngroundedText\(\[?input\.hook|dropUngroundedText\(.*hookTitle/);
    expect(read(SRC, 'stages', 'broll', 'hookTitlePolicy.ts')).toContain("case 'placeholder':");
  });
});
