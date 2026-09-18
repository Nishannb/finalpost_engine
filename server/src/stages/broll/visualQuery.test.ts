import {describe, expect, it} from 'vitest';

import {
  applySubjectToQuery,
  genderedQueryVariants,
  inferStockSubject,
  keyPhrasesFromTranscript,
  keywordFallbacks,
  sanitizeVisualQuery,
  themeQueriesFromTranscript,
} from './visualQuery.ts';

describe('sanitizeVisualQuery', () => {
  it('rejects leftover transcript nouns', () => {
    expect(sanitizeVisualQuery('app')).toBe('');
    expect(sanitizeVisualQuery('women')).toBe('');
    expect(sanitizeVisualQuery('inspiration and action')).toBe('');
  });

  it('keeps gender when it is part of a scene', () => {
    expect(sanitizeVisualQuery('woman walking airport')).toBe('woman walking airport');
  });
});

describe('inferStockSubject', () => {
  it('picks women when the talk is about women traveling', () => {
    expect(
      inferStockSubject(
        'I want ambitious women to grab a passport and see the world.',
      ),
    ).toBe('woman');
  });
});

describe('applySubjectToQuery', () => {
  it('genders people-scenes and leaves object closeups alone', () => {
    expect(applySubjectToQuery('walking through airport terminal', 'woman')).toBe(
      'woman walking through airport terminal',
    );
    expect(applySubjectToQuery('airplane window clouds', 'woman')).toBe(
      'airplane window clouds',
    );
  });
});

describe('genderedQueryVariants', () => {
  it('adds female/women phrasings for people scenes', () => {
    const queries = genderedQueryVariants('woman walking airport terminal', 'woman');
    expect(queries.join(' ')).toMatch(/woman walking airport/);
    expect(queries.join(' ')).toMatch(/female walking airport/);
  });
});

describe('keyPhrasesFromTranscript', () => {
  it('lifts a from-to slogan', () => {
    expect(
      keyPhrasesFromTranscript('Go from inspiration to action and book the trip.')[0]?.toLowerCase(),
    ).toBe('from inspiration to action');
  });
});

describe('keywordFallbacks', () => {
  it('never emits a generic last word', () => {
    expect(keywordFallbacks('bold lives of adventure')).not.toContain('adventure');
    expect(keywordFallbacks('mobile app')).toEqual([]);
  });
});

describe('themeQueriesFromTranscript', () => {
  it('maps a passport travel talk to travel scenes, not packing or phones', () => {
    const queries = themeQueriesFromTranscript(
      'I want ambitious women to grab a passport and see the world. Travel is the adventure.',
    );
    expect(queries.join(' ')).toMatch(/airport|airplane|passport|hiking|skyline/);
    expect(queries.join(' ')).toMatch(/woman/);
    expect(queries.join(' ')).not.toMatch(/\bman\b|packing|laundry|app/);
  });
});
