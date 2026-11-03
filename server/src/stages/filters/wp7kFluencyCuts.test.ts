/**
 * WP7K offline tests: the LIVE WP7J plan of bp_948e00850b8841b694f7 (kept a 3.18 s "raised" and a 4.08 s "traditional") through the fluency scrub, stuck-word swap / excise / drop, same-line restarts,
 * backchannel pad, and prompt pins. No live model, no audio, no video.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import type {WordToken} from '../../types/blueprint.ts';
import {keepSegmentsFor} from './autoTrim.ts';
import {buildCaptionWords} from './autoZoom.ts';
import {STUCK_WORD_SEC, applyAiKeepPlan, buildKeepPlanPrompt, buildKeepPlanSegments, parseKeepPlan} from './cutsAiKeepPlan.ts';
import {buildTimeline} from './timeline.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const live = JSON.parse(readFileSync(resolve(HERE, 'fixtures/bp_948e00850b8841b694f7.words.json'), 'utf8')) as {sourceDurationSec: number; words: WordToken[]};
const LIVE_PLAN = readFileSync(resolve(HERE, 'fixtures/bp_948e00850b8841b694f7.aiKeepPlan.raw.json'), 'utf8');
const DURATION = live.sourceDurationSec;
const count = (text: string, phrase: RegExp) => (text.match(phrase) ?? []).length;

const apply = (plan: unknown, words: WordToken[] = live.words, duration = DURATION) =>
  applyAiKeepPlan({words, plan: parseKeepPlan(typeof plan === 'string' ? plan : JSON.stringify(plan)), sourceDurationSec: duration});
function captionWords(exclusions: Array<{start: number; end: number}>, words: WordToken[] = live.words, duration = DURATION) {
  return buildCaptionWords(words, buildTimeline(keepSegmentsFor(exclusions, duration)), exclusions);
}
const range = (start: number, end: number) => ({start, end, reason: 'x'});

describe('fixture: the live WP7J plan with stuck words', () => {
  const raw = apply(LIVE_PLAN);
  const result = raw.ok ? raw : null;
  const kept = result ? captionWords(result.exclusions) : [];
  const text = kept.map(word => word.text).join(' ');
  it('is accepted and the scrub counts the stuck takes', () => {
    expect(raw.ok).toBe(true);
    expect(result!.scrub.stuck).toBeGreaterThanOrEqual(3);
  });
  it('no kept word is held STUCK_WORD_SEC or longer (raised@40.22 and traditional@73.34 are gone)', () => {
    const stuckSource = live.words.filter(w => w.end - w.start >= STUCK_WORD_SEC);
    expect(stuckSource.length).toBeGreaterThan(3);
    const keptWordIsStuck = (w: WordToken) => result!.keepRanges.some(r => (w.start + w.end) / 2 >= r.start && (w.start + w.end) / 2 <= r.end) && !result!.exclusions.some(e => (w.start + w.end) / 2 >= e.start && (w.start + w.end) / 2 <= e.end);
    expect(stuckSource.filter(keptWordIsStuck).map(w => `${w.text}@${w.start}`)).toEqual([]);
    expect(text).not.toMatch(/\bFigma raised tens of millions\b/);
  });
  it('the 3.18 s "tens of millions" take loses to the fluent sibling; the rest reads cleanly', () => {
    expect(count(text, /Figma raised/g)).toBe(1);
    expect(text).toContain('Figma raised millions by solving a single problem that every design team faces.');
    expect(text).not.toMatch(/\b(yeah|yep|yup)\b/i);
    expect(text).not.toMatch(/Collaboration\./);
    expect(count(text, /This is exactly how Figma/g)).toBe(1);
    expect(count(text, /Here's how/g)).toBe(1);
    expect(text).toContain('Creating bottlenecks in productivity.');
  });
  it('traditional take: stuck "traditional" / "Figma" excised, rest of the sentence kept; "Now the solution" fragment dropped', () => {
    expect(text).toContain('highlighted how design tools weren\'t built for collaborative efforts.');
    expect(text).not.toMatch(/\btraditional\b/);
    expect(text).not.toMatch(/\bNow\b/);
  });
});

describe('stuck-word handling', () => {
  const w = (text: string, start: number, dur = 0.3): WordToken => ({text, start, end: start + dur});
  const sentence = (texts: string[], start: number, stuckAt = -1, stuckDur = 3): WordToken[] => {
    let t = start;
    return texts.map((text, index) => {
      const word = w(text, t, index === stuckAt ? stuckDur : 0.3);
      t = word.end + 0.05;
      return word;
    });
  };
  const A = 'Our team shipped the redesigned dashboard to every customer this week.'.split(' ');
  const B = 'Our team shipped the redesigned dashboard to every customer today.'.split(' ');
  const filler = 'Then we measured adoption carefully across several regions overnight.'.split(' ');
  const build = (stuckAt: number, altStuck = -1) => {
    const first = sentence(filler, 0);
    const alt = sentence(B, first[first.length - 1]!.end + 1, altStuck);
    const take = sentence(A, alt[alt.length - 1]!.end + 1, stuckAt);
    const last = sentence('Customers loved the faster loading and the cleaner layout.'.split(' '), take[take.length - 1]!.end + 1);
    const words = [...first, ...alt, ...take, ...last];
    const duration = last[last.length - 1]!.end + 0.5;
    return {words, duration, alt, take, first, last};
  };
  const planFor = (set: ReturnType<typeof build>) =>
    apply({keep: [range(set.first[0]!.start, set.first.at(-1)!.end), range(set.take[0]!.start, set.take.at(-1)!.end), range(set.last[0]!.start, set.last.at(-1)!.end)]}, set.words, set.duration);
  const textOf = (set: ReturnType<typeof build>, result: ReturnType<typeof apply>) => (result.ok ? captionWords(result.exclusions, set.words, set.duration).map(word => word.text).join(' ') : '');

  it('swaps to a fluent alternate take of the same idea', () => {
    const set = build(3);
    const result = planFor(set);
    expect(result.ok).toBe(true);
    const text = textOf(set, result);
    expect(text).toContain('Our team shipped the redesigned dashboard to every customer today.');
    expect(text).not.toContain('this week');
  });
  it('no fluent alternate: a stuck verb mid-sentence drops the whole take (shorter video wins)', () => {
    const set = build(2, 2);
    const result = planFor(set);
    expect(result.ok).toBe(true);
    expect(textOf(set, result)).not.toMatch(/redesigned dashboard/);
  });
  it('no fluent alternate: a stuck non-verb token is cut out and the sentence joins', () => {
    const set = build(5, 5);
    const result = planFor(set);
    expect(result.ok).toBe(true);
    const text = textOf(set, result);
    expect(text).toContain('Our team shipped the redesigned to every customer this week.');
    expect(text).not.toContain('dashboard');
  });
  it('a take under the limit is left alone', () => {
    const set = build(-1);
    const result = planFor(set);
    expect(result.ok && result.scrub.stuck).toBe(0);
  });
});

describe('same-line restarts and backchannels', () => {
  const seq = (texts: string[], start = 0, gap = 0.05): WordToken[] => {
    let t = start;
    return texts.map(text => {
      const word = {text, start: t, end: t + 0.3};
      t += 0.3 + gap;
      return word;
    });
  };
  const tail = (from: number) => seq('Teams ship faster when reviews stay small and focused every single day.'.split(' '), from);
  it('abandoned prefix before an immediate restart is dropped, the fluent completion stays', () => {
    const head = seq("Here's how their".split(' '));
    const rest = seq("Here's how their pitch deck brought the vision to fruition.".split(' '), head.at(-1)!.end + 0.3);
    const words = [...head, ...rest, ...tail(rest.at(-1)!.end + 1)];
    const duration = words.at(-1)!.end + 0.5;
    const result = apply({keep: [range(0, duration)]}, words, duration);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scrub.restart).toBeGreaterThanOrEqual(1);
    const text = captionWords(result.exclusions, words, duration).map(word => word.text).join(' ');
    expect(count(text, /Here's how/g)).toBe(1);
    expect(text).toContain("Here's how their pitch deck brought the vision to fruition.");
  });
  it('legit repeated words far apart are not restarts', () => {
    const words = seq('We tested the design and then we tested the build again before shipping it widely.'.split(' '));
    const result = apply({keep: [range(0, words.at(-1)!.end)]}, words, words.at(-1)!.end + 0.5);
    expect(result.ok && result.scrub.restart).toBe(0);
  });
  it('strips mm-hmm and a standalone ok, keeps "okay" inside a sentence', () => {
    const a = seq('Layouts should stay simple and readable for everyone.'.split(' '));
    const mm = seq(['Mm-hmm'], a.at(-1)!.end + 0.5);
    const ok = seq(['Ok'], mm[0]!.end + 0.5);
    const b = seq("It is okay to cut scope when the deadline is close.".split(' '), ok[0]!.end + 0.5);
    const words = [...a, ...mm, ...ok, ...b];
    const duration = words.at(-1)!.end + 0.5;
    const result = apply({keep: [range(0, duration)]}, words, duration);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = captionWords(result.exclusions, words, duration).map(word => word.text).join(' ');
    expect(text).not.toMatch(/Mm-hmm|\bOk\b/);
    expect(text).toContain('It is okay to cut scope');
  });
  it('a 0.4 s yeah between kept words is covered edge to edge (no guard left on either side)', () => {
    const a = seq('The first release focused on stability and speed.'.split(' '));
    const yeah: WordToken = {text: 'yeah', start: a.at(-1)!.end + 0.1, end: a.at(-1)!.end + 0.5};
    const b = seq('The second release added collaboration to every plan.'.split(' '), yeah.end + 0.1);
    const words = [...a, yeah, ...b];
    const duration = words.at(-1)!.end + 0.5;
    const result = apply({keep: [range(0, duration)]}, words, duration);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scrub.yeah).toBe(1);
    const cut = result.exclusions.find(e => e.start <= yeah.start && e.end >= yeah.end);
    expect(cut).toBeTruthy();
    expect(cut!.start).toBeLessThanOrEqual(a.at(-1)!.end + 0.001);
    expect(cut!.end).toBeGreaterThanOrEqual(b[0]!.start - 0.001);
  });
  it('a normal cut between two kept runs still snaps within ~20 ms of the kept words', () => {
    const a = seq('Alpha beta gamma delta epsilon zeta.'.split(' '));
    const junk = seq('Totally unrelated dropped sentence here.'.split(' '), a.at(-1)!.end + 0.5);
    const b = seq('Omega sigma tau upsilon phi chi.'.split(' '), junk.at(-1)!.end + 0.5);
    const words = [...a, ...junk, ...b];
    const duration = words.at(-1)!.end + 0.5;
    const result = apply({keep: [range(a[0]!.start, a.at(-1)!.end), range(b[0]!.start, b.at(-1)!.end)]}, words, duration);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cut = result.exclusions.find(e => e.start > a.at(-1)!.end - 0.001 && e.end < b[0]!.start + 0.001)!;
    expect(cut.start - a.at(-1)!.end).toBeLessThanOrEqual(0.0251);
    expect(b[0]!.start - cut.end).toBeLessThanOrEqual(0.0251);
  });
});

describe('prompt', () => {
  const segments = buildKeepPlanSegments(live.words);
  const prompt = buildKeepPlanPrompt(segments, DURATION).user;
  it('flags long words on their segments', () => {
    expect(segments.find(s => s.text.startsWith('Figma raised tens of millions'))?.longWords).toEqual(['raised(3.18s)']);
    expect(prompt).toMatch(/\[\d+\] 39\.8-49\.42 Figma raised tens .*LONG: raised\(3\.18s\)/);
    expect(prompt).not.toMatch(/\[\d+\] 20\.22-25\.1 .*LONG:/);
  });
  it('states smoothness, stuck-word, restart and shorter-fluent rules; no 40-85% bias', () => {
    expect(prompt).toContain('SMOOTHNESS FIRST');
    expect(prompt).toContain('stuck');
    expect(prompt).toContain('NOT emphasis');
    expect(prompt).toContain('even if it is shorter');
    expect(prompt).toContain('SAME-LINE RESTART');
    expect(prompt).toContain('keep only the fluent completion');
    expect(prompt).not.toMatch(/40-85|40–85/);
  });
});

describe('source pins', () => {
  it('analyzeVideo warns with stuck and restart counts', () => {
    const source = readFileSync(resolve(HERE, '../../pipeline/analyzeVideo.ts'), 'utf8');
    expect(source).toContain('dupe=${applied.scrub.dupe},stuck=${applied.scrub.stuck},restart=${applied.scrub.restart}');
  });
});
