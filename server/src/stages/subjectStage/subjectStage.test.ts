/**
 * SUBJECT STAGE Phase 2: the blueprint contract (remotion zod + server type), the style config, the env flag and the ShortVideo mount guarantees (absent field = a no-op).
 * Offline: no render, no network.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {subjectStageAccentSchema, subjectStageSchema, subjectStageSpanSchema, timelineBlueprintSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {STAGE_IDS, SUBJECT_STAGE_BG, SUBJECT_STAGE_MATTE, SUBJECT_STAGE_MOTION, SUBJECT_STAGE_RHYTHM, SUBJECT_STAGE_SHARES, SUBJECT_STAGE_STATES, SUBJECT_STAGE_STYLE_ID} from './subjectStageConfig.ts';
import * as M from './stageMotion.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const base = () => ({...(JSON.parse(read('../../../../remotion/props/sample.json')) as {blueprint: Record<string, unknown>}).blueprint});

const stage = {
  version: 1,
  styleId: 'subject_stage',
  matteUrl: 'https://cdn.example/matte.webm',
  bg: {blurPx: 10, dimPct: 18},
  spans: [
    {start: 0, end: 4, stage: 'S1', asset: {kind: 'native', nativeKind: 'plate'}, motion: {kind: 'none'}, enter: 'hard_cut'},
    {start: 4, end: 8, stage: 'S2', asset: {kind: 'native', nativeKind: 'quote_card', text: 'A quoted line.'}, motion: {kind: 'slow_push', scalePct: 5}, placement: {xPct: 51, yPct: -2, wPct: 58, hPct: 46}, enter: 'flash_cut'},
    {start: 8, end: 13, stage: 'S3', asset: {kind: 'native', nativeKind: 'result_page', lines: ['one', 'two', 'three']}, motion: {kind: 'auto_scroll', pctPerSec: 18}, opacity: 0.5, wash: 'warm', enter: 'hard_cut'},
    {start: 13, end: 17, stage: 'S4', motion: {kind: 'none'}, enter: 'hard_cut'},
    {start: 17, end: 19.5, stage: 'S5', asset: {kind: 'image', url: 'https://cdn.example/page.jpg'}, motion: {kind: 'slide_up_front'}, enter: 'slide_up_front'},
  ],
  accents: [
    {start: 13.2, end: 15, kind: 'pop_in', lines: ['Key term'], slot: 0},
    {start: 14, end: 16.5, kind: 'text_stack', lines: ['First', 'Second'], lineStarts: [0, 0.8], slot: 2},
  ],
};

describe('blueprint contract', () => {
  it('parses a full stage and keeps it on the blueprint; absent stays absent (optional, no default)', () => {
    const withStage = timelineBlueprintSchema.parse({...base(), subjectStage: stage});
    expect(withStage.subjectStage?.spans).toHaveLength(5);
    expect(withStage.subjectStage?.styleId).toBe('subject_stage');
    expect(withStage.subjectStage?.spans[2]).toMatchObject({stage: 'S3', opacity: 0.5, motion: {kind: 'auto_scroll', pctPerSec: 18}});
    const without = timelineBlueprintSchema.parse(base());
    expect(without.subjectStage).toBeUndefined();
    expect('subjectStage' in without).toBe(false);
    expect(timelineBlueprintSchema.shape.subjectStage.safeParse(undefined).success).toBe(true);
  });

  it('fills the defaults (hard cut, no motion, bg dim-only 0 px / 18 %, empty lists)', () => {
    const s = subjectStageSchema.parse({version: 1, styleId: 'subject_stage', matteUrl: 'https://x/m.webm'});
    expect(s.bg).toEqual({blurPx: 0, dimPct: 18});
    expect(s.spans).toEqual([]);
    expect(s.accents).toEqual([]);
    const span = subjectStageSpanSchema.parse({start: 0, end: 3, stage: 'S4'});
    expect(span).toMatchObject({motion: {kind: 'none'}, enter: 'hard_cut'});
  });

  it('rejects an unknown stage / style / motion, a backwards span and a bad accent slot', () => {
    expect(subjectStageSpanSchema.safeParse({start: 0, end: 3, stage: 'S6'}).success).toBe(false);
    expect(subjectStageSpanSchema.safeParse({start: 3, end: 3, stage: 'S1'}).success).toBe(false);
    expect(subjectStageSpanSchema.safeParse({start: 0, end: 3, stage: 'S1', motion: {kind: 'spin'}}).success).toBe(false);
    expect(subjectStageSpanSchema.safeParse({start: -1, end: 3, stage: 'S1'}).success).toBe(false);
    expect(subjectStageSpanSchema.safeParse({start: 0, end: 3, stage: 'S3', opacity: 1.5}).success).toBe(false);
    expect(subjectStageSchema.safeParse({version: 1, styleId: 'kinetic_led', matteUrl: 'x'}).success).toBe(false);
    expect(subjectStageSchema.safeParse({version: 2, styleId: 'subject_stage', matteUrl: 'x'}).success).toBe(false);
    expect(subjectStageAccentSchema.safeParse({start: 0, end: 1, kind: 'pop_in', slot: 3}).success).toBe(false);
    expect(subjectStageAccentSchema.safeParse({start: 2, end: 1, kind: 'pop_in', slot: 0}).success).toBe(false);
  });

  it('the server blueprint type mirrors the field (dual-kept)', () => {
    const server = read('../../types/blueprint.ts');
    expect(server).toMatch(/subjectStage\?: \{/);
    expect(server).toContain("styleId: 'subject_stage'");
    expect(server).toContain("stage: 'S1' | 'S2' | 'S3' | 'S4' | 'S5'");
  });
});

describe('style config (pure)', () => {
  it('carries the style id, the five stages and the spec opacities', () => {
    expect(SUBJECT_STAGE_STYLE_ID).toBe('subject_stage');
    expect([...STAGE_IDS]).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
    expect(SUBJECT_STAGE_STATES.S3.behindOpacity).toBe(0.5);
    expect(SUBJECT_STAGE_STATES.S4.behindOpacity).toBe(0);
    expect(SUBJECT_STAGE_STATES.S5.layer).toBe('front');
    for (const id of ['S1', 'S2', 'S3', 'S4'] as const) expect(SUBJECT_STAGE_STATES[id].layer).toBe('behind');
  });
  it('shares are the grammar targets (~35/19/15/25/5: the grammar itself sums to 99 %, they are targets not a partition)', () => {
    expect(Math.abs(Object.values(SUBJECT_STAGE_SHARES).reduce((a, b) => a + b, 0) - 1)).toBeLessThanOrEqual(0.02);
    expect(SUBJECT_STAGE_SHARES).toMatchObject({S1: 0.35, S2: 0.19, S3: 0.15, S4: 0.25, S5: 0.05});
  });
  it('rhythm / bg / motion / matte constants are the locked defaults', () => {
    expect(SUBJECT_STAGE_RHYTHM).toMatchObject({stageDurationSec: [3, 7], minStageSec: 1.4, accentIntervalSec: [1, 2], maxHeavyInARow: 2, keywordMinIntervalSec: 1, maxS5PerVideo: 1});
    expect(SUBJECT_STAGE_BG).toMatchObject({blurPx: [0, 0], dimPct: [15, 20], mask: 'dim_only_under_cutout'});
    expect(SUBJECT_STAGE_MOTION.autoScrollPctHPerSec).toEqual([15, 20]);
    expect(SUBJECT_STAGE_MOTION.slideUpFrontMinHoldSec).toBe(1.5);
    expect(SUBJECT_STAGE_MATTE).toMatchObject({cpuMaxVideoSec: 45});
    expect(SUBJECT_STAGE_MATTE.fullDeviceValues).toEqual(['mps', 'cuda']);
  });
  it('the config ranges ARE the renderer ranges (one source of truth: re-exported from stageMotion)', () => {
    expect(SUBJECT_STAGE_BG.blurPx).toBe(M.BG_BLUR_PX_RANGE);
    expect(SUBJECT_STAGE_MOTION.slowPushPct).toBe(M.SLOW_PUSH_PCT_RANGE);
    expect(SUBJECT_STAGE_MOTION.flashCutSec).toBe(M.FLASH_CUT_SEC_RANGE);
  });
});

describe('env flag', () => {
  it('POLISH_SUBJECT_STAGE is declared default-off and documented in both example files; analyze reads it exactly once (the Phase 4 gate input)', () => {
    expect(read('../../config/env.ts')).toMatch(/POLISH_SUBJECT_STAGE: bool\(false\)/);
    expect(read('../../../../.env.example')).toContain('# POLISH_SUBJECT_STAGE=0');
    expect(read('../../../../.env.production.example')).toContain('# POLISH_SUBJECT_STAGE=0');
    expect(read('../../pipeline/analyzeVideo.ts').match(/flags\.subjectStage/g)).toHaveLength(1);
  });
});

describe('ShortVideo mount: absent subjectStage is a no-op, z-order matches the grammar', () => {
  const src = read('../../../../remotion/src/ShortVideo.tsx');
  it('every stage mount is guarded by the optional field', () => {
    expect(src).toMatch(/\{blueprint\.subjectStage \? \(\s*(\/\/[^\n]*\n\s*)?<SubjectStageTrack/);
    expect(src).toMatch(/\{blueprint\.subjectStage \? \(\s*(\/\/[^\n]*\n\s*)?<SubjectStageFront/);
    expect(src).toContain('{!blueprint.subjectForeground && subjectStageForeground ? (');
    expect(src).toContain('foregroundFromStage(blueprint.subjectStage)');
  });
  it('room treatment is dim-only (never CSS blur); no eraser / black oval anywhere', () => {
    expect(src).toContain('grade={combineFilters(gradeFilterAt(blueprint.gradeBeats, timeSec), stageBackdropFilterAt(blueprint.subjectStage, timeSec))}');
    expect(src).not.toContain('SubjectStagePersonEraser');
    expect(src).not.toContain('SubjectStagePunchedRoom');
    expect(M.stageBackdropFilterAt(undefined, 3)).toBeUndefined();
    expect(M.foregroundFromStage(undefined)).toBeUndefined();
    expect(M.BG_BLUR_PX_RANGE).toEqual([0, 0]);
    expect(M.backdropFilterCss()).toBe('brightness(0.82)');
    expect(M.backdropFilterCss({blurPx: 99, dimPct: 18})).toBe('brightness(0.82)');
    expect(M.backdropFilterCss()).not.toMatch(/blur\(/);
    for (const grade of [undefined, 'grayscale(0.5) contrast(1.09)']) expect(M.combineFilters(grade, M.stageBackdropFilterAt(undefined, 1))).toBe(grade);
    expect(existsSync(join(here, '../../../../remotion/src/components/SubjectStage/SubjectStagePersonEraser.tsx'))).toBe(false);
  });
  it('base talking-head is hidden (opacity 0, still mounted for audio) under the matte only when stage + foreground are on', () => {
    expect(src).toContain('const hideBaseUnderMatte = Boolean(blueprint.subjectStage && (blueprint.subjectForeground || subjectStageForeground));');
    expect(src).toContain('hideBaseUnderMatte ? <AbsoluteFill style={{opacity: 0}}>{baseVideo}</AbsoluteFill> : baseVideo');
    expect(src).toContain('the behind-layer (SubjectStageTrack) is what sits behind the cutout');
    expect(src).toContain('the base talking-head body is NOT shown under the matte');
  });
  it('z-order: speaker footage < stage behind-layer < kinetic subjectForeground / stage person < stage front < emphasis / captions', () => {
    const at = (needle: string) => {
      const i = src.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const speaker = at('const classicStack');
    const motionGraphics = at('<MotionGraphicTrack');
    const track = at('<SubjectStageTrack');
    const kineticFg = at('foreground={blueprint.subjectForeground}');
    const stageFg = at('foreground={subjectStageForeground}');
    const front = at('<SubjectStageFront');
    const emphasis = at('<SemanticEmphasisTrack');
    const captions = at('<DynamicCaptionRenderer');
    expect(speaker).toBeLessThan(motionGraphics);
    expect(motionGraphics).toBeLessThan(track);
    expect(track).toBeLessThan(kineticFg);
    expect(kineticFg).toBeLessThan(stageFg);
    expect(stageFg).toBeLessThan(front);
    expect(front).toBeLessThan(emphasis);
    expect(emphasis).toBeLessThan(captions);
  });
  it('S5 is a FULL takeover: 100 % x 100 %, no margins, no rounded corners, no strip of subject / room, opaque, slid up from below', () => {
    const front = read('../../../../remotion/src/components/SubjectStage/SubjectStageFront.tsx');
    expect(M.S5_COVERAGE_PCT).toBe(100);
    expect(front).toContain('const coverW = (S5_COVERAGE_PCT / 100) * width;');
    expect(front).toContain('const coverH = (S5_COVERAGE_PCT / 100) * height;');
    expect(front).toContain('left: (width - coverW) / 2,');
    expect(front).toContain('top: (height - coverH) / 2,');
    expect(front).toContain('opacity: 1,');
    expect(front).not.toMatch(/borderRadius|borderTop|borderBottom|boxShadow/);
    expect(front).toContain('translateY(${takeover.offsetFrac * height}px)');
    const cfg = read('./subjectStageConfig.ts');
    expect(cfg).toContain('s5CoveragePct: S5_COVERAGE_PCT');
  });
  it('the S1 plate draws its headline (never a blank gradient): PlateGround renders text + subline and StageAsset passes them', () => {
    const plates = read('../../../../remotion/src/components/SubjectStage/NativePlates.tsx');
    expect(plates).toContain('export const PlateGround: React.FC<{width: number; height: number; text?: string; lines?: string[]');
    expect(plates).toContain('{headline ?');
    const asset = read('../../../../remotion/src/components/SubjectStage/StageAsset.tsx');
    expect(asset).toContain('text={asset?.text} lines={asset?.lines}');
  });
  it('the shells never filter or move the subject: the stage components do not import the matte track, and S5 uses the shared slide math', () => {
    const track = read('../../../../remotion/src/components/SubjectStage/SubjectStageTrack.tsx');
    const front = read('../../../../remotion/src/components/SubjectStage/SubjectStageFront.tsx');
    for (const file of [track, front]) expect(file).not.toMatch(/^import .*SubjectForegroundTrack/m);
    expect(front).toContain('slideUpFrontState(');
    expect(front).toContain('flashCutOpacity(');
    expect(track).toContain('autoScrollOffsetPx(');
    expect(track).toContain('slowPushScale(');
    expect(track).toContain('ghostFeatherMask(');
  });
  it('no brand / reference copy in the native placeholders', () => {
    const plates = read('../../../../remotion/src/components/SubjectStage/NativePlates.tsx');
    for (const word of ['ALERT', 'GlobalGiving', 'Nepal', 'instagram', 'routineof']) expect(plates.toLowerCase()).not.toContain(word.toLowerCase());
  });
});
