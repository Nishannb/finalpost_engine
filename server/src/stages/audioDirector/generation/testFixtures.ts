/** Shared Phase 1.5 test fixtures (test-only). */
import type {AudioPlanInput} from '../audioPlan/planSchema.ts';
import {buildEventSheet} from '../eventSheet/buildEventSheet.ts';
import {base, kineticSpec} from '../eventSheet/testFixtures.ts';
import {buildBgmRequest, buildSfxRequests, type BgmIntentInput, type SfxIntentInput} from './requests.ts';
import {encodeWav16} from './wav.ts';

export {hiIntent, hiPlan, hiSheet, W} from '../listeningTest/firstBgmStory.ts';

/** A deterministic "generated bed": a soft chord with a slow swell, mono 22.05 kHz. */
export const bedWav = (seconds: number, sampleRate = 22050) =>
  encodeWav16(sampleRate, 1, Math.round(seconds * sampleRate), f => {
    const t = f / sampleRate;
    return 0.25 * Math.min(1, t / 2) * (Math.sin(2 * Math.PI * 147 * t) + 0.6 * Math.sin(2 * Math.PI * 220 * t) + 0.4 * Math.sin(2 * Math.PI * 294 * t)) / 2;
  });

/** A deterministic "generated SFX": `leadSec` of near-silence, then a decaying burst, 2 s long like the project's SFX task. */
export const sfxWav = (leadSec = 0.1, seconds = 2, sampleRate = 22050) =>
  encodeWav16(sampleRate, 1, Math.round(seconds * sampleRate), f => {
    const t = f / sampleRate - leadSec;
    if (t < 0) return 0.0005 * Math.sin(2 * Math.PI * 50 * (f / sampleRate));
    return 0.7 * Math.exp(-t * 9) * Math.sin(2 * Math.PI * (180 + 600 * Math.exp(-t * 20)) * t);
  });

// --- One edit with both a bed and event SFX: the event-rich synthetic sheet (10 s, words at 0.2 / 0.6 / 5.1 s) -----------------------------

export const richSheet = buildEventSheet(base({kinetic: kineticSpec(), hookTitle: 'Three things changed'}));

export const richPlan: AudioPlanInput = {
  version: 1,
  eventSheet: {version: 2, timingHash: richSheet.timingHash},
  visualContentHash: richSheet.visualContentHash,
  music: {
    assetId: 'placeholder-replaced-by-generated-bed',
    start: {kind: 'start'},
    end: {kind: 'end'},
    fadeIn: 'short',
    ending: 'fade',
    sections: [{from: {kind: 'event', eventId: 'cut@4000', at: 'impact'}, to: {kind: 'word', wordId: 'w2', at: 'start'}, energy: 'low', level: 'quiet'}],
  },
  sfx: [],
  provenance: {author: 'hand', note: 'Phase 1.5 offline fixture'},
};

export const richIntent = {
  subject: 'Three things that changed',
  narrative: 'A quick hook, a hard cut into the explanation, then the reveal of what changed.',
  identity: {genre: 'minimal electronic', moodWords: ['curious'], instruments: ['soft synth pad'], texture: [], avoid: []},
  tempo: {bpm: 96, feel: 'steady'},
  key: 'A minor',
  intro: 'immediate',
  ending: 'fade',
  progression: [
    {from: {kind: 'start'}, to: {kind: 'event', eventId: 'cut@4000', at: 'impact'}, role: 'establish', energy: 'medium', emotion: 'curious'},
    {from: {kind: 'event', eventId: 'cut@4000', at: 'impact'}, to: {kind: 'end'}, role: 'build', energy: 'medium', emotion: 'anticipation'},
  ],
} satisfies BgmIntentInput;

export const richSfxIntents: SfxIntentInput[] = [
  {eventId: 'hook@0', purpose: 'title_reveal', character: {family: 'swell', description: 'gentle airy swell'}, durationSec: {min: 0.2, max: 0.8}, intensity: 'subtle', essential: false},
  {eventId: 'cut@4000', purpose: 'scene_change', character: {family: 'impact', description: 'soft low thud'}, durationSec: {min: 0.1, max: 0.5}, intensity: 'subtle', essential: true},
  {eventId: 'transition@6000', purpose: 'scene_change', character: {family: 'whoosh', description: 'short airy whoosh'}, durationSec: {min: 0.1, max: 0.6}, intensity: 'normal', essential: false},
];

export function richRequests() {
  const bgm = buildBgmRequest({sheet: richSheet, plan: richPlan, intent: richIntent, videoId: 'rich', voLufs: -20});
  if (!bgm.ok) throw new Error(JSON.stringify(bgm.errors));
  const sfx = buildSfxRequests({sheet: richSheet, intents: richSfxIntents, videoId: 'rich'});
  if (sfx.refused.length || sfx.dropped.length) throw new Error(JSON.stringify(sfx));
  return {bgm: bgm.request, sfx: sfx.requests};
}
