import {describe, expect, it} from 'vitest';

import {buildConflictEdits, validateEdits, type EditPlanView} from '../lib/editConflicts.ts';
import {openingRect} from '../stages/openingPlan/openingPlan.ts';
import {openingBox} from '../../../remotion/src/lib/openingGeometry';
import type {MotionGraphic} from '../types/blueprint.ts';

const idFor = (type: string, start: number, label: string) => `${type}@${Math.round(start * 1000)}#${label}`;
const kinetic = (over: Partial<MotionGraphic> = {}): MotionGraphic => ({start: 0.5, end: 2.5, text: 'THREE LINES', role: 'primary', shape: 'underline', accentColor: '#FACC15', textColor: '#FFFFFF', anchor: 'top_left', entrance: 'spring_up', exit: 'fade', fontScale: 1, italic: false, ...over});
const behind = (over: Record<string, unknown> = {}) => ({start: 1, end: 3.5, text: 'FOCUS', centerY: 0.4, widthFrac: 0.9, heightFrac: 0.2, curvature: 0, reveal: 'fade' as const, reason: 'r', color: '#FFFFFF', ...over});
const plan = (over: Partial<EditPlanView> = {}): EditPlanView => ({durationSec: 20, speaker: {box: {x: 0.2, y: 0.3, w: 0.6, h: 0.6}, source: 'vision'}, captionDirection: {position: 'bottom', bottomFrac: 0.2}, ...over});
const run = (p: EditPlanView) => {
  const edits = buildConflictEdits(p, idFor);
  return {edits, decisions: validateEdits(p, edits)};
};
const decisionFor = (decisions: ReturnType<typeof run>['decisions'], prefix: string) => decisions.find(d => d.id.startsWith(prefix))!;

describe('opening geometry in the conflict validator', () => {
  const hook = {text: 'Never do these', start: 0, end: 3, anchor: 'top_left' as const};
  const opening = {start: 0, end: 3, rect: {x: 0.05, y: 0.04, w: 0.9, h: 0.1}};

  it('the server box is the renderer box (parity with remotion/src/lib/openingGeometry.ts)', () => {
    for (const align of ['left', 'center', 'right'] as const) {
      const spec = {centerY: 0.1, widthFrac: 0.8, heightFrac: 0.12, align};
      expect(openingRect(spec)).toEqual(openingBox(spec));
    }
  });

  it('the opening is validated with its real box: text drawn in that box collides, and the mutable text yields', () => {
    const {decisions, edits} = run(plan({hook, opening, motionGraphics: [kinetic({anchor: 'top_right'})]}));
    expect(edits.find(e => e.type === 'hook_title')!.geometry).toBe('measured');
    expect(edits.find(e => e.type === 'hook_title')!.rect).toEqual(opening.rect);
    const k = decisionFor(decisions, 'kinetic_text');
    expect(k.action).not.toBe('keep');
    expect(k.conflictsWith.some(id => id.startsWith('hook_title'))).toBe(true);
  });

  it('control: without the opening the same kinetic text is judged against the legacy slot only', () => {
    const legacy = run(plan({hook, motionGraphics: [kinetic({anchor: 'top_right'})]}));
    expect(decisionFor(legacy.decisions, 'kinetic_text').action).toBe('keep');
    expect(legacy.edits.find(e => e.type === 'hook_title')!.geometry).toBe('estimated');
  });

  it('overlapping in TIME alone is not a collision: the same window, a disjoint box, stays', () => {
    const {decisions} = run(plan({hook, opening, captionDirection: {position: 'center', bottomFrac: 0.2}, motionGraphics: [kinetic({anchor: 'bottom_left', start: 0.5, end: 2.5})]}));
    expect(decisionFor(decisions, 'kinetic_text').action).toBe('keep');
  });

  it('an opening over the face is recorded as an advisory (it is not removed here); a clear opening has none', () => {
    const onFace = run(plan({hook, opening: {start: 0, end: 3, rect: {x: 0.2, y: 0.3, w: 0.6, h: 0.1}}}));
    const d = decisionFor(onFace.decisions, 'hook_title');
    expect(d.action).toBe('keep');
    expect(d.advisories).toContain('spatial_covers_face');
    expect(decisionFor(run(plan({hook, opening})).decisions, 'hook_title').advisories).not.toContain('spatial_covers_face');
  });
});

describe('behind-subject text in the conflict validator', () => {
  it('intentional layering is allowed: it overlaps the speaker and a zoom-free base picture without a conflict', () => {
    const {decisions} = run(plan({behindSubjectTexts: [behind({centerY: 0.4})]}));
    const d = decisionFor(decisions, 'behind_subject_text');
    expect(d.action).toBe('keep');
    expect(d.advisories).not.toContain('spatial_covers_face');
  });

  it('a layout that hides or reshapes the picture (full-frame B-roll) genuinely collides: the text is dropped with the reason', () => {
    const {decisions} = run(plan({behindSubjectTexts: [behind()], brollClips: [{start: 0, end: 10, keyword: 'sunset', assetUrl: 'x'} as never]}));
    const d = decisionFor(decisions, 'behind_subject_text');
    expect(d.action).toBe('drop');
    expect(d.reason).toBe('temporal_conflicts_with_layout');
  });

  it('a layout that does not overlap in time is fine', () => {
    const {decisions} = run(plan({behindSubjectTexts: [behind({start: 11, end: 13})], brollClips: [{start: 0, end: 10, keyword: 'sunset', assetUrl: 'x'} as never]}));
    expect(decisionFor(decisions, 'behind_subject_text').action).toBe('keep');
  });

  it('it never evicts a layout or the opening, and other text yields to it, not the reverse', () => {
    const hook = {text: 'Never do these', start: 0, end: 3, anchor: 'top_left' as const};
    const opening = {start: 0, end: 3, rect: {x: 0.05, y: 0.3, w: 0.9, h: 0.2}};
    const {decisions} = run(plan({hook, opening, behindSubjectTexts: [behind({start: 0.5, end: 2.5, centerY: 0.4})]}));
    expect(decisionFor(decisions, 'hook_title').action).toBe('keep');
    expect(decisionFor(decisions, 'behind_subject_text').action).not.toBe('keep'); // two texts in the same box: the lower priority yields

    const withKinetic = run(plan({behindSubjectTexts: [behind({centerY: 0.1, heightFrac: 0.1, start: 0.5, end: 2.5})], motionGraphics: [kinetic({anchor: 'top_left'})]}));
    expect(decisionFor(withKinetic.decisions, 'behind_subject_text').action).toBe('keep');
    expect(decisionFor(withKinetic.decisions, 'kinetic_text').action).not.toBe('keep');
  });

  it('text in the caption band collides with the captions', () => {
    const {decisions} = run(plan({behindSubjectTexts: [behind({centerY: 0.72, heightFrac: 0.1})]}));
    expect(decisionFor(decisions, 'behind_subject_text').action).not.toBe('keep');
  });
});
