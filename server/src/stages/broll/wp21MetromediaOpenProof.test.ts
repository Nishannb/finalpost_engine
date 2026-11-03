/**
 * WP21: offline structural proof of the Metromedia-open grammar (flash card -> image run -> tilted screenshot -> transitions -> filler). No render, no network.
 */
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {planMetromediaOpenProof, type OpenProofFixture} from './metromediaOpenProof.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/wp21-metromedia-open.json', import.meta.url), 'utf8')) as OpenProofFixture;
const proof = planMetromediaOpenProof(fixture);

describe('WP21 Metromedia-open grammar proof', () => {
  it('the fixture is a 15-20 s open with fake https assets only', () => {
    expect(fixture.outputDurationSec).toBeGreaterThanOrEqual(15);
    expect(fixture.outputDurationSec).toBeLessThanOrEqual(20);
    for (const url of Object.values(fixture.assets)) expect(url).toMatch(/^https:\/\/assets\.fixture\.test\//);
  });
  it('1) a flash / pivot card of at most 4 words, resolved to FlashCard, in the first seconds', () => {
    expect(proof.flash).not.toBeNull();
    expect(proof.flash!.phrase).toBe('Then everything broke');
    expect(proof.flash!.wordCount).toBeLessThanOrEqual(4);
    expect(proof.flash!.registryComposition).toBe('FlashCard');
    expect(proof.flash!.end - proof.flash!.start).toBeLessThanOrEqual(1.2);
    expect(proof.flash!.start).toBeLessThan(3);
  });
  it('2) two bound logos become one logo_cloud image run (logo_slam hero), not two pips', () => {
    expect(proof.runs).toHaveLength(1);
    expect(proof.runs[0]!.mode).toBe('logo_cloud');
    expect(proof.runs[0]!.items).toHaveLength(2);
    expect(proof.runs[0]!.items[0]!.recipeId).toBe('logo_slam');
    expect(proof.runs[0]!.start).toBeGreaterThanOrEqual(proof.flash!.end);
  });
  it('3) the screenshot is a tilted card (card_tilt_in) after the run', () => {
    const shot = proof.overlays.find(o => o.keyword === 'Dashboard screenshot')!;
    expect(shot.layout).toBe('card');
    expect(shot.recipeId).toBe('card_tilt_in');
    expect(shot.start).toBeGreaterThan(proof.runs[0]!.end - 0.01);
  });
  it('4) at least three procedural transitions with varied keywords inside the open', () => {
    expect(proof.transitions.length).toBeGreaterThanOrEqual(3);
    expect(new Set(proof.transitions.map(t => t.keyword)).size).toBeGreaterThanOrEqual(3);
    for (const t of proof.transitions) expect(t.at).toBeLessThanOrEqual(fixture.outputDurationSec);
  });
  it('5) a filler cutaway from the bound broll_clip in a window nothing else covers', () => {
    expect(proof.fillers.overlays.length).toBeGreaterThanOrEqual(1);
    for (const o of proof.fillers.overlays) {
      expect(o.assetUrl).toBe(fixture.assets.ub_4);
      expect(o.end - o.start).toBeLessThanOrEqual(3);
    }
    expect(proof.warnings).toContain(`polish_pace:fillers:${proof.fillers.overlays.length}`);
  });
  it('6) nothing is scraped: every media source is a fixture upload (provider user), nothing from stock / KLIPY', () => {
    const urls = new Set(Object.values(fixture.assets));
    for (const o of [...proof.overlays, ...proof.fillers.overlays]) {
      expect(o.provider).toBe('user');
      expect(urls.has(o.assetUrl)).toBe(true);
      for (const slide of o.slides ?? []) expect(urls.has(slide.assetUrl)).toBe(true);
    }
  });
  it('7) something changes every <= 4 s across the open (beats + transitions), and the first beat lands under 2 s', () => {
    const times = proof.beats.map(b => b.t).sort((a, b) => a - b);
    expect(times[0]!).toBeLessThan(2);
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(4);
  });
  it('writes the beat timeline for the report', () => {
    const dir = new URL('../../../../remotion/out/phase36-readiness/wp21-proof/', import.meta.url);
    mkdirSync(dir, {recursive: true});
    writeFileSync(new URL('beats.json', dir), JSON.stringify({warnings: proof.warnings, beats: proof.beats}, null, 1));
    expect(proof.beats.length).toBeGreaterThan(5);
  });
});
