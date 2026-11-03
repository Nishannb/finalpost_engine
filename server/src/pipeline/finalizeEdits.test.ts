import {describe, expect, it} from 'vitest';

import {EditLedger, outcomeOf} from '../lib/editLedger.ts';
import {parseContentProfile} from '../stages/contentProfile/contentProfile.ts';
import type {BRollClip, CaptionDirection, DepthOverlayClip, GeneratedGraphic, MotionGraphic, SemanticEmphasis, TransitionClip, ZoomTrigger} from '../types/blueprint.ts';
import {finalizeEdits, recordAnchorChanges, type FinalizeInput} from './finalizeEdits.ts';

const profile = parseContentProfile({content_type: 'relationship_emotional', structure: 'narrative', pacing: 'slow', graphics_density: 'sparse', visual_mood: 'warm_intimate', tone: 'tender', rationale: 'r'});

const kinetic: MotionGraphic = {
  start: 13.4, end: 16.48, text: 'True presence opens real connection', role: 'primary', shape: 'underline', accentColor: '#C084FC', textColor: '#FFFFFF',
  anchor: 'top_left', entrance: 'scale_pop', exit: 'fade', fontScale: 0.82, italic: true,
};
const emphasis: SemanticEmphasis = {start: 13.4, end: 15.8, text: 'true presence', weight: 'primary', treatment: 'color', accentColor: '#C084FC', anchor: 'top_left'};
const caption: CaptionDirection = {position: 'bottom', bottomFrac: 0.2, textColor: '#FFFFFF', highlightColor: '#F3E8FF', boxColor: null, template: 'karaoke'};
const cutaway = {start: 4.24, end: 12.24, keyword: 'couple quiet sunset', assetUrl: 'x', provider: 'pexels', providerId: 1, width: 1, height: 1, credit: '', creditUrl: ''} as unknown as BRollClip;
const pip: GeneratedGraphic = {id: 'quote', start: 30.36, end: 33.86, placement: {mode: 'pip', box: {x: 0.05, y: 0.05, w: 0.38, h: 0.18}}, module: {url: 'u', sha256: '0'.repeat(64)}, props: {}};

const input = (over: Partial<FinalizeInput> = {}): FinalizeInput => ({
  ledger: new EditLedger(),
  contentProfile: profile,
  footageLuminance: 0.04,
  captionLocked: false,
  durationSec: 47.82,
  hook: {text: 'The Quietest Moments Speak Loudest', start: 0, end: 3, anchor: 'top_left'},
  caption,
  brollClips: [cutaway],
  visualOverlays: [],
  insetReveals: [],
  frameInsets: [],
  mediaContainers: [],
  motionGraphics: [kinetic],
  semanticEmphasis: [emphasis],
  depthOverlays: [],
  transitions: [{at: 4.24, duration: 0.38, keyword: 'light leak'} as unknown as TransitionClip],
  zoomTriggers: [{start: 22.52, end: 23.72, scale: 1.25, sentenceIndex: 3} as ZoomTrigger],
  generatedGraphics: [{...pip, props: {theme: {accent: '#FFB88C'}}}],
  speaker: {box: {x: 0.18, y: 0.16, w: 0.64, h: 0.62}, source: 'fallback'},
  speakerCutout: {available: false},
  ...over,
});

describe('finalizeEdits', () => {
  it('applies the profile design, harmonizes colours, and resolves the saved collision', () => {
    const run = input();
    const out = finalizeEdits(run);
    expect(out.design).toMatchObject({enabled: true, contentType: 'story', motionPreset: 'editorial'});
    expect(out.motionGraphics[0]!.accentColor).toBe(out.design!.primaryColor);
    expect(out.caption.highlightColor).toBe(out.design!.primaryColor);
    // The emphasis repeats the kinetic text on the same anchor, so it is removed with a reason.
    expect(out.semanticEmphasis).toHaveLength(0);
    const lost = run.ledger.entries().find(entry => entry.type === 'emphasis')!;
    expect(outcomeOf(lost)).toBe('dropped');
    expect(lost.events.at(-1)).toMatchObject({stage: 'conflict_validator', reason: 'spatial_text_overlap'});
    expect(lost.events.at(-1)!.conflictsWith![0]).toMatch(/^kinetic_text@13400#/);
  });

  it('records the renderer hand-off and which tracks received theme data', () => {
    const run = input();
    finalizeEdits(run);
    const dump = run.ledger.toJSON();
    expect(dump.summary.reachedRendererByTrack).toMatchObject({
      HookTitle: 1,
      BRollTrack: 1,
      MotionGraphicTrack: 1,
      GeneratedGraphicTrack: 1,
      KineticCaptions: 1,
      ZoomFrame: 1,
    });
    expect(dump.trackTheme).toMatchObject({HookTitle: true, MotionGraphicTrack: true, SemanticEmphasisTrack: true, KineticCaptions: true, GeneratedGraphicTrack: true});
    expect(dump.stageContext.conflict_validator).toEqual({profile: false, theme: false});
  });

  it('leaves everything as the Director made it without a content profile', () => {
    const run = input({contentProfile: null, semanticEmphasis: [], captionLocked: false});
    const out = finalizeEdits(run);
    expect(out.design).toBeUndefined();
    expect(out.motionGraphics).toEqual([kinetic]);
    expect(out.caption).toEqual(caption);
    expect(run.ledger.toJSON().trackTheme).toMatchObject({HookTitle: false, MotionGraphicTrack: false});
  });

  it('keeps an existing (north-star) design instead of replacing it', () => {
    const existingDesign = {enabled: true, contentType: 'tutorial', displayFont: 'bebas', primaryColor: '#123456', secondaryColor: '#654321', inkColor: '#FFFFFF', surfaceColor: '#000000', motionPreset: 'kinetic', cornerRadius: 12, density: 'balanced'} as const;
    const out = finalizeEdits(input({existingDesign: {...existingDesign}}));
    expect(out.design).toEqual(existingDesign);
    expect(out.motionGraphics[0]!.accentColor).toBe('#C084FC');
  });

  it('marks a depth overlay with no keyed speaker video as rendered but not apparent', () => {
    const run = input();
    run.ledger.propose({type: 'depth_overlay', stage: 'visual_director', start: 20, end: 24, label: 'ub_1'});
    const id = run.ledger.entries().find(entry => entry.type === 'depth_overlay')!.id;
    run.ledger.accept(id, 'depth_planner');
    finalizeEdits({...run, depthOverlays: [{start: 20, end: 24} as unknown as DepthOverlayClip]});
    expect(outcomeOf(run.ledger.get(id)!)).toBe('rendered_not_apparent');
    expect(run.ledger.get(id)!.events.at(-1)).toMatchObject({track: 'DepthOverlayTrack', visibility: 'noop', reason: 'no_keyed_speaker_video'});
  });

  it('attributes zoom and anchor changes made after planning', () => {
    const ledger = new EditLedger();
    // Zoom outcomes now come from resolveDirectedZooms itself (see autoZoom.test.ts): an accurate reason, exact precision.
    const kineticId = ledger.propose({type: 'kinetic_text', stage: 'visual_director', start: 13.4, end: 16.4, label: kinetic.text});
    recordAnchorChanges(ledger, 'kinetic_text', [kinetic], [{...kinetic, anchor: 'top_right'}]);
    expect(ledger.get(kineticId)!.events.at(-1)).toMatchObject({reason: 'layout_compositor_moved_anchor', change: {anchorFrom: 'top_left', anchorTo: 'top_right'}});
  });

  it('attributes transitions truthfully: asset-less ones are a no-op unless the generated sweep is on', () => {
    const base = {at: 4.24, duration: 0.38, keyword: 'light leak'};
    const outcomeFor = (transition: object) => {
      const run = input({transitions: [transition as unknown as TransitionClip]});
      finalizeEdits(run);
      return run.ledger.entries().find(entry => entry.type === 'transition')!.events.at(-1)!;
    };
    expect(outcomeFor({...base, assetUrl: ''})).toMatchObject({decision: 'rendered', track: 'TransitionTrack', visibility: 'noop', reason: 'transition_has_no_asset_so_TransitionTrack_skips_it'});
    expect(outcomeFor({...base, assetUrl: '', renderGenerated: true})).toMatchObject({decision: 'rendered', visibility: 'visible'});
    expect(outcomeFor({...base, assetUrl: 'https://x/leak.mp4'})).toMatchObject({decision: 'rendered', visibility: 'visible'});
  });

  it('an edit that was accepted but reaches no renderer track is closed out with a reason, never left looking successful', () => {
    const run = input({depthOverlays: []});
    const id = run.ledger.propose({type: 'depth_overlay', stage: 'visual_director', start: 20, end: 24, label: 'ub_1'});
    run.ledger.accept(id, 'depth_planner', {to: {start: 20, end: 24}});
    expect(outcomeOf(run.ledger.get(id)!)).toBe('accepted_not_rendered');
    finalizeEdits(run);
    expect(outcomeOf(run.ledger.get(id)!)).toBe('dropped');
    expect(run.ledger.get(id)!.events.at(-1)).toMatchObject({stage: 'blueprint', decision: 'dropped', reason: 'accepted_but_not_handed_to_renderer', precision: 'exact'});
  });

  it('edits that DO reach a track are untouched by the close-out (no accepted-but-unrendered entry remains in a normal run)', () => {
    const run = input();
    finalizeEdits(run);
    expect(run.ledger.entries().filter(entry => outcomeOf(entry) === 'accepted_not_rendered')).toEqual([]);
    expect(run.ledger.entries().some(entry => entry.events.some(event => event.reason === 'accepted_but_not_handed_to_renderer'))).toBe(false);
  });
});
