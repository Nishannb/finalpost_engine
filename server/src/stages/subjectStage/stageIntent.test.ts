/**
 * SUBJECT STAGE Phase 3: the deterministic lexical intent classifier + keyword helpers. Pure; no model, no network.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

import {INTENT_PRIORITY, INTENT_STAGES, classifyIntent, deriveKeywords, startsWithTopicMarker, throttleKeywordHits, tokenOverlap, verdictKeyword} from './stageIntent.ts';
import {SUBJECT_STAGE_INTENTS} from './subjectStageConfig.ts';

const here = dirname(fileURLToPath(import.meta.url));

describe('intent -> stage map (Phase 1 grammar)', () => {
  it('matches the config map and the grammar', () => {
    expect(INTENT_STAGES).toEqual(SUBJECT_STAGE_INTENTS);
    expect(INTENT_STAGES.context_or_setting).toEqual(['S1']);
    expect(INTENT_STAGES.quoting_or_citing).toEqual(['S2']);
    expect(INTENT_STAGES.search_or_many_sources).toEqual(['S3']);
    expect(INTENT_STAGES.explanation_key_terms).toEqual(['S4']);
    expect(INTENT_STAGES.official_or_final).toEqual(['S1', 'S5']);
    expect(INTENT_STAGES.confirmation_or_verdict).toEqual(['S4']);
    expect(INTENT_PRIORITY).toHaveLength(6);
  });
});

describe('classifyIntent', () => {
  const cases: Array<[string, string]> = [
    ['Imagine a small town where the story started last year.', 'context_or_setting'],
    ['Back in 2019 the situation was very different.', 'context_or_setting'],
    ['She said "please send relief money to this account".', 'quoting_or_citing'],
    ['According to the report the post was removed.', 'quoting_or_citing'],
    ['I searched for it and the results were everywhere.', 'search_or_many_sources'],
    ['Several websites listed the same sources and links.', 'search_or_many_sources'],
    ['The term is called phishing and it basically means fraud.', 'explanation_key_terms'],
    ['Because the reason is that people are in a hurry.', 'explanation_key_terms'],
    ['The official announcement from the ministry is final.', 'official_or_final'],
    ['In the end the decision is the final conclusion.', 'official_or_final'],
    ['Yes.', 'confirmation_or_verdict'],
    ['Exactly, that is right.', 'confirmation_or_verdict'],
  ];
  it.each(cases)('%s -> %s', (text, intent) => {
    expect(classifyIntent(text).intent).toBe(intent);
  });

  it('plain speech with no cue has no intent (the planner fills it)', () => {
    expect(classifyIntent('I went for a walk and bought some bread.').intent).toBeNull();
    expect(classifyIntent('').intent).toBeNull();
  });

  it('priority: an official statement outranks a citation cue; a quote of 3+ words is a strong citation', () => {
    expect(classifyIntent('The official statement said it was final.').intent).toBe('official_or_final');
    expect(classifyIntent('He shouted "this is not what we agreed to at all" and left.').intent).toBe('quoting_or_citing');
  });

  it('a confirmation word only counts in a SHORT sentence', () => {
    expect(classifyIntent('True.').intent).toBe('confirmation_or_verdict');
    expect(classifyIntent('I walked to the shop on the corner of the street yesterday afternoon and it was true.').intent).not.toBe('confirmation_or_verdict');
  });

  it('is deterministic and case-insensitive', () => {
    const a = classifyIntent('IMAGINE the Story Started LAST YEAR');
    expect(a).toEqual(classifyIntent('IMAGINE the Story Started LAST YEAR'));
    expect(a.intent).toBe('context_or_setting');
  });
});

describe('keywords (exact spoken words, <= 1 hit per second)', () => {
  const s = {start: 10, end: 16, text: 'In 2019 a scam took 40 percent of savings from the village called Rampur.'};
  it('derived keywords are exact substrings of the sentence, timed inside it', () => {
    const hits = deriveKeywords(s);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(3);
    for (const h of hits) {
      expect(s.text.toLowerCase()).toContain(h.text.toLowerCase());
      expect(h.at).toBeGreaterThanOrEqual(s.start);
      expect(h.at).toBeLessThanOrEqual(s.end);
    }
  });
  it('prefers numbers, caps terms, quoted words and the term after "called"', () => {
    const texts = deriveKeywords({start: 0, end: 5, text: 'The scam used an OTP and then 90 percent was lost.'}).map(h => h.text.toLowerCase());
    expect(texts.some(t => t.includes('otp') || t.includes('90'))).toBe(true);
    expect(deriveKeywords({start: 0, end: 4, text: 'The method is called compounding and it grows.'}).map(h => h.text)).toContain('compounding');
  });
  it('never returns function words only, and falls back to the longest content word', () => {
    expect(deriveKeywords({start: 0, end: 3, text: 'It is what it is.'})).toEqual([]);
    expect(deriveKeywords({start: 0, end: 3, text: 'We discussed neighbourhood gardens.'}).map(h => h.text)).toEqual(['neighbourhood']);
  });
  it('verdictKeyword returns the spoken verdict word', () => {
    expect(verdictKeyword({start: 0, end: 2, text: 'Yes, exactly.'})?.text.toLowerCase()).toBe('yes');
    expect(verdictKeyword({start: 0, end: 2, text: 'Maybe later.'})).toBeUndefined();
  });
  it('throttleKeywordHits keeps one hit per second (the first in a window), in time order, without mutating', () => {
    const hits = [{at: 5.2}, {at: 1}, {at: 1.4}, {at: 2.1}, {at: 2.2}, {at: 3.2}];
    const before = JSON.stringify(hits);
    const out = throttleKeywordHits(hits);
    expect(out.map(h => h.at)).toEqual([1, 2.1, 3.2, 5.2]);
    for (let i = 1; i < out.length; i += 1) expect(out[i]!.at - out[i - 1]!.at).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(JSON.stringify(hits)).toBe(before);
    expect(throttleKeywordHits([{at: 0}, {at: 0.5}], 0.4).map(h => h.at)).toEqual([0, 0.5]);
  });
  it('topic helpers', () => {
    expect(startsWithTopicMarker('So here is the thing.')).toBe(true);
    expect(startsWithTopicMarker('The thing is here.')).toBe(false);
    expect(tokenOverlap('market prices rising quickly', 'market prices rising quickly')).toBe(1);
    expect(tokenOverlap('market prices rising', 'garden flowers blooming')).toBe(0);
  });
});

describe('purity', () => {
  it('no model, network, env or file access in the classifier', () => {
    const src = readFileSync(join(here, 'stageIntent.ts'), 'utf8');
    for (const banned of ['fetch(', 'process.env', 'gemini', 'anthropic', 'claude', "from 'node:", 'axios']) expect(src.toLowerCase()).not.toContain(banned.toLowerCase());
  });
});
