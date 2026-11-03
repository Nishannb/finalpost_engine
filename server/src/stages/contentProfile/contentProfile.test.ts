import {describe, expect, it} from 'vitest';

import {assembleDirectedGraphics, buildMotionDirectorPrompt, directMotionGraphics, effectiveMaxGraphics} from '../motionDirector/motionDirector.ts';
import {
  contrastRatio,
  parseContentProfile,
  policyFor,
  profileBlockForMotionDirector,
  profileBlockForVisualDirector,
  themeForMood,
  VISUAL_MOODS,
} from './contentProfile.ts';

const relationship = () =>
  parseContentProfile({
    content_type: 'relationship_emotional',
    structure: 'narrative',
    pacing: 'slow',
    graphics_density: 'rich',
    visual_mood: 'warm_intimate',
    tone: 'tender, reflective',
    rationale: 'Reflection on silence between partners.',
  });

describe('content profile policy', () => {
  it('clamps density to what the content type can carry', () => {
    const profile = relationship();
    expect(profile.density).toBe('sparse');
    expect(profile.policy.maxGraphics).toBe(1);
    expect(policyFor('tutorial', 'enumerated', 'rich').policy.maxGraphics).toBe(4);
    expect(policyFor('relationship_emotional', 'narrative', 'none').policy.maxGraphics).toBe(0);
  });

  it('only allows lists and section labels when the speaker enumerates', () => {
    expect(relationship().policy).toMatchObject({listsAllowed: false, sectionLabelsAllowed: false});
    expect(policyFor('educational_tips', 'enumerated', 'rich').policy).toMatchObject({listsAllowed: true, sectionLabelsAllowed: true});
    expect(policyFor('educational_tips', 'conversational', 'rich').policy.listsAllowed).toBe(false);
    expect(policyFor('tutorial', 'conversational', 'moderate').policy.sectionLabelsAllowed).toBe(true);
    expect(policyFor('sales_pitch', 'argument', 'rich').policy).toMatchObject({listsAllowed: true, sectionLabelsAllowed: false});
  });

  it('falls back to neutral values for missing or invalid model output', () => {
    const profile = parseContentProfile({content_type: 'not-a-type', structure: 7, visual_mood: 'neon'});
    expect(profile).toMatchObject({contentType: 'other', structure: 'conversational', pacing: 'medium', density: 'sparse', source: 'gemini'});
    expect(parseContentProfile(null).contentType).toBe('other');
  });

  it('gives different content different looks', () => {
    const themes = new Set(
      (['relationship_emotional', 'tutorial', 'motivational', 'testimonial'] as const).map(type =>
        parseContentProfile({content_type: type, structure: 'narrative'}).theme.background,
      ),
    );
    expect(themes.size).toBe(4);
  });
});

describe('profile theme', () => {
  it('keeps text readable on the background in every mood', () => {
    for (const mood of VISUAL_MOODS) {
      const theme = themeForMood(mood);
      expect(contrastRatio(theme.text, theme.background)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(theme.text, theme.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.accent, theme.background)).toBeGreaterThanOrEqual(3);
    }
  });

  it('accepts the model accent only when it reads on the background', () => {
    expect(themeForMood('warm_intimate', '#FF8800').accent).toBe('#FF8800');
    expect(themeForMood('warm_intimate', '#2A1621').accent).toBe(themeForMood('warm_intimate').accent);
    expect(themeForMood('warm_intimate', 'orange').accent).toBe(themeForMood('warm_intimate').accent);
  });
});

describe('prompt blocks and motion director cap', () => {
  const words = Array.from({length: 40}, (_, index) => ({text: `w${index}`, start: index, end: index + 0.5}));
  const base = {transcript: 'x', words, outputDurationSec: 48, languageCode: 'en', occupied: []};

  it('tells both directors what the content is and what is not allowed', () => {
    const profile = relationship();
    const visual = profileBlockForVisualDirector(profile);
    expect(visual).toContain('relationship_emotional');
    expect(visual).toContain('NOT allowed');
    expect(visual).toContain('edit kinds to avoid');
    expect(visual.endsWith('\n\n')).toBe(true);
    const motion = buildMotionDirectorPrompt({...base, contentProfile: profile});
    expect(motion).toContain('Maximum graphics: 1.');
    expect(motion).toContain(profileBlockForMotionDirector(profile));
    expect(buildMotionDirectorPrompt(base)).not.toContain('CONTENT PROFILE');
  });

  it('caps graphics by profile and skips the model call when none are allowed', async () => {
    const none = parseContentProfile({content_type: 'comedy', structure: 'conversational', graphics_density: 'none'});
    expect(effectiveMaxGraphics({...base, contentProfile: none})).toBe(0);
    expect(effectiveMaxGraphics(base)).toBe(6);
    const result = await directMotionGraphics({...base, contentProfile: none});
    expect(result).toMatchObject({graphics: [], model: 'skipped', costUsd: 0});

    const raw = {
      graphics: [1, 2].map(n => ({
        id: `g${n}`, anchorWordIndex: n * 12, durationSeconds: 3, reason: 'r', goal: 'g', visualDescription: 'v',
        placement: 'pip', box: {x: 0.2, y: 0.1, w: 0.6, h: 0.2}, contentJson: '{"label":"x"}',
      })),
    };
    const out = assembleDirectedGraphics(raw, {...base, contentProfile: relationship()});
    expect(out.graphics).toHaveLength(1);
    expect(out.refusals[0]!.reason).toMatch(/over the maximum of 1/);
  });
});
