import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {PROFILE_CONTENT_TYPES, VISUAL_MOODS} from '../contentProfile/contentProfile.ts';
import {
  BRIEF_RULES,
  MUSIC_STYLES,
  arcLyrics,
  buildMusicBrief,
  chooseArc,
  cutsPerMinute,
  energyOf,
  pickBpm,
  pickKey,
  speechWpm,
  styleFor,
  type MusicFamily,
} from './musicBrief.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const wordsAt = (wpm: number, count: number, gapAfter = 0) =>
  Array.from({length: count}, (_, i) => {
    const per = 60 / wpm;
    const start = i * per + (i > 0 ? gapAfter * Math.floor(i / 10) : 0);
    return {start, end: start + per * 0.9};
  });

describe('briefRules.json', () => {
  it('has the 5 families and 10 styles, each in one family', () => {
    expect(BRIEF_RULES.families).toEqual(['high-energy', 'nostalgic', 'calm', 'tense', 'neutral']);
    expect(MUSIC_STYLES).toHaveLength(10);
    for (const [name, style] of Object.entries(BRIEF_RULES.styles)) {
      expect(BRIEF_RULES.families, name).toContain(style.family);
    }
    for (const family of BRIEF_RULES.families) {
      expect(MUSIC_STYLES.filter(name => BRIEF_RULES.styles[name]!.family === family).length, family).toBeGreaterThan(0);
      expect(BRIEF_RULES.styles[BRIEF_RULES.familyDefaultStyle[family]]!.family).toBe(family);
    }
  });

  it('maps every visual mood x content type to an existing style (fails on any gap)', () => {
    const gaps: string[] = [];
    for (const mood of VISUAL_MOODS) {
      for (const type of PROFILE_CONTENT_TYPES) {
        const style = BRIEF_RULES.matrix[mood]?.[type];
        if (!style || !BRIEF_RULES.styles[style]) gaps.push(`${mood} x ${type}`);
      }
    }
    expect(gaps).toEqual([]);
    expect(Object.keys(BRIEF_RULES.matrix).sort()).toEqual([...VISUAL_MOODS].sort());
    for (const row of Object.values(BRIEF_RULES.matrix)) expect(Object.keys(row).sort()).toEqual([...PROFILE_CONTENT_TYPES].sort());
  });

  it('every style is within its tag budget, voice-first, and has a divisible-by-4 tempo range', () => {
    const forbidden = /\b(lead|solo|vocal|vocals|singing|choir|rap|arpeggio|screaming)\b/i;
    for (const [name, style] of Object.entries(BRIEF_RULES.styles)) {
      const tags = [style.genre, ...style.moodWords, ...style.instruments, ...BRIEF_RULES.supportTags, 'no vocals', '120 bpm'];
      expect(tags.length, `${name} tag count`).toBeLessThanOrEqual(BRIEF_RULES.maxCaptionTags);
      expect(BRIEF_RULES.supportTags).toContain('no lead melody');
      expect([style.genre, ...style.moodWords, ...style.instruments].join(' '), name).not.toMatch(forbidden);
      expect(style.bpmRange[0] % 4, name).toBe(0);
      expect(style.bpmRange[1] % 4, name).toBe(0);
      expect(style.bpmRange[0]).toBeLessThan(style.bpmRange[1]);
      expect(['major', 'minor']).toContain(style.mode);
      expect(style.roots.length).toBeGreaterThanOrEqual(4);
      expect(style.roots.length).toBeLessThanOrEqual(5);
    }
  });

  it('is imported, not read with fs, so the production build emits it', () => {
    const source = readFileSync(path.join(here, 'musicBrief.ts'), 'utf8');
    expect(source).toMatch(/from '\.\/briefRules\.json' with \{type: 'json'\}/);
    expect(source).not.toMatch(/readFileSync|node:fs/);
  });
});

describe('speech pace', () => {
  it('counts speech time only: a long pause does not slow the pace', () => {
    const fast = wordsAt(180, 60);
    expect(speechWpm(fast)).toBeGreaterThanOrEqual(175);
    expect(speechWpm(fast)).toBeLessThanOrEqual(185);
    const withPause = [...fast, ...fast.map(word => ({start: word.start + 100, end: word.end + 100}))]; // a 100 s silence in the middle
    expect(speechWpm(withPause)).toBeGreaterThanOrEqual(175);
  });
  it('a gap of 600 ms or less counts as speech, a longer one does not', () => {
    const short = [{start: 0, end: 0.4}, {start: 1.0, end: 1.4}, {start: 2.0, end: 2.4}]; // 0.6 s gaps
    const long = [{start: 0, end: 0.4}, {start: 1.1, end: 1.5}, {start: 2.2, end: 2.6}]; // 0.7 s gaps
    expect(speechWpm(short)).toBeLessThan(speechWpm(long));
    expect(speechWpm(long)).toBe(Math.round((3 / 1.2) * 60));
  });
  it('falls back to the default with too few words', () => {
    expect(speechWpm([])).toBe(BRIEF_RULES.pace.defaultWpm);
    expect(speechWpm([{start: 0, end: 1}])).toBe(BRIEF_RULES.pace.defaultWpm);
  });
});

describe('tempo', () => {
  const pop = BRIEF_RULES.styles['upbeat-pop']!; // 100..124
  it.each([
    [110, 0, 100],
    [129, 0, 100],
    [130, 0, 112],
    [150, 0, 112],
    [170, 0, 112],
    [171, 0, 124],
    [200, 0, 124],
    // a high cut rate nudges up one band step
    [110, 31, 112],
    [150, 31, 124],
    [200, 31, 124],
    [150, 30, 112], // 30 is not above 30
  ])('upbeat-pop at %i wpm and %i cuts/min is %i bpm', (wpm, cuts, expected) => {
    expect(pickBpm(pop, wpm, cuts)).toBe(expected);
  });

  it('is always divisible by 4 and inside the style range, for every style over a grid of paces and cut rates', () => {
    for (const [name, style] of Object.entries(BRIEF_RULES.styles)) {
      for (let wpm = 60; wpm <= 260; wpm += 7) {
        for (const cuts of [0, 10, 30, 31, 80]) {
          const bpm = pickBpm(style, wpm, cuts);
          expect(bpm % 4, `${name} ${wpm} ${cuts}`).toBe(0);
          expect(bpm).toBeGreaterThanOrEqual(style.bpmRange[0]);
          expect(bpm).toBeLessThanOrEqual(style.bpmRange[1]);
        }
      }
    }
  });

  it('snaps the middle of an odd range to a multiple of 4', () => {
    expect(pickBpm({...pop, bpmRange: [72, 88]}, 150, 0)).toBe(80);
    expect(pickBpm({...pop, bpmRange: [76, 96]}, 150, 0)).toBe(88);
  });
});

describe('key', () => {
  it('uses the style mode and a root from its list; stable per video, varied across videos', () => {
    const style = BRIEF_RULES.styles['warm-keys']!;
    expect(pickKey(style, 'video-1')).toBe(pickKey(style, 'video-1'));
    const keys = new Set(Array.from({length: 40}, (_, i) => pickKey(style, `video-${i}`)));
    expect(keys.size).toBeGreaterThan(2);
    for (const key of keys) {
      const [root, mode] = key.split(' ');
      expect(style.roots).toContain(root);
      expect(mode).toBe(style.mode);
    }
  });
});

describe('arc', () => {
  it.each([
    [10, 'medium', 'hook-then-steady'],
    [24.9, 'low', 'hook-then-steady'],
    [25, 'medium', 'build'],
    [40, 'high', 'build'],
    [60, 'medium', 'build'],
    [40, 'low', 'steady'],
    [61, 'medium', 'steady'],
    [120, 'high', 'steady'],
  ] as const)('%i s at %s energy is %s', (duration, energy, arc) => {
    expect(chooseArc(duration, energy)).toBe(arc);
  });
  it('sends the section tags for each arc, each at least 10 characters', () => {
    expect(arcLyrics('hook-then-steady')).toBe('[intro]\n\n[drop]\n\n[inst]');
    expect(arcLyrics('build')).toBe('[intro]\n\n[build-up]\n\n[drop]\n\n[inst]');
    expect(arcLyrics('steady')).toBe('[intro]\n\n[inst]\n\n[inst]');
    for (const arc of ['hook-then-steady', 'build', 'steady'] as const) expect(arcLyrics(arc).length).toBeGreaterThanOrEqual(10);
  });
});

describe('buildMusicBrief', () => {
  const base = {videoId: 'vid-1', captionWords: wordsAt(185, 80), durationSec: 18, visualMood: 'bold_energetic', contentType: 'motivational', cutCount: 14};
  it('is deterministic and describes a fast, short, energetic edit', () => {
    const a = buildMusicBrief(base);
    expect(buildMusicBrief(base)).toEqual(a);
    expect(a).toMatchObject({style: 'driving-electronic', family: 'high-energy', arc: 'hook-then-steady', energy: 'high', hookAtSec: 2.5, ctaAtSec: null, durationSec: 18});
    expect(a.speechWpm).toBeGreaterThan(170);
    expect(a.bpm).toBe(128);
    expect(a.cutsPerMin).toBeCloseTo(46.7, 1);
    expect(a.key).toMatch(/ minor$/);
  });
  it('falls back to the family default style when mood or type is missing', () => {
    expect(styleFor({fallbackFamily: 'calm'})).toEqual({style: 'lofi-chill', fromMatrix: false});
    expect(styleFor({visualMood: 'nope', contentType: 'x', fallbackFamily: 'tense'}).style).toBe('cinematic-pulse');
    expect(styleFor({visualMood: 'warm_intimate', contentType: 'personal_story'})).toEqual({style: 'warm-keys', fromMatrix: true});
    const noMood = buildMusicBrief({...base, visualMood: undefined, contentType: undefined, fallbackFamily: 'nostalgic'});
    expect(noMood.style).toBe('warm-keys');
    expect(noMood.family).toBe('nostalgic' satisfies MusicFamily);
  });
  it('a slow calm 90 s edit is low energy and steady', () => {
    const slow = buildMusicBrief({videoId: 'v2', captionWords: wordsAt(115, 150), durationSec: 90, visualMood: 'calm_cool', contentType: 'tutorial', cutCount: 6});
    expect(slow).toMatchObject({style: 'lofi-chill', energy: 'low', arc: 'steady', bpm: 72});
  });
  it('energy and cut rate helpers', () => {
    expect(cutsPerMinute({durationSec: 30, cutTimesSec: [1, 2, 3, 4, 5]})).toBe(10);
    expect(cutsPerMinute({durationSec: 0, cutCount: 5})).toBe(0);
    expect(energyOf(120, 5)).toBe('low');
    expect(energyOf(150, 20)).toBe('medium');
    expect(energyOf(150, 31)).toBe('high');
  });
});
