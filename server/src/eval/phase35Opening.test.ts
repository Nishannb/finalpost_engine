import {describe, expect, it} from 'vitest';

import {contrastRatio} from '../stages/contentProfile/contentProfile';
import {adjustForContrast, textOverFootage, validateColorRoles, type RegionStats} from '../stages/openingPlan/colorRoles';
import {evidenceSpread, resolveOpening, wordingOverlap} from '../stages/openingPlan/openingPlan';
import {statsFromRgb} from '../stages/openingPlan/regionStats';

const calm = (lum: number, spread = 0.03): RegionStats => ({p10: lum, p50: lum, p90: lum, meanRgb: {r: 100, g: 100, b: 100}, spread});
const roles = {primary_text: '#FFFFFF', secondary_text: '#CBD5E1', accent: '#FACC15', graphic_background: '#0B1B2B', panel: '#12283D', highlight: '#FACC15', data: '#38BDF8'};

describe('colour roles', () => {
  it('leaves valid roles untouched', () => {
    const report = validateColorRoles(roles);
    expect(report.corrections).toEqual([]);
    expect(report.roles.accent).toBe('#FACC15');
  });

  it('moves a failing role along its own lightness, keeping the hue, and reports why', () => {
    const report = validateColorRoles({...roles, accent: '#1E3A5F'});
    const fix = report.corrections.find(c => c.role === 'accent');
    expect(fix).toBeTruthy();
    expect(contrastRatio(report.roles.accent, roles.graphic_background)).toBeGreaterThanOrEqual(3);
    expect(fix!.reason).toContain('against graphic_background');
  });

  it('never leaves foreground and background identical', () => {
    const report = validateColorRoles({...roles, primary_text: '#0B1B2B'});
    expect(report.roles.primary_text).not.toBe(report.roles.graphic_background);
    expect(contrastRatio(report.roles.primary_text, report.roles.graphic_background)).toBeGreaterThanOrEqual(4.5);
  });

  it('derives missing or malformed roles from the valid ones and warns', () => {
    const report = validateColorRoles({graphic_background: '#101010', primary_text: 'white'});
    expect(report.warnings).toContain('role_missing_or_invalid:primary_text');
    for (const value of Object.values(report.roles)) {
      expect(value).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('folds extra accent hues onto the accent', () => {
    const report = validateColorRoles({...roles, accent: '#FACC15', highlight: '#FF3B8B', data: '#22D3EE'});
    expect(report.corrections.some(c => c.reason.includes('competing accent'))).toBe(true);
  });

  it('adjustForContrast gives up (null) only when no tint can reach the target', () => {
    expect(adjustForContrast('#808080', '#808080', 21)).toBeNull();
  });
});

describe('text over the actual footage', () => {
  it('keeps a valid Director colour on calm, dark footage', () => {
    const result = textOverFootage({textColor: '#FFFFFF', panelColor: '#0B0F19', stats: calm(0.05)});
    expect(result.corrections).toEqual([]);
    expect(result.textColor).toBe('#FFFFFF');
  });

  it('corrects white text over a bright wall', () => {
    const result = textOverFootage({textColor: '#FFFFFF', panelColor: '#0B0F19', stats: calm(0.9)});
    expect(result.corrections.length).toBeGreaterThan(0);
    expect(result.panel || result.strokeColor).toBeTruthy();
  });

  it('adds a backing panel over busy footage even when the average contrast is fine', () => {
    const result = textOverFootage({textColor: '#FFFFFF', panelColor: '#0B0F19', stats: {p10: 0.02, p50: 0.3, p90: 0.4, meanRgb: {r: 1, g: 1, b: 1}, spread: 0.3}});
    expect(result.panel).toBeTruthy();
    expect(contrastRatio(result.textColor, result.panel!.color)).toBeGreaterThanOrEqual(4.5);
  });

  it('measures the worst pixels, not the average', () => {
    const stats = statsFromRgb(Uint8Array.from([...Array(22).fill(0), ...Array(2).fill(255)].flatMap(v => [v, v, v])));
    expect(stats.p90).toBeLessThan(0.1);
    expect(stats.p50).toBeLessThan(0.01);
    expect(stats.spread).toBeGreaterThan(0.2);
  });
});

describe('opening plan resolution', () => {
  const transcript = 'Never ever do these three things when you edit videos. Hook is key. You need a performance bonus.';
  const plan = {
    central_promise: 'Avoid three editing mistakes',
    audience: 'new video editors',
    angle: 'a warning, then fixes',
    evidence: [{time_sec: 1, what: 'warns viewers'}, {time_sec: 20, what: 'lists software'}, {time_sec: 38, what: 'closing advice'}],
    concept: 'a bold warning title',
    hook_wording: 'NEVER DO THESE 3 THINGS',
    wording_source: 'spoken',
    source_frame_time_sec: 0.5,
    treatment: 'curved',
    curve: {shape: 'arc', curvature: 0.3, direction: 'clockwise', rotationDeg: 0},
    text_masking_reason: 'a curve adds energy without hiding the face',
    placement: {center_y: 0.13, width_frac: 0.86, align: 'center'},
    contrast_treatment: 'panel',
    frame0: 'title fully visible on a dark panel',
    animation: 'accent bar sweeps',
    why_this_design: 'matches the warning tone',
  };
  const color = {identity: 'cool studio with a warm accent', footage_notes: 'blue wall, mid skin', roles};
  const base = {transcript, durationSec: 41.7, hookDurationSec: 3, matteUsable: false, speakerBox: {x: 0.1, y: 0.35, w: 0.8, h: 0.6}, measure: async () => calm(0.1)};

  it('accepts a grounded plan and delivers it as the requested curved treatment', async () => {
    const result = await resolveOpening({...base, plan, colorDirection: color});
    expect(result.report).toMatchObject({accepted: true, delivered: 'curved', requested: 'curved'});
    expect(result.spec).toMatchObject({kind: 'curved', text: 'NEVER DO THESE 3 THINGS', startSec: 0});
    expect(result.spec!.plan.why).toBeTruthy();
  });

  it('rejects wording that is not in the video', async () => {
    const result = await resolveOpening({...base, plan: {...plan, hook_wording: 'AMAZING SECRET HACK'}, colorDirection: color});
    expect(result.report.accepted).toBe(false);
    expect(result.report.rejection).toContain('wording_not_grounded');
  });

  it('rejects evidence that only covers the opening seconds', async () => {
    const result = await resolveOpening({...base, plan: {...plan, evidence: [{time_sec: 1, what: 'intro words'}, {time_sec: 3, what: 'still the intro'}]}, colorDirection: color});
    expect(result.report.rejection).toContain('evidence_not_spread_across_video');
  });

  it('rejects missing colour direction instead of inventing a palette', async () => {
    const result = await resolveOpening({...base, plan, colorDirection: null});
    expect(result.report.rejection).toBe('color_direction_missing_or_invalid');
  });

  it('moves text off the face and out of the caption band', async () => {
    const onFace = await resolveOpening({...base, plan: {...plan, placement: {center_y: 0.3, width_frac: 0.8, align: 'center'}}, colorDirection: color});
    expect(onFace.report.corrections.join(' ')).toContain('kept off the face');
    expect(onFace.spec!.centerY).toBeLessThan(0.26);
    const low = await resolveOpening({...base, speakerBox: undefined, plan: {...plan, placement: {center_y: 0.9, width_frac: 0.8, align: 'center'}}, colorDirection: color});
    expect(low.report.corrections.join(' ')).toContain('caption band');
    expect(low.spec!.centerY + 0.09).toBeLessThanOrEqual(0.76);
  });

  it('never reports behind_subject without a matte: it is delivered as a layered panel and says so', async () => {
    const result = await resolveOpening({...base, plan: {...plan, treatment: 'behind_subject', curve: null, speakerBox: undefined}, colorDirection: color});
    expect(result.report.requested).toBe('behind_subject');
    expect(result.report.delivered).toBe('layered');
    expect(result.report.fallbacks.join(' ')).toContain('not depth-aware');
    expect(result.behindSubject).toBeUndefined();
  });

  it('with a usable matte and a mostly visible text, behind_subject goes to the subject-aware track', async () => {
    const result = await resolveOpening({...base, matteUsable: true, speakerBox: {x: 0.3, y: 0.5, w: 0.4, h: 0.5}, plan: {...plan, treatment: 'behind_subject', curve: null, placement: {center_y: 0.25, width_frac: 0.9, align: 'center'}}, colorDirection: color});
    expect(result.report.delivered).toBe('behind_subject');
    expect(result.behindSubject).toMatchObject({text: 'NEVER DO THESE 3 THINGS', start: 0});
    expect(result.spec).toBeNull();
  });

  it('adds a panel to the opening when the footage behind it is bright', async () => {
    const result = await resolveOpening({...base, measure: async () => calm(0.92), plan: {...plan, treatment: 'plain', curve: null}, colorDirection: color});
    expect(result.spec!.panel || result.spec!.strokeColor).toBeTruthy();
    expect(result.report.corrections.length).toBeGreaterThan(0);
  });

  it('helpers: wording overlap and evidence spread', () => {
    expect(wordingOverlap('hook is key', transcript)).toBe(1);
    expect(wordingOverlap('zebra quantum', transcript)).toBe(0);
    expect(evidenceSpread([{time_sec: 0, what: 'a'}, {time_sec: 20, what: 'b'}], 40)).toMatchObject({distinct: 2, spanFrac: 0.5, inRange: true});
  });
});
