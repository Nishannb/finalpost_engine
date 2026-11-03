/**
 * WP3G pure tests: row 9 of the offline scorer uses the blueprint's `sourceHasAudio` (the fact the Lambda check uses). Inline fixtures; the WP3A legacy fixture is read with
 * readFileSync. Import graph: rubricScorer.ts (-> lib/renderIntegrity.ts -> lib/errors.ts -> lib/billingGuard.ts), lib/renderIntegrity.ts, lib/lambdaOutputCheck.ts (-> addressGuard:
 * node:net / node:dns/promises imported, never called). No logger, `.env`, SDK, FFmpeg, Chromium or network.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {audioExpectationFor} from '../lib/lambdaOutputCheck.ts';
import {judgeRenderOutput} from '../lib/renderIntegrity.ts';
import {scoreRubric, type ScoreInput} from './rubricScorer.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const read = (...parts: string[]) => readFileSync(resolve(...parts), 'utf8');

type Json = Record<string, unknown>;
const bp = (over: Json = {}): Json => ({width: 1080, height: 1920, outputDurationSec: 30, hookTitle: 'x', captionDirection: {position: 'bottom', bottomFrac: 0.18}, stats: {warnings: []}, ...over});
const WITH_AUDIO = {path: 'x.mp4', exists: true, bytes: 2_000_000, probe: {width: 1080, height: 1920, durationSec: 30, fps: 30, hasAudio: true}, decode: {ok: true, videoFrames: 900, decodedSec: 30, errors: []}};
const SILENT = {...WITH_AUDIO, probe: {...WITH_AUDIO.probe, hasAudio: false}};
const row9 = (blueprint: Json, inspection: unknown, extra: Partial<ScoreInput> = {}) => scoreRubric({blueprint, inspection, ...extra}).rows.find(item => item.row === 9)!;
const audioCheck = (r: ReturnType<typeof row9>) => r.checks.find(item => item.id === 'audio_present' || item.id === 'audio_missing')!;

describe('sourceHasAudio true', () => {
  it('a silent output fails row 9; the failed check is audio_missing and the evidence names it', () => {
    const r = row9(bp({sourceHasAudio: true}), SILENT);
    expect(r.status).toBe('fail');
    const c = audioCheck(r);
    expect(c).toMatchObject({id: 'audio_missing', status: 'fail'});
    expect(c.evidence).toEqual(expect.arrayContaining([{path: 'inspection', value: 'audio_missing'}, {path: 'sourceHasAudio', value: true}, {path: 'inspection.probe.hasAudio', value: false}]));
  });
  it('the decision is the shared judge\'s: the detail text is exactly the judge\'s, with no threshold of the scorer\'s own', () => {
    const judged = judgeRenderOutput(SILENT as never, {width: 1080, height: 1920, durationSec: 30, expectAudio: true}).find(item => item.check === 'audio_missing')!;
    expect(audioCheck(row9(bp({sourceHasAudio: true}), SILENT)).detail).toBe(judged.detail);
  });
  it('an output with audio passes, and the row is complete', () => {
    const r = row9(bp({sourceHasAudio: true}), WITH_AUDIO);
    expect(r).toMatchObject({status: 'pass', complete: true});
    expect(audioCheck(r)).toMatchObject({id: 'audio_present', status: 'pass'});
  });
});

describe('sourceHasAudio false', () => {
  it('a silent output passes the audio check (the source had none) and the row passes', () => {
    const r = row9(bp({sourceHasAudio: false}), SILENT);
    expect(audioCheck(r)).toMatchObject({id: 'audio_present', status: 'pass'});
    expect(r).toMatchObject({status: 'pass', complete: true});
  });
  it('an output that does have audio also passes', () => {
    expect(row9(bp({sourceHasAudio: false}), WITH_AUDIO).status).toBe('pass');
  });
});

describe('sourceHasAudio absent', () => {
  it('the audio check is not_checked, the other checks still run, and the row is not failed for the missing field', () => {
    const r = row9(bp(), SILENT);
    expect(audioCheck(r)).toMatchObject({id: 'audio_present', status: 'not_checked'});
    expect(r.checks.find(item => item.id === 'output_valid')?.status).toBe('pass');
    expect(r).toMatchObject({status: 'pass', complete: false});
  });
  it('other row 9 failures are still reported without the field', () => {
    const r = row9(bp(), {...SILENT, probe: {...SILENT.probe, durationSec: 5}});
    expect(r.status).toBe('fail');
    expect(r.checks.filter(c => c.status === 'fail').map(c => c.id)).toEqual(['duration_mismatch']);
    expect(audioCheck(r).status).toBe('not_checked');
  });
  it('a value that is not a boolean counts as absent', () => {
    for (const value of ['true', 'false', 1, 0, null, {}, []]) {
      expect(audioCheck(row9(bp({sourceHasAudio: value}), SILENT)).status, String(value)).toBe('not_checked');
    }
  });
  it('the legacy stored example (no field) with a silent inspection: audio not_checked', () => {
    const legacy = JSON.parse(read(HERE, 'fixtures', 'wp3a-phase34-blueprint.trimmed.json')) as Json;
    expect('sourceHasAudio' in legacy).toBe(false);
    const r = row9(legacy, {...SILENT, probe: {...SILENT.probe, durationSec: legacy.outputDurationSec}});
    expect(audioCheck(r).status).toBe('not_checked');
    expect(r.status).toBe('pass');
  });
});

describe('no inspection file', () => {
  it('row 9 stays not_checked, whatever the blueprint says', () => {
    for (const sourceHasAudio of [true, false, undefined]) {
      const r = scoreRubric({blueprint: bp({sourceHasAudio})}).rows.find(item => item.row === 9)!;
      expect(r).toMatchObject({status: 'not_checked', complete: false});
      expect(r.checks.map(c => c.id)).toEqual(['output_inspection']);
    }
  });
});

describe('the audio check when the output itself cannot be judged', () => {
  it('a missing, empty or unreadable output fails on that alone; audio is not_checked (its streams are unknown)', () => {
    for (const inspection of [{path: 'x', exists: false, bytes: 0}, {path: 'x', exists: true, bytes: 100}, {path: 'x', exists: true, bytes: 50_000, probeError: 'moov atom not found'}]) {
      const r = row9(bp({sourceHasAudio: true}), inspection);
      expect(r.status).toBe('fail');
      expect(r.checks.filter(c => c.status === 'fail')).toHaveLength(1);
      expect(audioCheck(r)).toMatchObject({id: 'audio_present', status: 'not_checked'});
    }
  });
  it('several failures, audio included, are all reported', () => {
    const r = row9(bp({sourceHasAudio: true}), {...SILENT, probe: {...SILENT.probe, durationSec: 5}, decode: undefined});
    expect(r.checks.filter(c => c.status === 'fail').map(c => c.id).sort()).toEqual(['audio_missing', 'duration_mismatch', 'output_not_decoded']);
  });
});

describe('which source of truth wins', () => {
  it('the blueprint field wins over the caller flag', () => {
    expect(audioCheck(row9(bp({sourceHasAudio: true}), SILENT, {expectAudio: false})).status).toBe('fail');
    expect(audioCheck(row9(bp({sourceHasAudio: false}), SILENT, {expectAudio: true})).status).toBe('pass');
  });
  it('the caller flag still works when the blueprint has none, and the evidence says whose it was', () => {
    const failed = audioCheck(row9(bp(), SILENT, {expectAudio: true}));
    expect(failed).toMatchObject({id: 'audio_missing', status: 'fail'});
    expect(failed.evidence).toEqual(expect.arrayContaining([{path: 'callerExpectAudio', value: true}]));
    expect(audioCheck(row9(bp(), WITH_AUDIO, {expectAudio: true})).status).toBe('pass');
    expect(audioCheck(row9(bp(), SILENT, {expectAudio: false})).status).toBe('pass');
  });
  it('the scorer reads the field exactly as the Lambda check does', () => {
    for (const value of [true, false, undefined, null, 'true', 1, 0]) {
      const lambda = audioExpectationFor(value).expectAudio;
      const scored = audioCheck(row9(bp({sourceHasAudio: value}), SILENT)).status;
      expect(scored, String(value)).toBe(lambda === true ? 'fail' : lambda === false ? 'pass' : 'not_checked');
    }
  });
});

describe('scope (source text)', () => {
  const scorer = read(HERE, 'rubricScorer.ts');
  const code = scorer.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('the scorer adds no audio threshold or stream test of its own and imports what it did before', () => {
    expect(code).not.toMatch(/!\s*probe\.hasAudio|hasAudio\s*===|hasAudio\s*!==|MIN_BYTES|tolerance|0\.98/);
    expect([...scorer.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).toEqual(['../lib/renderIntegrity.ts', '../pipeline/experimentVerdict.ts', '../stages/broll/groundedText.ts']);
    expect(scorer).toContain("const saved = get(input.blueprint, 'sourceHasAudio');");
  });
  it('the Lambda and local render paths do not know the scorer, and the CLI keeps its flags', () => {
    for (const path of [['lib', 'lambdaOutputCheck.ts'], ['pipeline', 'renderRunner.ts'], ['stages', 'render', 'localRender.ts'], ['stages', 'render', 'remotionLambda.ts']]) {
      expect(read(SRC, ...path), path.join('/')).not.toMatch(/rubricScorer|scoreRubric/);
    }
    const cli = read(SRC, 'scripts', 'scoreRubric.ts');
    expect(cli).toContain("'--expect-audio'");
    expect(cli).toContain('input.expectAudio = value ===');
  });
  it('legacy blueprints still carry no sourceHasAudio: the writer is unchanged and mvp-only', () => {
    expect(read(SRC, 'pipeline', 'analyzeVideo.ts')).toContain("...(mvpLike || speechCutsOn ? {sourceHasAudio: originalProbe.hasAudio} : {}),");
  });
  it('the defaults are unchanged', () => {
    const env = read(SRC, 'config', 'env.ts');
    expect(env).toContain("PRODUCT_EDIT_PROFILE: str('cuts')");
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED: bool\(false\)/);
  });
});
