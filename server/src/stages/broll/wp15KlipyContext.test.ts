/**
 * WP15: contextual KLIPY queries + labeled asset brief (offline; no live KLIPY / no render).
 */
import {describe, expect, it} from 'vitest';

import {
  attachLabeledAsset,
  buildLabeledAssetBrief,
} from './labeledAssetBrief.ts';
import {
  contentTokens,
  contextualKlipyQuery,
  proposeKlipyBeats,
  wordsInWindow,
} from './klipyContextQuery.ts';

describe('WP15 1) contextual queries (not bare keywords)', () => {
  it('maps spoken emotion / money / free to reaction sticker queries', () => {
    expect(contextualKlipyQuery('everything is completely free for you today')?.query).toBe('free celebration');
    expect(contextualKlipyQuery('they make ten thousand dollars a month')?.query).toBe('money raining');
    expect(contextualKlipyQuery('our audience is blowing up overnight')?.query).toBe('rocket launch');
  });

  it('builds a multi-token claim phrase instead of a single stopword', () => {
    const hit = contextualKlipyQuery('niche categories work better than broad markets');
    expect(hit).not.toBeNull();
    expect(hit!.query.split(/\s+/).length).toBeGreaterThanOrEqual(2);
    expect(hit!.reason).toBe('claim_phrase');
    expect(contentTokens('the and of niche categories')).toEqual(['niche', 'categories']);
  });

  it('returns null for empty / too-short speech', () => {
    expect(contextualKlipyQuery('um')).toBeNull();
    expect(contextualKlipyQuery('')).toBeNull();
  });
});

describe('WP15 2) propose beats across timeline', () => {
  const words = [
    {text: 'They', start: 0.2, end: 0.4},
    {text: 'see', start: 0.4, end: 0.55},
    {text: 'online', start: 0.55, end: 0.8},
    {text: 'sales', start: 0.8, end: 1.1},
    {text: 'blowing', start: 1.1, end: 1.4},
    {text: 'up', start: 1.4, end: 1.55},
    {text: 'Everything', start: 12.0, end: 12.3},
    {text: 'is', start: 12.3, end: 12.4},
    {text: 'completely', start: 12.4, end: 12.8},
    {text: 'free', start: 12.8, end: 13.1},
    {text: 'for', start: 13.1, end: 13.2},
    {text: 'you', start: 13.2, end: 13.4},
  ];

  it('emits contextual beats with layout/anchor, not empty keyword shells', () => {
    const beats = proposeKlipyBeats({words, outputDurationSec: 24, contentType: 'sales_pitch', windowSec: 10, maxBeats: 4});
    expect(beats.length).toBeGreaterThanOrEqual(1);
    for (const beat of beats) {
      expect(beat.query.trim().split(/\s+/).length).toBeGreaterThanOrEqual(1);
      expect(beat.spoken.length).toBeGreaterThan(5);
      expect(['gif', 'sticker']).toContain(beat.kind);
      expect(['sticker', 'pip']).toContain(beat.layout);
    }
    expect(wordsInWindow(words, 12, 14).map(w => w.text).join(' ')).toMatch(/free/i);
  });
});

describe('WP15 3) labeled asset brief (post-cleanup upload slots)', () => {
  it('asks for logos / people / screenshots from spoken context', () => {
    const words = [
      {text: 'I', start: 1, end: 1.1},
      {text: 'use', start: 1.1, end: 1.3},
      {text: 'Shopify', start: 1.3, end: 1.7},
      {text: 'and', start: 1.7, end: 1.85},
      {text: 'look', start: 1.85, end: 2.0},
      {text: 'at', start: 2.0, end: 2.1},
      {text: 'this', start: 2.1, end: 2.25},
      {text: 'dashboard', start: 2.25, end: 2.7},
      {text: 'screenshot', start: 2.7, end: 3.2},
      {text: 'Elon', start: 14, end: 14.3},
      {text: 'Musk', start: 14.3, end: 14.7},
      {text: 'said', start: 14.7, end: 15.0},
      {text: 'the', start: 15.0, end: 15.1},
      {text: 'same', start: 15.1, end: 15.4},
      {text: 'thing', start: 15.4, end: 15.7},
    ];
    const brief = buildLabeledAssetBrief({words, outputDurationSec: 30, maxSlots: 8});
    expect(brief.version).toBe(1);
    expect(brief.slots.some(slot => slot.kind === 'logo' && /shopify/i.test(slot.label))).toBe(true);
    expect(brief.slots.some(slot => slot.kind === 'screenshot')).toBe(true);
    expect(brief.slots.some(slot => slot.kind === 'person' && /elon/i.test(slot.label))).toBe(true);
    expect(brief.slots.every(slot => slot.status === 'needed')).toBe(true);
    const bound = attachLabeledAsset(brief, brief.slots[0]!.id, 'ub_9');
    expect(bound.slots.find(slot => slot.id === brief.slots[0]!.id)?.status).toBe('uploaded');
    expect(bound.slots.find(slot => slot.id === brief.slots[0]!.id)?.userAssetId).toBe('ub_9');
  });

  it('applies client bindings by slot id and asset URL map', async () => {
    const {applyLabeledAssetBindings, skipLabeledAsset} = await import('./labeledAssetBrief.ts');
    const brief = buildLabeledAssetBrief({
      words: [
        {text: 'Shopify', start: 1, end: 1.5},
        {text: 'dashboard', start: 2, end: 2.5},
      ],
      outputDurationSec: 12,
      maxSlots: 4,
    });
    expect(brief.slots.length).toBeGreaterThan(0);
    const logo = brief.slots.find(slot => slot.kind === 'logo')!;
    const skipped = skipLabeledAsset(brief, brief.slots[brief.slots.length - 1]!.id);
    const url = 'https://cdn.example/shopify.png';
    const applied = applyLabeledAssetBindings(
      skipped,
      [
        {slotId: logo.id, status: 'uploaded', assetUrl: url, kind: logo.kind, label: logo.label},
        {
          slotId: brief.slots[brief.slots.length - 1]!.id,
          status: 'skipped',
        },
      ],
      new Map([[url, 'ub_3']]),
    );
    expect(applied.slots.find(slot => slot.id === logo.id)?.userAssetId).toBe('ub_3');
    expect(applied.slots.find(slot => slot.id === logo.id)?.status).toBe('uploaded');
  });
});

describe('WP15 4) overlay planner wiring pins', () => {
  it('analyzeVideo imports planKlipyOverlays and buildLabeledAssetBrief', async () => {
    const {readFileSync} = await import('node:fs');
    const {fileURLToPath} = await import('node:url');
    const {dirname, join} = await import('node:path');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../pipeline/analyzeVideo.ts'), 'utf8');
    expect(src).toContain("from '../stages/broll/klipyOverlayPlanner.ts'");
    expect(src).toContain("from '../stages/broll/labeledAssetBrief.ts'");
    expect(src).toContain('planKlipyOverlays');
    expect(src).toContain('buildLabeledAssetBrief');
    expect(src).toContain('assetBrief');
  });

  it('env exposes KLIPY_APP_KEY and overlay toggle', async () => {
    const {readFileSync} = await import('node:fs');
    const {fileURLToPath} = await import('node:url');
    const {dirname, join} = await import('node:path');
    const envSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../config/env.ts'), 'utf8');
    expect(envSrc).toContain('KLIPY_APP_KEY');
    expect(envSrc).toContain('KLIPY_OVERLAYS_ENABLED');
    expect(envSrc).toContain('KLIPY_MAX_SEARCHES_PER_EDIT');
  });

  it('klipyClient prefers mp4 and never rewrites static host paths in comments/policy', async () => {
    const {readFileSync} = await import('node:fs');
    const {fileURLToPath} = await import('node:url');
    const {dirname, join} = await import('node:path');
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), './klipyClient.ts'), 'utf8');
    expect(src).toContain("mediaKind: 'video'");
    expect(src).toContain('bucket.mp4');
    expect(src).toMatch(/Do not rewrite static/);
  });
});
