import {describe, expect, it} from 'vitest';

import {buildMusicBrief, speechWpm} from '../stages/music/musicBrief.ts';
import {assertWriteFlag, buildScenarioWords, cutTimesFor, SCENARIOS} from './makePersonalizeProof.ts';

describe('makePersonalizeProof', () => {
  it('refuses without --write', () => {
    expect(() => assertWriteFlag([])).toThrow(/--write/);
    expect(() => assertWriteFlag(['--write'])).not.toThrow();
  });

  it.each(SCENARIOS)('$name: words match the intended pace, pauses are real pauses, and the speech stays inside the video', scenario => {
    const {words, bursts} = buildScenarioWords(scenario);
    expect(Math.abs(speechWpm(words) - scenario.wpm)).toBeLessThanOrEqual(6);
    expect(words.at(-1)!.end).toBeLessThan(scenario.durationSec - 0.5);
    bursts.forEach((burst, i) => {
      if (i > 0) expect(burst.start - bursts[i - 1]!.end).toBeGreaterThanOrEqual(0.6);
    });
    for (const cut of cutTimesFor(scenario)) expect(cut).toBeLessThan(scenario.durationSec);
  });

  it('the three scenarios produce three different briefs: fast and short, normal, slow and long', () => {
    const briefs = SCENARIOS.map(scenario => {
      const {words} = buildScenarioWords(scenario);
      return buildMusicBrief({videoId: `pz-${scenario.name}`, captionWords: words, durationSec: scenario.durationSec, visualMood: scenario.visualMood, contentType: scenario.contentType, cutCount: new Set(words.map(w => w.sentenceIndex)).size});
    });
    expect(briefs.map(brief => [brief.style, brief.arc, brief.energy])).toEqual([
      ['driving-electronic', 'hook-then-steady', 'high'],
      ['corporate-light', 'build', 'medium'],
      ['lofi-chill', 'steady', 'low'],
    ]);
    expect(briefs.map(brief => brief.bpm)).toEqual([128, 104, 72]);
    for (const brief of briefs) expect(brief.bpm % 4).toBe(0);
  });
});
