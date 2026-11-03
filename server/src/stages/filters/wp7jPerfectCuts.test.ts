/**
 * WP7J offline tests: the LIVE keep-plan of bp_86256bbb180c4029bbcc (which kept a lone "Collaboration.") through the hardened apply + post-scrub, shred-free edges, a plan that wrongly keeps two
 * same-idea takes, and prompt pins. No live model, no audio, no video.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import type {WordToken} from '../../types/blueprint.ts';
import {keepSegmentsFor} from './autoTrim.ts';
import {buildCaptionWords} from './autoZoom.ts';
import {applyAiKeepPlan, buildKeepPlanPrompt, buildKeepPlanSegments, parseKeepPlan} from './cutsAiKeepPlan.ts';
import {buildTimeline} from './timeline.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const live = JSON.parse(readFileSync(resolve(HERE, 'fixtures/bp_86256bbb180c4029bbcc.words.json'), 'utf8')) as {sourceDurationSec: number; words: WordToken[]};
const LIVE_PLAN = readFileSync(resolve(HERE, 'fixtures/bp_86256bbb180c4029bbcc.aiKeepPlan.raw.json'), 'utf8');
const DURATION = live.sourceDurationSec;
const count = (text: string, phrase: RegExp) => (text.match(phrase) ?? []).length;

function captions(exclusions: Array<{start: number; end: number}>, words = live.words) {
  return buildCaptionWords(words, buildTimeline(keepSegmentsFor(exclusions, DURATION)), exclusions).map(word => word.text).join(' ');
}
const apply = (plan: unknown) => applyAiKeepPlan({words: live.words, plan: parseKeepPlan(typeof plan === 'string' ? plan : JSON.stringify(plan)), sourceDurationSec: DURATION});

describe('fixture A: the live plan that kept a lone "Collaboration."', () => {
  const raw = apply(LIVE_PLAN);
  it('is accepted and the post-scrub removes the stutter', () => {
    expect(raw.ok).toBe(true);
    if (raw.ok) expect(raw.scrub.stutter).toBeGreaterThanOrEqual(1);
  });
  const text = raw.ok ? captions(raw.exclusions) : '';
  it('kept text: no lone Collaboration, no yeah, one opening, one Figma-raised, one pitch-deck, a close', () => {
    expect(text).not.toMatch(/Collaboration\./);
    expect(text).not.toMatch(/\b(yeah|yep|yup)\b/i);
    expect(count(text, /This is exactly how Figma/g)).toBe(1);
    expect(count(text, /Figma raised/g)).toBe(1);
    expect(count(text, /pitch deck/g)).toBe(1);
    expect(text).not.toContain('Redefined');
    expect(count(text, /productivity/g)).toBe(1);
    expect(text).toBe(
      'This is exactly how Figma revolutionized the space for collaborative design. ' +
        'Figma raised millions by solving a single problem that every design team faces. ' +
        "Here's how pitch deck brought their vision to fruition. " +
        "highlighted how design tools weren't built for collaborative efforts. " +
        'Creating bottlenecks in productivity. ' +
        "That's the problem right there.", // WP7K: the 3.18 s \"raised\" take is swapped, stuck their / Figma / traditional / Now are cut out
    );
  });
  it('a plan that keeps a glued yeah has it removed with no model veto', () => {
    const withYeah = apply({keep: [{start: 13.1, end: 18.74}, {start: 25.54, end: 28.16}, {start: 39.8, end: 49.42}, {start: 58.2, end: 62.44}, {start: 70.8, end: 80.48}, {start: 87.56, end: 91.92}]});
    expect(withYeah.ok).toBe(true);
    const t = withYeah.ok ? captions(withYeah.exclusions) : '';
    expect(t).not.toMatch(/yeah/i);
    if (withYeah.ok) {
      expect(withYeah.scrub.yeah).toBe(1);
      expect(count(t, /Figma raised/g)).toBe(1);
    }
  });
});

describe('fixture B: a plan that wrongly keeps two (then four) Figma-raised takes', () => {
  it('collapses to one, the longer / later take', () => {
    const two = apply({keep: [{start: 13.1, end: 18.74}, {start: 30.86, end: 39.28}, {start: 39.8, end: 49.42}, {start: 58.2, end: 62.44}, {start: 70.8, end: 80.48}]});
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    const t = captions(two.exclusions);
    expect(count(t, /Figma raised/g)).toBe(1);
    expect(t).toContain('pitch deck');
    expect(two.scrub.dupe).toBeGreaterThanOrEqual(1);
    const four = apply({keep: [{start: 20.22, end: 25.1}, {start: 25.54, end: 28.16}, {start: 30.86, end: 39.28}, {start: 39.8, end: 49.42}, {start: 58.2, end: 62.44}, {start: 70.8, end: 80.48}, {start: 87.56, end: 91.92}]});
    expect(four.ok).toBe(true);
    if (four.ok) {
      const t4 = captions(four.exclusions);
      expect(count(t4, /Figma raised/g)).toBe(1);
      expect(t4).not.toMatch(/yeah/i);
    }
  });
  it('different ideas are not collapsed', () => {
    const ok = apply({keep: [{start: 13.1, end: 18.74}, {start: 39.8, end: 49.42}, {start: 58.2, end: 62.44}, {start: 70.8, end: 80.48}, {start: 87.56, end: 91.92}]});
    expect(ok.ok && ok.scrub.dupe).toBe(0);
  });
});

describe('shred-free apply', () => {
  it('a keep range starting 50 ms early inside the previous retake word does not keep that word', () => {
    const segments = buildKeepPlanSegments(live.words);
    const previous = segments.find(segment => segment.end > 18.5 && segment.end < 18.9)!; // "This is exactly how Figma revolutionized the space ... design." (dropped)
    const lastWord = [...live.words].reverse().find(word => word.end <= previous.end + 0.001)!;
    const result = apply({keep: [{start: 0.5, end: 3.2}, {start: lastWord.end - 0.05, end: 25.1}, {start: 54.64, end: 57.48}, {start: 81.46, end: 83.42}, {start: 87.56, end: 89.08}]});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const t = captions(result.exclusions);
    expect(t).not.toContain(lastWord.text);
    expect(t).toContain('Figma raised millions by solving');
  });
  it('the cut reaches to within 20 ms of the kept words on both sides (dropped audio cannot bleed)', () => {
    const result = apply({keep: [{start: 13.1, end: 18.74}, {start: 54.64, end: 57.48}, {start: 58.2, end: 62.44}, {start: 81.46, end: 83.42}, {start: 87.56, end: 89.08}]});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const around = result.exclusions.find(range => range.start >= 18.74 && range.start < 19.2)!;
    expect(around.start - 18.74).toBeLessThanOrEqual(0.0201);
    const before = result.exclusions.find(range => range.end > 54 && range.end <= 54.7)!;
    expect(54.64 - before.end).toBeLessThanOrEqual(0.0201);
  });
  it('post-scrub cannot empty the timeline: a plan whose only kept segment is a stutter is refused', () => {
    expect(apply({keep: [{start: 50.9, end: 51.98}]})).toMatchObject({ok: false});
  });
  it('doubled words are removed ("we we"), "very very" is not', () => {
    const w = (text: string, start: number): WordToken => ({text, start, end: start + 0.3});
    const base = [w('so', 0), w('we', 0.35), w('we', 0.7), w('built', 1.05), w('a', 1.4), w('very', 1.75), w('very', 2.1), w('fast', 2.45), w('tool', 2.8), w('today.', 3.15)];
    const result = applyAiKeepPlan({words: base, plan: {keep: [{start: 0, end: 3.5}]}, sourceDurationSec: 4});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scrub.stutter).toBe(1);
      expect(result.exclusions.some(range => range.start >= 0.3 && range.end <= 0.75)).toBe(true);
    }
  });
});

describe('prompt pins (WP7J)', () => {
  const user = buildKeepPlanPrompt(buildKeepPlanSegments(live.words), DURATION).user;
  const { system } = buildKeepPlanPrompt(buildKeepPlanSegments(live.words), DURATION);
  it('demands ideas + one range per idea, a semantic duplicate rule, and drop-when-in-doubt', () => {
    for (const needle of ['"ideas"', 'exactly ONE source range', 'NEVER a second range', 'SAME-IDEA RULE', 'semantic', 'redefined', 'collaborative', 'tens of millions', 'When in doubt, DROP', 'NEVER KEEP', 'yeah', 'How did it out?', '"Collaboration." alone']) {
      expect(user, needle).toContain(needle);
    }
    expect(system).toContain('surgical');
    expect(system).toContain('product defects');
  });
  it('the old soft bias is gone', () => {
    expect(user).not.toMatch(/40-85%|usually keeps roughly/);
    expect(user).not.toContain('Do not drop most of the video');
  });
  it('parse stays backward compatible with and without ideas', () => {
    expect(parseKeepPlan('{"keep":[{"start":1,"end":2}]}')).toEqual({keep: [{start: 1, end: 2}]});
    expect(parseKeepPlan('{"ideas":["a","b"],"keep":[{"start":1,"end":2}]}')).toEqual({ideas: ['a', 'b'], keep: [{start: 1, end: 2}]});
  });
  it('analyzeVideo reports the post-scrub counts', () => {
    const analyze = readFileSync(resolve(HERE, '..', '..', 'pipeline', 'analyzeVideo.ts'), 'utf8');
    expect(analyze).toContain('cuts_ai_keep_plan_post_scrub:yeah=');
  });
});
