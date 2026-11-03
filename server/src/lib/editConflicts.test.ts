import {describe, expect, it} from 'vitest';

import {captionBandFor, captionsForGeneratedSplit, GENERATED_SPLIT_RATIO as RENDERER_SPLIT_RATIO} from '../../../remotion/src/generated/placement.ts';
import type {GeneratedGraphic, MotionGraphic, SemanticEmphasis} from '../types/blueprint.ts';
import {
  captionRect,
  DOCKED_CAPTION_BOTTOM_FRAC,
  GENERATED_SPLIT_RATIO,
  validateAndApply,
  type EditPlanView,
} from './editConflicts.ts';
import {EditLedger} from './editLedger.ts';

const kinetic = (over: Partial<MotionGraphic> = {}): MotionGraphic => ({
  start: 10, end: 13, text: 'Embrace the pause', role: 'primary', shape: 'pill', accentColor: '#F59E0B', textColor: '#FFFFFF',
  anchor: 'top_left', entrance: 'scale_pop', exit: 'fade', fontScale: 0.82, ...over,
});
const emphasis = (over: Partial<SemanticEmphasis> = {}): SemanticEmphasis => ({
  start: 10, end: 12.4, text: 'True Presence', weight: 'primary', treatment: 'color', accentColor: '#FACC15', anchor: 'top_right', ...over,
});
const graphic = (placement: GeneratedGraphic['placement'], start: number, end: number, id = 'g'): GeneratedGraphic => ({
  id, start, end, placement, module: {url: 'https://example.invalid/m.js', sha256: '0'.repeat(64)}, props: {},
});
const plan = (over: Partial<EditPlanView> = {}): EditPlanView => ({
  durationSec: 47.82,
  captionDirection: {position: 'bottom', bottomFrac: 0.2},
  speaker: {box: {x: 0.18, y: 0.16, w: 0.64, h: 0.62}, source: 'fallback'},
  ...over,
});

function run(view: EditPlanView) {
  const ledger = new EditLedger();
  const result = validateAndApply(view, ledger);
  const decision = (predicate: (edit: (typeof result.edits)[number]) => boolean) => {
    const edit = result.edits.find(predicate)!;
    return result.decisions.find(item => item.id === edit.id)!;
  };
  return {...result, ledger, decision};
}

describe('renderer parity', () => {
  it('uses the same split ratio and caption docking as the Remotion placement code', () => {
    expect(GENERATED_SPLIT_RATIO).toBe(RENDERER_SPLIT_RATIO);
    expect(DOCKED_CAPTION_BOTTOM_FRAC).toBe(0.08);
    const H = 1920;
    for (const position of ['bottom', 'lower_third', 'center', 'top'] as const) {
      const layout = {position, bottomFrac: 0.2, frameTopFrac: 0, frameHeightFrac: 1};
      for (const side of [undefined, 'top', 'bottom'] as const) {
        const real = captionsForGeneratedSplit(layout, side ? (graphic({mode: 'split_screen', graphicSide: side}, 0, 3) as never) : undefined, H).band;
        const mine = captionRect({position, bottomFrac: 0.2}, side);
        // lower_third shares the bottom rule in captionBandFor.
        if (position === 'lower_third') {
          expect(captionBandFor('lower_third', 0.2, H).top / H).toBeCloseTo(0.67, 2);
        }
        expect(mine.y).toBeCloseTo(real.top / H, 2);
        expect(mine.y + mine.h).toBeCloseTo(real.bottom / H, 2);
      }
    }
  });
});

describe('conflict validation', () => {
  // 1. The relationship video: emphasis "true presence" and kinetic text drawn at the same anchor, 13.4-16.5 s (saved blueprint values).
  it('resolves the known kinetic-text / emphasis collision with an explicit reason', () => {
    const view = plan({
      hook: {text: 'The Quietest Moments Speak Loudest', start: 0, end: 3, anchor: 'top_left'},
      motionGraphics: [kinetic({start: 13.4, end: 16.48, text: 'True presence opens real connection', anchor: 'top_left'})],
      semanticEmphasis: [emphasis({start: 13.4, end: 15.8, text: 'true presence', anchor: 'top_left'})],
    });
    const {decision, applied, ledger} = run(view);
    const kept = decision(edit => edit.type === 'kinetic_text');
    const lost = decision(edit => edit.type === 'emphasis');
    expect(kept.action).toBe('keep');
    expect(lost).toMatchObject({action: 'drop', reason: 'spatial_text_overlap', conflictsWith: [kept.id], geometry: 'estimated'});
    expect(applied.semanticEmphasis).toHaveLength(0);
    expect(applied.motionGraphics).toHaveLength(1);
    expect(ledger.get(lost.id)!.events.at(-1)).toMatchObject({stage: 'conflict_validator', decision: 'dropped', reason: 'spatial_text_overlap'});
  });

  it('relocates a secondary overlay when the renderer supports a clear anchor', () => {
    const view = plan({
      motionGraphics: [kinetic({start: 10, end: 13, text: 'Pause', anchor: 'top_left'})],
      semanticEmphasis: [emphasis({start: 10, end: 12.4, text: 'Hi', anchor: 'top_left'})],
    });
    const {decision, applied} = run(view);
    const moved = decision(edit => edit.type === 'emphasis');
    expect(moved).toMatchObject({action: 'relocate', anchorFrom: 'top_left', anchorTo: 'top_right', reason: 'spatial_text_overlap'});
    expect(moved.to).toEqual({start: 10, end: 12.4});
    expect(applied.semanticEmphasis[0]).toMatchObject({anchor: 'top_right', start: 10, end: 12.4});
  });

  // 2. Hook title over a generated graphic.
  it('makes a generated graphic yield to the hook title by trimming its start, inside its own window', () => {
    const view = plan({
      hook: {text: 'Never do these three things', start: 0, end: 3, anchor: 'top_left'},
      generatedGraphics: [graphic({mode: 'split_screen', graphicSide: 'top'}, 2, 5.5)],
    });
    const {decision, applied} = run(view);
    const lost = decision(edit => edit.type === 'generated_graphic');
    expect(lost).toMatchObject({action: 'shorten', reason: 'spatial_text_overlap', from: {start: 2, end: 5.5}, to: {start: 3, end: 5.5}});
    expect(applied.generatedGraphics[0]).toMatchObject({start: 3, end: 5.5});
    expect(decision(edit => edit.type === 'hook_title').action).toBe('keep');
  });

  it('drops the graphic when nothing usable would remain after the hook', () => {
    const {decision, applied} = run(plan({hook: {text: 'Hook', start: 0, end: 3, anchor: 'top_left'}, generatedGraphics: [graphic({mode: 'split_screen', graphicSide: 'top'}, 1, 3.8)]}));
    expect(decision(edit => edit.type === 'generated_graphic')).toMatchObject({action: 'drop', reason: 'spatial_text_overlap'});
    expect(applied.generatedGraphics).toHaveLength(0);
  });

  // 3. Captions and text inside a split-screen graphic.
  it('docks captions out of a bottom split graphic, so the graphic and captions coexist', () => {
    const {decision, applied} = run(plan({generatedGraphics: [graphic({mode: 'split_screen', graphicSide: 'bottom'}, 20, 24)]}));
    expect(decision(edit => edit.type === 'generated_graphic')).toMatchObject({action: 'keep'});
    expect(applied.generatedGraphics).toHaveLength(1);
  });

  it('refuses a pip box that sits on the captions, but keeps one that does not', () => {
    const onCaptions = run(plan({generatedGraphics: [graphic({mode: 'pip', box: {x: 0.1, y: 0.68, w: 0.5, h: 0.12}}, 20, 24)]}));
    expect(onCaptions.decision(edit => edit.type === 'generated_graphic')).toMatchObject({action: 'drop', reason: 'spatial_text_overlap'});
    const safe = run(plan({generatedGraphics: [graphic({mode: 'pip', box: {x: 0.1, y: 0.06, w: 0.5, h: 0.16}}, 20, 24)]}));
    expect(safe.decision(edit => edit.type === 'generated_graphic').action).toBe('keep');
  });

  it('removes emphasis that lands inside the graphic half of a split (text on text)', () => {
    const {decision} = run(
      plan({
        generatedGraphics: [graphic({mode: 'split_screen', graphicSide: 'top'}, 12.6, 16.4, 'presence-over-noise')],
        semanticEmphasis: [emphasis({start: 13.4, end: 15.8, anchor: 'top_right'})],
      }),
    );
    const lost = decision(edit => edit.type === 'emphasis');
    expect(lost).toMatchObject({action: 'drop', reason: 'spatial_text_overlap'});
    expect(lost.conflictsWith[0]).toContain('generated_graphic@12600');
  });

  // 4. Two text overlays in the same region and interval.
  it('keeps the earlier of two equal-priority overlays and relocates the later one', () => {
    const view = plan({
      semanticEmphasis: [
        emphasis({start: 10, end: 12, text: 'First phrase', anchor: 'top_left'}),
        emphasis({start: 11, end: 12.5, text: 'Second phrase', anchor: 'top_left'}),
      ],
    });
    const {decision, applied} = run(view);
    expect(decision(edit => edit.start === 10).action).toBe('keep');
    expect(decision(edit => edit.start === 11)).toMatchObject({action: 'relocate', anchorTo: 'top_right', reason: 'spatial_text_overlap'});
    expect(applied.semanticEmphasis.map(item => item.anchor)).toEqual(['top_left', 'top_right']);
  });

  // 5. Overlap in time, disjoint regions.
  it('leaves overlays that overlap in time but not on screen alone', () => {
    const view = plan({
      motionGraphics: [kinetic({start: 10, end: 13, text: 'Pause', anchor: 'top_left', fontScale: 0.7})],
      semanticEmphasis: [emphasis({start: 10.5, end: 12.5, text: 'Hi', anchor: 'top_right'})],
    });
    const {decisions, applied} = run(view);
    expect(decisions.every(item => item.action === 'keep' && item.advisories.length === 0)).toBe(true);
    expect(applied.motionGraphics).toEqual(view.motionGraphics);
    expect(applied.semanticEmphasis).toEqual(view.semanticEmphasis);
  });

  // 6. Inset / PIP with captions in a safe region.
  it('keeps a pip graphic and an inset reveal that leave the captions clear', () => {
    const view = plan({
      generatedGraphics: [graphic({mode: 'pip', box: {x: 0.05, y: 0.05, w: 0.38, h: 0.18}}, 30, 33.5)],
      insetReveals: [{type: 'inset_reveal', start: 34, end: 38, params: {} as never}],
    });
    const {decisions, applied} = run(view);
    expect(decisions.filter(item => item.action !== 'keep')).toEqual([]);
    expect(applied.generatedGraphics).toEqual(view.generatedGraphics);
  });

  // 7. Full-screen graphic against an otherwise valid overlay.
  it('hides kinetic text under a full-screen graphic and drops emphasis that would sit on its text', () => {
    const view = plan({
      generatedGraphics: [graphic({mode: 'full_screen'}, 20, 24)],
      motionGraphics: [kinetic({start: 20.5, end: 22, text: 'Quiet', anchor: 'top_left'})],
      semanticEmphasis: [emphasis({start: 21, end: 23, anchor: 'top_right'})],
    });
    const {decision} = run(view);
    expect(decision(edit => edit.type === 'kinetic_text')).toMatchObject({action: 'drop', reason: 'temporal_occluded_by_fullscreen'});
    expect(decision(edit => edit.type === 'emphasis')).toMatchObject({action: 'drop', reason: 'spatial_text_overlap'});
    expect(decision(edit => edit.type === 'generated_graphic').action).toBe('keep');
  });

  it('keeps the part of the overlay that falls outside the full-screen graphic', () => {
    const {decision} = run(plan({generatedGraphics: [graphic({mode: 'full_screen'}, 20, 22)], motionGraphics: [kinetic({start: 21, end: 25, text: 'Quiet', anchor: 'top_left'})]}));
    expect(decision(edit => edit.type === 'kinetic_text')).toMatchObject({action: 'shorten', to: {start: 22, end: 25}, reason: 'temporal_occluded_by_fullscreen'});
  });

  // 8. Invalid and out-of-bounds intervals.
  it('drops an inverted interval and clamps or drops out-of-bounds ones, with reasons', () => {
    const view = plan({
      semanticEmphasis: [
        emphasis({start: 12, end: 11, text: 'Inverted'}),
        emphasis({start: 46.5, end: 49.5, text: 'Runs past the end', anchor: 'top_left'}),
        emphasis({start: 60, end: 62, text: 'After the end', anchor: 'top_left'}),
      ],
    });
    const {decision} = run(view);
    expect(decision(edit => edit.start === 12)).toMatchObject({action: 'drop', reason: 'temporal_invalid_interval'});
    expect(decision(edit => edit.start === 46.5)).toMatchObject({action: 'shorten', reason: 'temporal_out_of_bounds', to: {start: 46.5, end: 47.82}});
    expect(decision(edit => edit.start === 60)).toMatchObject({action: 'drop', reason: 'temporal_out_of_bounds'});
  });

  // 9. Missing geometry.
  it('assumes overlap when geometry is unknown, and says so', () => {
    const view = plan({
      motionGraphics: [kinetic({start: 10, end: 13, text: '', anchor: 'top_left'})],
      semanticEmphasis: [emphasis({start: 11, end: 12.5, text: '', anchor: 'top_right'})],
    });
    const {decision, ledger} = run(view);
    const lost = decision(edit => edit.type === 'emphasis');
    expect(lost).toMatchObject({action: 'drop', reason: 'spatial_text_overlap', geometry: 'unknown'});
    expect(ledger.get(lost.id)!.events.at(-1)).toMatchObject({geometry: 'unknown'});
  });

  it('treats a fallback speaker box as advisory but acts on a measured one', () => {
    const covering = kinetic({start: 10, end: 13, text: 'Face the quiet moments', anchor: 'top_left', role: 'primary', fontScale: 1.8});
    const fallback = run(plan({motionGraphics: [covering]}));
    const fallbackDecision = fallback.decisions.find(item => item.id.startsWith('kinetic_text'))!;
    expect(fallbackDecision).toMatchObject({action: 'keep', advisories: ['spatial_covers_face']});
    const measured = run(plan({motionGraphics: [covering], speaker: {box: {x: 0.2, y: 0.05, w: 0.6, h: 0.7}, source: 'vision'}}));
    expect(['relocate', 'drop']).toContain(measured.decisions.find(item => item.id.startsWith('kinetic_text'))!.action);
  });

  // 10. A valid edit stays untouched.
  it('leaves a clean edit unchanged and records no adjustment for it', () => {
    const view = plan({motionGraphics: [kinetic({start: 20, end: 23, text: 'Pause', anchor: 'top_left'})]});
    const {decisions, applied, ledger} = run(view);
    expect(decisions.every(item => item.action === 'keep')).toBe(true);
    expect(applied.motionGraphics).toEqual(view.motionGraphics);
    const entry = ledger.entries().find(item => item.type === 'kinetic_text')!;
    expect(entry.events.some(event => event.change?.anchorTo || event.reason?.startsWith('spatial_'))).toBe(false);
  });
});
