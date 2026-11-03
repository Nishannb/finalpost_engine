/**
 * WP18B: labeled-asset clusters are published as ImageRun graphics (injected publisher, no R2, no render).
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import type {MotionGraphicResult} from '../../motionWorker/worker.ts';
import {publishImageRuns, type ImageRunPublisher} from './imageRunPublish.ts';
import type {LabeledAssetBrief, LabeledAssetSlot} from './labeledAssetBrief.ts';
import {planLabeledAssetPlacements, type ResolvedLabeledAsset} from './labeledAssetPlacement.ts';

const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const analyze = strip(readFileSync(new URL('../../pipeline/analyzeVideo.ts', import.meta.url), 'utf8'));

const slot = (id: string, kind: LabeledAssetSlot['kind'], startSec: number, endSec: number, userAssetId: string): LabeledAssetSlot => ({
  id, label: `${kind} ${id}`, kind, reason: '', startSec, endSec, accept: ['image'], spokenHint: '', status: 'uploaded', userAssetId,
});
const assets = new Map<string, ResolvedLabeledAsset>([
  ['ub_1', {url: 'https://cdn.example.com/a.png', mediaKind: 'image'}],
  ['ub_2', {url: 'https://cdn.example.com/b.png', mediaKind: 'image'}],
]);
const brief: LabeledAssetBrief = {version: 1, outputDurationSec: 40, slots: [slot('a', 'logo', 5, 7, 'ub_1'), slot('b', 'logo', 7.5, 9.5, 'ub_2')]};
const placement = planLabeledAssetPlacements({brief, assets, outputDurationSec: 40});

const okPublisher: ImageRunPublisher = async (briefInput, source) => {
  const b = briefInput as {id: string; assets: Array<{id: string; url: string}>};
  return {
    id: b.id,
    module: {url: 'https://r2.example.com/m.js', sha256: 'x'},
    placement: {mode: 'full_screen'},
    props: {content: {}, assets: Object.fromEntries(b.assets.map(a => [a.id, {src: a.url}]))},
    brief: {},
    source,
  } as unknown as MotionGraphicResult;
};

describe('WP18B publish', () => {
  it('2 bound logos -> one ImageRun graphic spanning the run, assets keyed to the module items', async () => {
    const {published, failed} = await publishImageRuns(placement.runs, {publisher: okPublisher});
    expect(failed).toHaveLength(0);
    expect(published).toHaveLength(1);
    const {graphic, run, overlayIntent} = published[0]!;
    expect(graphic.start).toBe(run.start);
    expect(graphic.end).toBe(run.end);
    expect(graphic.placement.mode).toBe('full_screen');
    expect(Object.keys(graphic.props!.assets as object)).toEqual(['run_0', 'run_1']);
    // the slideshow stand-in carries exactly the intent the publish step reports, so analyze can remove it
    expect(placement.overlays.map(o => o.intent)).toContain(overlayIntent);
  });
  it('the module source handed to the publisher is the ImageRun module with no URL literal', async () => {
    let seen = '';
    await publishImageRuns(placement.runs, {publisher: async (b, source) => { seen = source; return okPublisher(b, source); }});
    expect(seen).toMatch(/ImageRun/);
    expect(seen).not.toMatch(/https?:\/\//);
  });
  it('a publisher failure is returned as failed (no throw) so the slideshow stays', async () => {
    const {published, failed} = await publishImageRuns(placement.runs, {publisher: async () => { throw new Error('boom'); }});
    expect(published).toHaveLength(0);
    expect(failed).toHaveLength(1);
  });
  it('analyze replaces only the published runs\' slideshow overlays and warns on fallback', () => {
    expect(analyze).toMatch(/publishImageRuns\(placement\.runs/);
    expect(analyze).toMatch(/replaced\.has\(overlay\.intent/);
    expect(analyze).toMatch(/polish_assets:imagerun_fallback:\$\{fallback\}/);
    expect(analyze.indexOf('publishImageRuns(')).toBeGreaterThan(analyze.indexOf('planLabeledAssetPlacements('));
    expect(analyze.indexOf('publishImageRuns(')).toBeLessThan(analyze.indexOf('ensurePolishTransitionDensity('));
  });
});
