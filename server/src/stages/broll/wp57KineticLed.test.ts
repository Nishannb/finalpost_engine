/**
 * WP57 Kinetic-Led mode (style bible). Flag default off. Density / variety / face / colors.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {
  KINETIC_LED_CONFIG,
  familyRepeatsTooOften,
  kineticAnchorForSubject,
  kineticLedBeatBudget,
  kineticMotionFamily,
  shouldDemoteCompetingStat,
} from './kineticLedConfig.ts';
import {kineticBeatBudget} from './kineticTypeStory.ts';
import {KINETIC_STORY_IDS, planCraftTemplateBeats} from './planCraftTemplateBeats.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function wordsFor(sentences: string[], gap = 3.2) {
  const words: {text: string; start: number; end: number}[] = [];
  let t = 1.2;
  for (const sentence of sentences) {
    for (const text of sentence.split(/\s+/)) {
      words.push({text, start: t, end: t + 0.28});
      t += 0.32;
    }
    t += gap;
  }
  return words;
}

describe('WP57 kinetic-led config', () => {
  it('style bible colors and density constants', () => {
    expect(KINETIC_LED_CONFIG.style.background).toBe('#F7F6F2');
    expect(KINETIC_LED_CONFIG.style.primaryText).toBe('#171717');
    expect(KINETIC_LED_CONFIG.style.secondaryText).toBe('#85837E');
    expect(KINETIC_LED_CONFIG.style.accentCount).toBe(1);
    expect(KINETIC_LED_CONFIG.density.targetSecondsPerBeat).toBe(3.5);
    expect(KINETIC_LED_CONFIG.density.minimumSecondsPerBeat).toBe(2);
    expect(KINETIC_LED_CONFIG.captions.persistDuringOverlays).toBe(true);
    expect(KINETIC_LED_CONFIG.enabled).toBe(false);
  });

  it('budget ~10–13 at 40s; sparse budget stays ≤5; short clips are empty', () => {
    const led = kineticLedBeatBudget(40);
    expect(led).toBeGreaterThanOrEqual(10);
    expect(led).toBeLessThanOrEqual(13);
    expect(kineticLedBeatBudget(8)).toBeGreaterThanOrEqual(1);
    expect(kineticLedBeatBudget(0)).toBe(0);
    expect(kineticBeatBudget(40)).toBeLessThanOrEqual(5);
  });

  it('env flag defaults off', () => {
    const env = readFileSync(join(root, 'server/src/config/env.ts'), 'utf8');
    expect(env).toMatch(/POLISH_KINETIC_LED:\s*bool\(false\)/);
  });
});

describe('WP57 variety and face', () => {
  it('refuses a fourth consecutive family; maps templates', () => {
    expect(familyRepeatsTooOften(['word_reveal', 'word_reveal', 'word_reveal'], 'word_reveal')).toBe(true);
    expect(familyRepeatsTooOften(['word_reveal', 'word_reveal', 'word_reveal'], 'line_build')).toBe(false);
    expect(kineticMotionFamily('clip_48_type_split_color_headline')).toBe('split_phrase');
    expect(kineticMotionFamily('clip_46_type_impact_number')).toBe('scale_emphasis');
    expect(kineticMotionFamily('clip_49_type_kinetic_word_pop')).toBe('word_reveal');
  });

  it('places type in negative space relative to the face', () => {
    expect(kineticAnchorForSubject({x: 0.05, y: 0.25, w: 0.3, h: 0.5})).toBe('right');
    expect(kineticAnchorForSubject({x: 0.65, y: 0.25, w: 0.3, h: 0.5})).toBe('left');
    expect(kineticAnchorForSubject({x: 0.3, y: 0.02, w: 0.4, h: 0.5})).toBe('lower_third');
    expect(kineticAnchorForSubject({x: 0.3, y: 0.28, w: 0.4, h: 0.45})).toBe('headroom');
    expect(kineticAnchorForSubject({x: 0.35, y: 0.3, w: 0.25, h: 0.3})).toBe('center');
  });

  it('demotes a stat plate that overlaps a kinetic number beat', () => {
    expect(shouldDemoteCompetingStat(10, [{start: 9.5, end: 12, templateId: 'clip_46_type_impact_number'}])).toBe(true);
    expect(shouldDemoteCompetingStat(20, [{start: 9.5, end: 12, templateId: 'clip_46_type_impact_number'}])).toBe(false);
  });
});

describe('WP57 planner density', () => {
  it('kineticLed places more story beats than the sparse default on a 40s pitch', () => {
    const sentences = [
      'Real growth matters now.',
      'Sales jumped 200 percent today.',
      'Not luck but proof.',
      'Remember the bottom line here.',
      'Never ignore this result.',
      'Simple offer beats noise.',
      'We gained 50 leads fast.',
      'Instead of ads use trust.',
      'Free audit changes everything.',
      'That is why growth compounds.',
      'Attention drives the whole story.',
      'Just DM me for a free video.',
    ];
    const words = wordsFor(sentences, 0.4);
    const duration = words[words.length - 1]!.end + 1;
    const box = {x: 0.25, y: 0.3, w: 0.5, h: 0.45};
    const sparse = planCraftTemplateBeats({skill: 'explainer', durationSec: Math.max(40, duration), words, subjectBox: box});
    const led = planCraftTemplateBeats({skill: 'explainer', durationSec: Math.max(40, duration), words, subjectBox: box, kineticLed: true});
    const count = (p: typeof sparse) => p.beats.filter(b => (KINETIC_STORY_IDS as readonly string[]).includes(b.templateId)).length;
    expect(count(led)).toBeGreaterThan(count(sparse));
    // Speech in this fixture spans ~24s; with a 2s gap and ~2s hold the realized count is ~5–8, above the sparse cap.
    expect(count(led)).toBeGreaterThanOrEqual(5);
    expect(led.warnings.some(w => w.startsWith('kinetic_led:budget:'))).toBe(true);
    const overlay = led.beats.find(b => b.templateId === 'clip_49_type_kinetic_word_pop' || b.templateId === 'clip_45_type_environmental_hero');
    expect(overlay?.muteCaptions).toBe(false);
    expect(overlay?.hint && (overlay.hint as {ground?: string}).ground).toBe('#F7F6F2');
  });
});
