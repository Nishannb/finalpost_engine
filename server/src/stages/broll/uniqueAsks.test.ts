/** 2026-11-26: the same YouTube logo was asked for 4-5 times. One ask per asset. */
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {askKey, buildLabeledAssetBrief, uniqueAsks} from './labeledAssetBrief.ts';
import {brollOpportunitiesToSlots, type BrollOpportunity} from './brollOpportunities.ts';
import {sniffMedia} from './userBrollDescribe.ts';

const words = (text: string) => text.split(' ').map((t, i) => ({text: t, start: i * 0.35, end: i * 0.35 + 0.3}));

describe('one ask per asset', () => {
  it('"YouTube logo", "YouTube logo 2 of 3" and "Clip or image: YouTube logo" are the same asset', () => {
    expect(askKey({kind: 'logo', label: 'YouTube logo'})).toBe(askKey({kind: 'logo', label: 'YouTube logo 2 of 3'}));
    expect(askKey({kind: 'logo', label: 'YouTube logo'})).not.toBe(askKey({kind: 'logo', label: 'Instagram logo'}));
    expect(askKey({kind: 'logo', label: 'YouTube logo'})).not.toBe(askKey({kind: 'screenshot', label: 'YouTube Studio analytics'}));
    expect(uniqueAsks([{kind: 'logo', label: 'YouTube logo'}, {kind: 'logo', label: 'YouTube logo 1 of 3'}, {kind: 'logo', label: 'Instagram logo'}])).toHaveLength(2);
  });

  it('Kinetic keyword asks: a brand said many times is ONE logo ask (no 3-variant logo group)', () => {
    const text = 'YouTube pays creators. On YouTube you need watch time. YouTube rewards retention. Grow on YouTube with a plan every single week now.';
    const brief = buildLabeledAssetBrief({words: words(text), outputDurationSec: 60, kinetic: true});
    expect(brief.slots.filter(s => s.kind === 'logo' && /youtube/i.test(s.label))).toHaveLength(1);
    const keys = brief.slots.map(askKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('non-Kinetic edits keep their logo-cloud variants exactly as before', () => {
    const text = 'YouTube pays creators. On YouTube you need watch time. YouTube rewards retention. Grow on YouTube with a plan every single week now.';
    const brief = buildLabeledAssetBrief({words: words(text), outputDurationSec: 60});
    expect(brief.slots.filter(s => s.groupId).length).toBeGreaterThanOrEqual(2);
  });

  it('AI moments that need the same picture ask for it once', () => {
    const o = (id: string, start: number, label: string): BrollOpportunity => ({
      id, timestamp_start: start, timestamp_end: start + 2, category: 'organization', detected_entity: label, visual_type: 'ENTITY_IMAGE', secondary_visual_types: [],
      visual_description: '', upload_label: label, asset_search_query: '', priority: 'high', visual_confidence: 0.9, reason_for_insertion: 'r', recommended_duration: 2,
      screen_occupancy: 'full', speaker_visibility: 'hidden', continuity_group: null, asset_source_preference: 'creator_upload', factuality_requirement: 'exact', avoid_visual: '', spoken: '',
    });
    const slots = brollOpportunitiesToSlots([o('a', 3, 'YouTube logo'), o('b', 9, 'YouTube logo'), o('c', 15, 'Official YouTube logo'), o('d', 21, 'Instagram logo')]);
    expect(slots.map(s => s.label)).toEqual(['YouTube logo', 'Instagram logo']);
  });
});

describe('sniffMedia (why an upload could not be read)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sniff-'));
  const file = (name: string, bytes: Buffer) => { const p = path.join(dir, name); writeFileSync(p, bytes); return p; };
  it('names HEIC saved as .jpg, real JPEG, HTML pages and empty files', async () => {
    expect(await sniffMedia(file('a.jpg', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(8)])))).toMatch(/^heic:/);
    expect(await sniffMedia(file('b.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])))).toMatch(/^jpeg:/);
    expect(await sniffMedia(file('c.jpg', Buffer.from('<!DOCTYPE html><html>')))).toMatch(/^html_or_xml:/);
    expect(await sniffMedia(file('d.jpg', Buffer.alloc(0)))).toBe('empty:0B');
  });
});
