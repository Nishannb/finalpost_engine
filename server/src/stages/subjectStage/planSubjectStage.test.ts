/**
 * SUBJECT STAGE Phase 3: the transcript -> stage planner. Pure: no render, no model, no network. Every fixture is validated against the HARD rules; the shares are a soft target.
 * Golden plans: planSubjectStage.golden.json (FIXTURE_ALERT, FIXTURE_EXPLAINER, FIXTURE_LONG).
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {subjectStageSchema} from '../../../../remotion/src/blueprintSchema.ts';
import {hasContent, planSubjectStage, toSubjectStageBlueprint, validateSubjectStagePlan, type PlanSubjectStageInput, type SubjectStagePlan} from './planSubjectStage.ts';
import {S5_MAX_DURATION_SEC} from './stageMotion.ts';
import {SUBJECT_STAGE_PLANNER, SUBJECT_STAGE_RHYTHM, SUBJECT_STAGE_SHARES, type StageId} from './subjectStageConfig.ts';
import {FIXTURE_ALERT, FIXTURE_EXPLAINER, FIXTURE_LONG, build} from './subjectStageFixtures.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES: Array<[string, PlanSubjectStageInput]> = [
  ['alert', FIXTURE_ALERT],
  ['explainer', FIXTURE_EXPLAINER],
  ['long', FIXTURE_LONG],
];
const HEAVY = new Set<StageId>(['S1', 'S2', 'S3', 'S5']);
const transcriptOf = (input: PlanSubjectStageInput) => input.sentences.map(s => s.text).join(' ').toLowerCase();

describe.each(FIXTURES)('hard rules on the %s fixture', (_name, fixture) => {
  const plan = planSubjectStage(fixture);
  const D = fixture.durationSec;

  it('is a valid plan (validateSubjectStagePlan finds nothing) and raises no invariant warning', () => {
    expect(plan.spans.length).toBeGreaterThan(3);
    expect(validateSubjectStagePlan(plan, D)).toEqual([]);
    expect(plan.warnings.filter(w => w.includes(':invariant:'))).toEqual([]);
  });

  it('tiles the runtime: starts at 0, ends at the duration, no gap, no overlap', () => {
    expect(plan.spans[0]!.start).toBe(0);
    expect(plan.spans[plan.spans.length - 1]!.end).toBeCloseTo(D, 6);
    for (let i = 1; i < plan.spans.length; i += 1) expect(plan.spans[i]!.start).toBeCloseTo(plan.spans[i - 1]!.end, 6);
  });

  it('never the same stage twice in a row', () => {
    for (let i = 1; i < plan.spans.length; i += 1) expect(plan.spans[i]!.stage, `span ${i}`).not.toBe(plan.spans[i - 1]!.stage);
  });

  it('at most 2 asset-heavy stages in a row, then S4', () => {
    let run = 0;
    for (const span of plan.spans) {
      run = HEAVY.has(span.stage) ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(SUBJECT_STAGE_RHYTHM.maxHeavyInARow);
    }
    // and the run is always broken by an S4 (the only non-heavy stage)
    expect(plan.spans.some(s => s.stage === 'S4')).toBe(true);
  });

  it('every stage is >= 1.4 s; nearly all sit in the preferred 3-7 s; none runs away', () => {
    const lens = plan.spans.map(s => s.end - s.start);
    for (const len of lens) expect(len).toBeGreaterThanOrEqual(SUBJECT_STAGE_RHYTHM.minStageSec - 1e-6);
    const preferred = lens.filter(l => l >= 3 - 1e-6 && l <= 7 + 1e-6).length;
    expect(preferred / lens.length).toBeGreaterThanOrEqual(0.7);
    expect(Math.max(...lens)).toBeLessThanOrEqual(9);
  });

  it('cuts fall on sentence starts (the first stage on 0, the rest on a sentence boundary or a capped-S5 remainder)', () => {
    const starts = new Set([0, ...fixture.sentences.map(s => s.start)]);
    plan.spans.forEach((span, i) => {
      if (i === 0) return;
      const onSentence = [...starts].some(t => Math.abs(t - span.start) < 1e-3);
      const afterS5 = plan.spans[i - 1]!.stage === 'S5';
      expect(onSentence || afterS5, `span ${i} at ${span.start}`).toBe(true);
    });
  });

  it('S5: at most once, capped, only for an official / final unit, with a slide-up enter; nothing else slides up', () => {
    const s5 = plan.spans.filter(s => s.stage === 'S5');
    expect(s5.length).toBeLessThanOrEqual(1);
    for (const span of s5) {
      expect(span.end - span.start).toBeLessThanOrEqual(S5_MAX_DURATION_SEC + 1e-6);
      expect(span.end - span.start).toBeGreaterThanOrEqual(1.8 - 1e-6);
      expect(span.enter).toBe('slide_up_front');
      expect(span.motion.kind).toBe('slide_up_front');
      const unit = plan.debug.units.find(u => span.start >= u.start - 1e-3 && span.start < u.end);
      expect(unit?.intent).toBe('official_or_final');
    }
    expect(plan.spans.filter(s => s.enter === 'slide_up_front' && s.stage !== 'S5')).toEqual([]);
  });

  it('transitions: the first stage is a hard cut; a flash only lands on S1 / S3 and never closer than the strobe guard', () => {
    expect(plan.spans[0]!.enter).toBe('hard_cut');
    const flashes = plan.spans.filter(s => s.enter === 'flash_cut');
    for (const f of flashes) expect(['S1', 'S3']).toContain(f.stage);
    for (let i = 1; i < flashes.length; i += 1) expect(flashes[i]!.start - flashes[i - 1]!.start).toBeGreaterThanOrEqual(SUBJECT_STAGE_PLANNER.flashMinGapSec - 1e-6);
  });

  it('per-stage payloads match the grammar (S1 plate, S2 slow_push + card, S3 ghost 0.5 auto_scroll, S4 bare, S5 slide)', () => {
    for (const span of plan.spans) {
      if (span.stage === 'S1') expect(span.motion.kind).toBe('none');
      if (span.stage === 'S2') {
        expect(span.motion).toMatchObject({kind: 'slow_push', scalePct: 5});
        expect(span.placement).toMatchObject({xPct: 51, wPct: 58});
      }
      if (span.stage === 'S3') expect(span).toMatchObject({opacity: 0.5, wash: 'warm', motion: {kind: 'auto_scroll', pctPerSec: 18}});
      if (span.stage === 'S4') expect(span.asset).toBeUndefined();
    }
  });

  it('nothing is invented: every quote card, result row and accent line is an exact spoken fragment', () => {
    const text = transcriptOf(fixture).replace(/["“”]/g, '');
    const spoken = (frag: string) => text.includes(frag.replace(/…$/, '').replace(/["“”]/g, '').toLowerCase().trim());
    for (const span of plan.spans) {
      if (span.asset?.text) expect(spoken(span.asset.text), span.asset.text).toBe(true);
      for (const row of span.asset?.lines ?? []) expect(spoken(row), row).toBe(true);
    }
    for (const accent of plan.accents) for (const line of accent.lines ?? []) expect(spoken(line), line).toBe(true);
  });

  it('the payload parses with the blueprint zod schema', () => {
    const payload = toSubjectStageBlueprint(plan, 'https://cdn.example/matte.webm');
    const parsed = subjectStageSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(payload.styleId).toBe('subject_stage');
  });

  it('is deterministic (same input -> identical plan, also when the sentences arrive shuffled)', () => {
    const a = JSON.stringify(planSubjectStage(fixture));
    expect(JSON.stringify(planSubjectStage(fixture))).toBe(a);
    const shuffled = {...fixture, sentences: [...fixture.sentences].reverse()};
    expect(JSON.stringify(planSubjectStage(shuffled))).toBe(a);
  });
});

describe('share targets (soft): the long fixture lands within +-8 pts of every stage target', () => {
  const plan = planSubjectStage(FIXTURE_LONG);
  it.each(Object.keys(SUBJECT_STAGE_SHARES) as StageId[])('%s', stage => {
    expect(Math.abs(plan.shares[stage] - SUBJECT_STAGE_SHARES[stage])).toBeLessThanOrEqual(0.08);
  });
  it('shares add up to the whole runtime', () => {
    expect(Object.values(plan.shares).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
  });
});

describe('intent -> stage selection', () => {
  // each unit is a single ~4 s sentence; the order avoids every forced override
  const seq = build([
    ['Imagine a small town where the story started last year.', 4],
    ['The term is called phishing and it basically means fraud.', 4],
    ['She said "please send relief money to this account".', 4],
    ['The term is called indemnity and it basically means cover.', 4],
    ['I searched for it and the results were everywhere.', 4],
    ['Yes.', 2],
    ['The official announcement from the ministry is final.', 4.5],
  ]);
  const plan = planSubjectStage(seq);
  it('context -> S1, key terms -> S4, citation -> S2, search -> S3, verdict -> S4, official -> S5 (+ the S4 remainder)', () => {
    expect(plan.debug.units.map(u => u.intent)).toEqual(['context_or_setting', 'explanation_key_terms', 'quoting_or_citing', 'explanation_key_terms', 'search_or_many_sources', 'confirmation_or_verdict', 'official_or_final']);
    expect(plan.spans.map(s => s.stage)).toEqual(['S1', 'S4', 'S2', 'S4', 'S3', 'S4', 'S5', 'S4']);
    expect(plan.warnings.filter(w => w.includes('overridden'))).toEqual([]);
    expect(validateSubjectStagePlan(plan, seq.durationSec)).toEqual([]);
  });
  it('the capped S5 leaves its remainder as an S4 of at least 1.4 s', () => {
    const last = plan.spans[plan.spans.length - 1]!;
    expect(last.stage).toBe('S4');
    expect(last.end - last.start).toBeGreaterThanOrEqual(1.4 - 1e-6);
  });
  it('a confirmation is a single accent with the spoken verdict word', () => {
    const verdict = plan.accents.find(a => a.start >= plan.spans[5]!.start && a.end <= plan.spans[5]!.end);
    expect(plan.spans[5]!.stage).toBe('S4');
    // "Yes." is 2 s: too short for an accent that needs 1 s of life after the keyword -> dropped or one pop_in with the word, never more
    const inside = plan.accents.filter(a => a.start >= plan.spans[5]!.start && a.end <= plan.spans[5]!.end);
    expect(inside.length).toBeLessThanOrEqual(1);
    if (verdict) expect(verdict.lines).toEqual(['Yes']);
  });
  it('official goes to S1 when S5 is not allowed (too early / too short)', () => {
    const early = planSubjectStage(build([['The official announcement from the ministry is final.', 4], ['The term is called phishing and it basically means fraud.', 4]], 0));
    expect(early.spans.some(s => s.stage === 'S5')).toBe(false);
    expect(early.spans[0]!.stage).toBe('S1');
    const noOfficial = planSubjectStage(FIXTURE_EXPLAINER.sentences.length ? {...FIXTURE_LONG, sentences: FIXTURE_LONG.sentences.filter(s => !/official/i.test(s.text))} : FIXTURE_LONG);
    expect(noOfficial.spans.some(s => s.stage === 'S5')).toBe(false);
  });
  it('S5 at most once even with several official units', () => {
    const many = planSubjectStage(
      build([
        ['Imagine a small town where the story started last year.', 5],
        ['The official announcement from the ministry is final.', 5],
        ['The term is called phishing and it basically means fraud.', 4],
        ['The official decision from the authority is the final ruling.', 5],
        ['The term is called indemnity and it basically means cover.', 4],
        ['The official statement from the government is final.', 5],
      ]),
    );
    expect(many.spans.filter(s => s.stage === 'S5').length).toBe(1);
    expect(validateSubjectStagePlan(many, many.spans[many.spans.length - 1]!.end)).toEqual([]);
  });
});

describe('the hard rules hold under pressure', () => {
  it('eight identical-intent sentences still alternate stages (never the same twice, heavy runs broken by S4)', () => {
    const rows = Array.from({length: 8}, (_, i): [string, number] => [`Imagine scene number ${i + 1} where the story started last year.`, 4.2]);
    const input = build(rows);
    const plan = planSubjectStage(input);
    expect(validateSubjectStagePlan(plan, input.durationSec)).toEqual([]);
    expect(plan.warnings.some(w => w.includes('intent_overridden'))).toBe(true);
    expect(new Set(plan.spans.map(s => s.stage)).size).toBeGreaterThanOrEqual(2);
  });
  it('a sentence longer than 7 s is split into stages of the preferred length (reported), still valid', () => {
    const input = build([['Imagine a small town where the story started last year and kept going for a very long time without any pause at all.', 20], ['The term is called phishing and it basically means fraud.', 4]]);
    const plan = planSubjectStage(input);
    expect(plan.warnings.some(w => w.startsWith('subject_stage:long_sentence_split'))).toBe(true);
    expect(validateSubjectStagePlan(plan, input.durationSec)).toEqual([]);
    for (const span of plan.spans) expect(span.end - span.start).toBeLessThanOrEqual(8.5);
  });
  it('a tiny tail never becomes its own stage', () => {
    const input = build([['Imagine a small town where the story started last year.', 5], ['The term is called phishing and it basically means fraud.', 5], ['Ok.', 0.3]], 0);
    const plan = planSubjectStage({...input, durationSec: input.durationSec - 0.6});
    for (const span of plan.spans) expect(span.end - span.start).toBeGreaterThanOrEqual(1.4 - 1e-6);
  });
  it('degenerate inputs plan nothing and say why', () => {
    expect(planSubjectStage({sentences: [], durationSec: 30}).warnings).toContain('subject_stage:skipped:no_speech');
    expect(planSubjectStage({sentences: [{start: 0, end: 1, text: 'Hi.'}], durationSec: 2}).warnings).toContain('subject_stage:skipped:too_short');
    expect(planSubjectStage({sentences: [{start: 0, end: 1, text: 'Hi.'}], durationSec: 2}).spans).toEqual([]);
  });
});

describe('transitions', () => {
  const rows: Array<[string, number, number?]> = [
    ['Imagine a small town where the story started last year.', 5],
    ['The term is called phishing and it basically means fraud.', 4],
    ['So I searched for it and the results were everywhere.', 5.5],
    ['The term is called indemnity and it basically means cover.', 4],
    ['Back in 2019 the situation was very different.', 5.5, 0.2],
    ['The term is called phishing and it basically means fraud.', 4],
    ['Another idea: the story started when a clerk found the file.', 5.5],
  ];
  it('a topic jump into S1 / S3 flashes (marker "So", explicit breaks, long pauses); a plain boundary hard-cuts', () => {
    const input = build(rows);
    const plan = planSubjectStage(input);
    const s3 = plan.spans.find(s => s.stage === 'S3');
    expect(s3?.enter).toBe('flash_cut'); // "So I searched ..." is a topic marker
    const plain = planSubjectStage(build(rows.map(r => [r[0].replace(/^So /, 'And '), r[1], r[2]] as [string, number, number?])));
    expect(plain.spans.find(s => s.stage === 'S3')?.enter).toBe('hard_cut');
    // an explicit break lands the flash even without a marker
    const broken = planSubjectStage({...build(rows.map(r => [r[0].replace(/^So /, 'And '), r[1], r[2]] as [string, number, number?])), topicBreaks: [plain.spans.find(s => s.stage === 'S3')!.start]});
    expect(broken.spans.find(s => s.stage === 'S3')?.enter).toBe('flash_cut');
  });
  it('S2 / S4 never flash, whatever the topic', () => {
    const plan = planSubjectStage({...build(rows), topicBreaks: [5, 9, 14.5, 18.5, 24, 28]});
    for (const span of plan.spans) if (span.stage === 'S2' || span.stage === 'S4') expect(span.enter).not.toBe('flash_cut');
  });
});

describe('accents: spoken keywords, <= 1 hit per second, stack + slot continuity', () => {
  const dense = build(
    [
      ['Imagine a small town where the story started last year.', 5],
      ['The term is called compounding and it basically means growth for 100 users in 2020 and 50 percent more.', 6],
      ['She said "please send relief money to this account".', 5],
      ['The OTP and the PIN and the password are called secrets and they basically mean access for 100 users.', 6],
    ],
    0,
  );
  it('a keyword-rich S4 builds ONE text_stack in the top-centre slot, lines appended on later keywords, <= 4 lines', () => {
    // real word timings (>= 1 s apart) for four spoken terms of the first explanation sentence (the S4 stage is [5.25, 11.5))
    const keywords = [{at: 6.6, text: 'compounding'}, {at: 7.8, text: 'growth'}, {at: 9.0, text: '100 users'}, {at: 10.2, text: '2020'}];
    const plan = planSubjectStage({...dense, keywords});
    const stacks = plan.accents.filter(a => a.kind === 'text_stack');
    expect(stacks.length).toBeGreaterThanOrEqual(1);
    for (const stack of stacks) {
      expect(stack.slot).toBe(2);
      expect(stack.lines!.length).toBeLessThanOrEqual(4);
      expect(stack.lines!.length).toBeGreaterThanOrEqual(3);
      expect(stack.lineStarts![0]).toBe(0);
      expect([...stack.lineStarts!].sort((a, b) => a - b)).toEqual(stack.lineStarts);
      expect(stack.lineStarts!.length).toBe(stack.lines!.length);
      expect(stack.end - stack.start).toBeGreaterThanOrEqual(SUBJECT_STAGE_PLANNER.stackMinSec - 1e-6);
    }
    // the keywords come later than the stage opens, so the stack opens on the first content word SPOKEN at the start; the keywords follow >= 1 s apart (the 4th is cut: at most 4 lines)
    expect(stacks[0]!.lines![0]).toBe('term');
    expect(stacks[0]!.lines!.slice(1)).toEqual(['compounding', 'growth', '100 users']);
    expect(stacks[0]!.lineStarts).toEqual([0, 1.35, 2.55, 3.75]);
    expect(validateSubjectStagePlan(plan, dense.durationSec)).toEqual([]);
  });
  it('supplied keywords are throttled to one per second (a stream every 0.3 s collapses)', () => {
    const keywords = Array.from({length: 120}, (_, i) => ({at: 0.3 * i, text: `Term${i}`}));
    const input = {...FIXTURE_ALERT, keywords};
    const plan = planSubjectStage(input);
    const hits: number[] = [];
    for (const a of plan.accents) {
      if (a.kind === 'text_stack') for (const t of a.lineStarts ?? []) hits.push(a.start + t);
      else hits.push(a.start);
    }
    hits.sort((x, y) => x - y);
    expect(hits.length).toBeGreaterThan(0);
    for (let i = 1; i < hits.length; i += 1) expect(hits[i]! - hits[i - 1]!).toBeGreaterThanOrEqual(1 - 1e-3);
    expect(validateSubjectStagePlan(plan, input.durationSec)).toEqual([]);
  });
  it('single accents keep one slot (continuity) and alternate pop_in / drop_in_tilt; each opens WITH its stage and lives to its end (the stage is never bare); none overlap', () => {
    const plan = planSubjectStage(FIXTURE_LONG);
    const singles = plan.accents.filter(a => a.kind !== 'text_stack');
    expect(singles.length).toBeGreaterThan(2);
    expect(new Set(singles.map(a => a.slot))).toEqual(new Set([0]));
    singles.forEach((a, i) => expect(a.kind).toBe(i % 2 === 0 ? 'pop_in' : 'drop_in_tilt'));
    for (const a of singles) {
      const host = plan.spans.find(s => a.start >= s.start - 1e-6 && a.end <= s.end + 1e-6)!;
      expect(a.start).toBeCloseTo(host.start, 2);
      expect(a.end).toBeCloseTo(host.end - 0.1, 2);
      expect(a.end - a.start).toBeGreaterThanOrEqual(1 - 1e-6);
    }
    for (let i = 1; i < plan.accents.length; i += 1) expect(plan.accents[i]!.start).toBeGreaterThanOrEqual(plan.accents[i - 1]!.end - 1e-6);
  });
  it('accents only live inside S4 stages, never in an asset-heavy stage', () => {
    for (const [, fixture] of FIXTURES) {
      const plan = planSubjectStage(fixture);
      for (const a of plan.accents) expect(plan.spans.find(s => a.start >= s.start - 1e-6 && a.end <= s.end + 1e-6)?.stage).toBe('S4');
    }
  });
});

describe('the behind layer is never visually empty (> 0.5 s is illegal)', () => {
  const GAP = SUBJECT_STAGE_PLANNER.behindGapMaxSec;
  it('the gap limit is 0.5 s', () => {
    expect(GAP).toBe(0.5);
  });
  it.each(FIXTURES)('%s: no visible-content gap > 0.5 s anywhere (opening and end included), the first stage opens at t = 0 and is contentful', (_n, fixture) => {
    const plan = planSubjectStage(fixture);
    expect(validateSubjectStagePlan(plan, fixture.durationSec).filter(p => p.startsWith('behind_gap') || p === 'opening_latency')).toEqual([]);
    expect(plan.spans[0]!.start).toBe(0);
    expect(plan.spans[0]!.stage).not.toBe('S4');
    expect(hasContent(plan.spans[0]!.asset)).toBe(true);
    // independent re-measure: sweep the runtime in 50 ms steps and find the longest stretch with nothing visible
    const visibleAt = (t: number) =>
      plan.spans.some(s => t >= s.start && t < s.end && (s.stage === 'S5' || (s.stage !== 'S4' && hasContent(s.asset)))) || plan.accents.some(a => t >= a.start && t < a.end);
    let run = 0;
    let longest = 0;
    for (let t = 0; t < fixture.durationSec; t += 0.05) {
      run = visibleAt(t) ? 0 : run + 0.05;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(GAP + 0.06);
  });
  it('S1 always carries the spoken text: a headline (an exact fragment) and, when the unit has a second sentence, a subline', () => {
    for (const [, fixture] of FIXTURES) {
      const plan = planSubjectStage(fixture);
      const text = fixture.sentences.map(s => s.text).join(' ').toLowerCase();
      const plates = plan.spans.filter(s => s.stage === 'S1');
      expect(plates.length).toBeGreaterThan(0);
      for (const s of plates) {
        expect(s.asset?.nativeKind).toBe('plate');
        expect(s.asset?.text?.trim().length).toBeGreaterThan(0);
        expect(text).toContain(s.asset!.text!.replace(/\u2026$/, '').toLowerCase());
        for (const l of s.asset?.lines ?? []) expect(text).toContain(l.replace(/\u2026$/, '').toLowerCase());
        expect(s.asset!.text!.length).toBeLessThanOrEqual(SUBJECT_STAGE_PLANNER.plateHeadlineMax + 1);
      }
    }
  });
  it('a one-word opener ("Yes.") is not the plate headline', () => {
    const input = build([['Yes.', 1.6], ['Imagine a small town where the story started last year.', 4], ['The term is called phishing and it basically means fraud.', 4]]);
    const plan = planSubjectStage(input);
    const s1 = plan.spans.find(s => s.stage === 'S1')!;
    expect(s1.asset!.text).toMatch(/^Imagine/);
  });
  it('the opening is never a bare S4, even when the first sentence is a key-terms sentence', () => {
    const input = build([['The term is called phishing and it basically means fraud.', 4.5], ['Imagine a small town where the story started last year.', 4.5], ['The term is called indemnity and it basically means cover.', 4.5]], 0);
    const plan = planSubjectStage(input);
    expect(plan.spans[0]!.stage).not.toBe('S4');
    expect(validateSubjectStagePlan(plan, input.durationSec)).toEqual([]);
  });
  it('every S4 stage opens with an accent at its first frame and keeps one on screen to within 0.1 s of its end', () => {
    for (const [, fixture] of FIXTURES) {
      const plan = planSubjectStage(fixture);
      for (const s of plan.spans.filter(x => x.stage === 'S4')) {
        const inside = plan.accents.filter(a => a.start >= s.start - 1e-6 && a.end <= s.end + 1e-6);
        expect(inside.length, `S4 ${s.start}`).toBeGreaterThan(0);
        expect(Math.min(...inside.map(a => a.start))).toBeCloseTo(s.start, 2);
        expect(Math.max(...inside.map(a => a.end))).toBeGreaterThanOrEqual(s.end - 0.1 - 1e-6);
      }
    }
  });
  describe('validateSubjectStagePlan flags every illegal gap (hand-built plans)', () => {
    const plate = (start: number, end: number, text = 'Headline') => ({start, end, stage: 'S1' as const, enter: 'hard_cut' as const, motion: {kind: 'none' as const}, asset: {kind: 'native' as const, nativeKind: 'plate' as const, ...(text ? {text} : {})}});
    const bare = (start: number, end: number) => ({start, end, stage: 'S4' as const, enter: 'hard_cut' as const, motion: {kind: 'none' as const}});
    const card = (start: number, end: number) => ({start, end, stage: 'S2' as const, enter: 'hard_cut' as const, motion: {kind: 'slow_push' as const}, asset: {kind: 'native' as const, nativeKind: 'quote_card' as const, text: 'A quoted line.'}});
    it('a blank S1 plate is EMPTY: s1_without_text + a 4 s gap + opening latency (the proof bug)', () => {
      const problems = validateSubjectStagePlan({spans: [plate(0, 4, ''), card(4, 8)], accents: []}, 8);
      expect(problems).toContain('s1_without_text:0');
      expect(problems.some(p => p.startsWith('behind_gap:0-4'))).toBe(true);
      expect(problems).toContain('opening_latency');
    });
    it('a bare S4 longer than 0.5 s is a gap; with an accent covering it, it is fine', () => {
      const withBare = validateSubjectStagePlan({spans: [plate(0, 3), bare(3, 6), card(6, 9)], accents: []}, 9);
      expect(withBare).toContain('behind_gap:3-6');
      const covered = validateSubjectStagePlan({spans: [plate(0, 3), bare(3, 6), card(6, 9)], accents: [{start: 3, end: 5.9, kind: 'pop_in', lines: ['Term'], slot: 0}]}, 9);
      expect(covered.filter(p => p.startsWith('behind_gap'))).toEqual([]);
    });
    it('a gap of exactly 0.5 s is legal, 0.6 s is not', () => {
      expect(validateSubjectStagePlan({spans: [plate(0, 3), bare(3, 7), card(7, 10)], accents: [{start: 3.5, end: 6.9, kind: 'pop_in', lines: ['Term'], slot: 0}]}, 10).filter(p => p.startsWith('behind_gap'))).toEqual([]);
      expect(validateSubjectStagePlan({spans: [plate(0, 3), bare(3, 7), card(7, 10)], accents: [{start: 3.6, end: 6.9, kind: 'pop_in', lines: ['Term'], slot: 0}]}, 10).filter(p => p.startsWith('behind_gap'))).toEqual(['behind_gap:3-3.6']);
    });
    it('a tail gap counts too, and a start of 0.4 s is allowed (<= 0.5)', () => {
      expect(validateSubjectStagePlan({spans: [plate(0, 3), card(3, 6), bare(6, 9)], accents: []}, 9)).toContain('behind_gap:6-9');
      expect(validateSubjectStagePlan({spans: [bare(0, 3), card(3, 6)], accents: [{start: 0.4, end: 2.9, kind: 'pop_in', lines: ['T'], slot: 0}]}, 6).filter(p => p.startsWith('behind_gap') || p === 'opening_latency')).toEqual([]);
    });
  });
});

describe('asset hints (stub): user assets are handed out first, native generation fills the rest', () => {
  it('a hint for S2 is used for the first S2; an unhinted asset goes to the first heavy stage; the rest are native', () => {
    const plan = planSubjectStage({...FIXTURE_ALERT, assets: [{kind: 'image', url: 'https://cdn.example/card.jpg', stage: 'S2'}, {kind: 'video', url: 'https://cdn.example/b.mp4'}]});
    const s2 = plan.spans.filter(s => s.stage === 'S2');
    expect(s2[0]!.asset).toEqual({kind: 'image', url: 'https://cdn.example/card.jpg'});
    const first = plan.spans.find(s => s.stage !== 'S4' && s.asset?.url === 'https://cdn.example/b.mp4');
    expect(first).toBeDefined();
    for (const span of plan.spans) if (span.stage !== 'S4' && span.asset && !span.asset.url) expect(span.asset.kind).toBe('native');
    expect(plan.spans.filter(s => s.asset?.url).length).toBe(2);
  });
  it('no assets -> every asset-heavy stage is native (plate / quote_card / result_page); never a fetch', () => {
    const plan = planSubjectStage(FIXTURE_ALERT);
    for (const span of plan.spans) {
      if (span.stage === 'S4') continue;
      expect(span.asset?.kind).toBe('native');
      if (span.stage === 'S1') expect(span.asset?.nativeKind).toBe('plate');
      if (span.stage === 'S2' || span.stage === 'S5') expect(span.asset?.nativeKind).toBe('quote_card');
      if (span.stage === 'S3') expect(span.asset?.nativeKind).toBe('result_page');
    }
  });
});

describe('scope + purity', () => {
  const src = readFileSync(join(here, 'planSubjectStage.ts'), 'utf8');
  it('no model, network, env or file access in the planner', () => {
    for (const banned of ['fetch(', 'process.env', "from 'node:", 'gemini', 'anthropic', 'claude', 'axios']) expect(src.toLowerCase()).not.toContain(banned.toLowerCase());
    expect(src).not.toMatch(/from '\.\.\/\.\.\/config\/env/);
  });
  it('analyzeVideo reaches the planner only through the Phase 4 stage (subjectStageStage.ts), never directly', () => {
    const analyze = readFileSync(join(here, '../../pipeline/analyzeVideo.ts'), 'utf8');
    expect(analyze).not.toMatch(/planSubjectStage\(/);
    expect(analyze).toContain("from './subjectStageStage.ts'");
    expect(readFileSync(join(here, '../../pipeline/subjectStageStage.ts'), 'utf8')).toContain('planSubjectStage(');
  });
});

// ------------------------------------------------------------------------------------------------ golden plans
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const signature = (plan: SubjectStagePlan) => ({
  spans: plan.spans.map(s => [s.stage, r3(s.start), r3(s.end), s.enter, s.motion.kind, s.asset?.nativeKind ?? s.asset?.kind ?? null, s.asset?.text ?? null, s.asset?.lines ?? null]),
  accents: plan.accents.map(a => [a.kind, r3(a.start), r3(a.end), a.lines ?? null, a.lineStarts ?? null, a.slot]),
  shares: plan.shares,
  warnings: plan.warnings,
});
describe('golden plans', () => {
  const golden = JSON.parse(readFileSync(join(here, 'planSubjectStage.golden.json'), 'utf8')) as Record<string, ReturnType<typeof signature>>;
  it.each(FIXTURES)('%s fixture matches planSubjectStage.golden.json', (name, fixture) => {
    expect(signature(planSubjectStage(fixture))).toEqual(golden[name]);
  });
});
