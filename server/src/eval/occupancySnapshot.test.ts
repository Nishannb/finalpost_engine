/**
 * Occupancy snapshot + replay: contract and experiment-integrity tests. Offline: synthetic measurements only, the speaker
 * detector is replaced by a replay of the snapshot, HTTP is mocked, no model, no real footage.
 */
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterAll, afterEach, describe, expect, it, vi} from 'vitest';

import {env} from '../config/env.ts';
import {speakerVisibleRanges} from '../lib/depthOverlay.ts';
import {buildTimeline} from '../stages/filters/timeline.ts';
import {legacyOccupancySliceTimes} from '../stages/directorV2/storyboardPlan.ts';
import {confirmedVisibilityText} from '../stages/directorV2/creativeDirector.ts';
import {formatOccupancySlices} from '../stages/directorV2/perception.ts';
import {outputToSourceSec} from '../stages/directorV2/visualContext.ts';
import {occupancyFromSpeaker, occupancySampleSec, type Occupancy} from '../stages/layout/occupancy.ts';
import {
  captureSnapshot, checkArmsReceivedSnapshot, independentMeasurements, loadSnapshotFile, occupancyInputDigest, occupancyReplaySource, packOccupancyFromSnapshot,
  parseSnapshot, primaryOccupancyInput, replayMeasurer, repeatMeasurements, snapshotContentHash, snapshotToJson, SnapshotError, SnapshotReplayError,
  validateSnapshot, type CaptureInput, type OccupancySnapshot,
} from './occupancySnapshot.ts';
import {OccupancyReplayError} from '../stages/layout/occupancyReplay.ts';
import {stable, unknown} from './runManifest.ts';

const holder = vi.hoisted(() => ({measure: null as null | ((input: {atSec: number}) => Promise<unknown>), bodies: [] as Array<Record<string, any>>}));
vi.mock('../stages/layout/occupancy.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../stages/layout/occupancy.ts')>();
  return {...actual, measureOccupancyAt: async (input: {atSec: number}) => holder.measure!(input)};
});
vi.mock('../media/ffmpeg.ts', async importOriginal => ({...(await importOriginal<typeof import('../media/ffmpeg.ts')>()), extractStillJpeg: async () => undefined}));
vi.mock('../lib/http.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/http.ts')>()),
  requestJson: async (_url: string, options: {body?: string}) => {
    holder.bodies.push(JSON.parse(options.body ?? '{}'));
    return {candidates: [{content: {parts: [{text: JSON.stringify({topic: 't', hook_title: 'Silence Speaks', moments: [{timestamp: 8, search_keyword: 'sunset', media: 'video', layout: 'cutaway'}], caption: {}})}]}}]};
  },
}));
const {buildPerceptionPack} = await import('../stages/directorV2/perception.ts');

const e = env as unknown as {OCCUPANCY_CONTEXT_V2: boolean; GEMINI_API_KEY: string};
const original = {flag: e.OCCUPANCY_CONTEXT_V2, key: e.GEMINI_API_KEY};
afterEach(() => {
  e.OCCUPANCY_CONTEXT_V2 = original.flag;
  e.GEMINI_API_KEY = original.key;
  holder.measure = null;
  holder.bodies.length = 0;
});
const dir = mkdtempSync(join(tmpdir(), 'occ-snapshot-'));
afterAll(() => rmSync(dir, {recursive: true, force: true}));

/** A synthetic clip with a silence cut, like the saved "hi" corpus (source 48.72 s, output 47.82 s). */
const KEEP = [
  {sourceStart: 0, sourceEnd: 4.16, outputStart: 0},
  {sourceStart: 4.74, sourceEnd: 42.2, outputStart: 4.16},
  {sourceStart: 42.52, sourceEnd: 48.72, outputStart: 41.62},
];
const SOURCE_SEC = 48.72;
const timeline = buildTimeline(KEEP as never);
const DURATION = timeline.outputDurationSec;

const detectedA = occupancyFromSpeaker({x: 0.2, y: 0.1, w: 0.6, h: 0.7}, 'vision');
const detectedB = occupancyFromSpeaker({x: 0.05, y: 0.15, w: 0.45, h: 0.75}, 'vision');
const fallbackBox = occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback');
const HASH = (c: string) => c.repeat(64);

/** Measurement instants exactly as the default path requests them with a placed primary: primary + legacy slice times [1:]. */
const sampledOutputTimes = legacyOccupancySliceTimes(DURATION).slice(1);
const primaryOutput = timeline.mapSourceToOutput(occupancySampleSec(SOURCE_SEC));

function fixture(values: {primary: Occupancy; sampled: [Occupancy, Occupancy]}, extra: Partial<CaptureInput> = {}): CaptureInput {
  return {
    id: 'synthetic-hi-1',
    source: {sourceId: 'synthetic:hi-like', videoSha256: HASH('a')},
    capture: {method: 'synthetic', capturedAt: '2026-10-11T00:00:00Z', note: 'hand-written fixture, no detector was run'},
    outputDurationSec: DURATION,
    measurements: [
      {id: 'p', role: 'primary', sourceSec: occupancySampleSec(SOURCE_SEC), outputSec: primaryOutput, occupancy: values.primary},
      ...sampledOutputTimes.map((outputSec, index) => ({id: `s${index}`, role: 'sampled' as const, sourceSec: outputToSourceSec(KEEP, outputSec), outputSec, occupancy: values.sampled[index]!})),
    ],
    ...extra,
  };
}
const goodInput = () => fixture({primary: detectedA, sampled: [detectedB, fallbackBox]});
const good = () => captureSnapshot(goodInput());

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const reseal = (snapshot: Record<string, any>) => ({...snapshot, contentSha256: snapshotContentHash(snapshot as never)});
const mutate = (edit: (snapshot: Record<string, any>) => void, seal = true) => {
  const copy = clone(good()) as Record<string, any>;
  edit(copy);
  return seal ? reseal(copy) : copy;
};
const reasons = (raw: unknown) => validateSnapshot(raw).map(item => `${item.path}: ${item.reason}`);

describe('capture, canonical hash, round trip', () => {
  it('seals a valid snapshot; the hash is the canonical content hash and is independent of key order', () => {
    const snapshot = good();
    expect(validateSnapshot(snapshot)).toEqual([]);
    expect(snapshot.contentSha256).toBe(snapshotContentHash(snapshot));
    expect(snapshot.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    const reordered = JSON.parse(stable({...snapshot, measurements: snapshot.measurements.map(item => ({...item, occupancy: {...item.occupancy}}))}));
    expect(snapshotContentHash(reordered)).toBe(snapshot.contentSha256);
  });

  it('round-trips through a file without changing a byte of meaning, and keeps its hash', () => {
    const path = join(dir, 'snap.json');
    writeFileSync(path, snapshotToJson(good()));
    const loaded = loadSnapshotFile(path);
    expect(stable(loaded)).toBe(stable(good()));
    expect(loaded.contentSha256).toBe(good().contentSha256);
  });

  it('any change to a measurement changes the hash', () => {
    const base = good().contentSha256;
    for (const edit of [
      (s: Record<string, any>) => { s.measurements[0].occupancy = occupancyFromSpeaker({x: 0.21, y: 0.1, w: 0.6, h: 0.7}, 'vision'); },
      (s: Record<string, any>) => { s.measurements[1].outputSec += 0.5; },
      (s: Record<string, any>) => { s.measurements[2].occupancy = occupancyFromSpeaker(s.measurements[2].occupancy.speaker, 'vision'); },
      (s: Record<string, any>) => { s.source.sourceId = 'other'; },
      (s: Record<string, any>) => { s.id = 'other'; },
    ]) {
      expect(snapshotContentHash(mutate(edit, false) as never)).not.toBe(base);
    }
  });

  it('refuses to capture an invalid snapshot', () => {
    expect(() => captureSnapshot({...goodInput(), measurements: []})).toThrow(SnapshotError);
  });
});

describe('malformed or incomplete snapshots are rejected, never repaired', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
  ])('rejects %s', (_name, raw) => {
    expect(validateSnapshot(raw).length).toBeGreaterThan(0);
  });

  it.each([
    ['wrong version', (s: any) => { s.snapshotVersion = 2; }, 'snapshotVersion'],
    ['empty id', (s: any) => { s.id = ''; }, 'id: must be a non-empty'],
    ['missing source', (s: any) => { delete s.source; }, 'source: must be an object'],
    ['empty sourceId', (s: any) => { s.source.sourceId = ' '; }, 'source.sourceId'],
    ['malformed video hash', (s: any) => { s.source.videoSha256 = 'abc'; }, 'source.videoSha256'],
    ['null video hash', (s: any) => { s.source.videoSha256 = null; }, 'source.videoSha256'],
    ['unknown video hash without reason', (s: any) => { s.source.videoSha256 = {$unknown: ''}; }, 'source.videoSha256'],
    ['bad capture method', (s: any) => { s.capture.method = 'live'; }, 'capture.method'],
    ['bad timestamp', (s: any) => { s.capture.capturedAt = 'yesterday'; }, 'capture.capturedAt'],
    ['no duration', (s: any) => { delete s.outputDurationSec; }, 'outputDurationSec'],
    ['zero duration', (s: any) => { s.outputDurationSec = 0; }, 'outputDurationSec'],
    ['no measurements', (s: any) => { s.measurements = []; }, 'measurements: must be a non-empty list'],
    ['measurements missing', (s: any) => { delete s.measurements; }, 'measurements: must be a non-empty list'],
    ['unexpected top-level field', (s: any) => { s.extra = 1; }, 'extra: unexpected field'],
    ['a face box at the top', (s: any) => { s.face = {x: 0, y: 0, w: 1, h: 1}; }, 'face boxes are not part'],
    ['a face box on a measurement', (s: any) => { s.measurements[0].face = {x: 0.3, y: 0.2, w: 0.2, h: 0.2}; }, 'face boxes are not part'],
    ['a face box inside occupancy', (s: any) => { s.measurements[0].occupancy.face = {x: 0.3}; }, 'face boxes are not part'],
    ['missing measurement id', (s: any) => { delete s.measurements[0].id; }, 'measurements[0].id'],
    ['duplicate ids', (s: any) => { s.measurements[1].id = 'p'; }, 'duplicate id p'],
    ['bad role', (s: any) => { s.measurements[0].role = 'main'; }, 'measurements[0].role'],
    ['negative source time', (s: any) => { s.measurements[0].sourceSec = -1; }, 'measurements[0].sourceSec'],
    ['source time as text', (s: any) => { s.measurements[0].sourceSec = '13'; }, 'measurements[0].sourceSec'],
    ['output time beyond the end', (s: any) => { s.measurements[1].outputSec = DURATION + 5; }, 'measurements[1].outputSec'],
    ['undefined output time', (s: any) => { delete s.measurements[1].outputSec; }, 'measurements[1].outputSec'],
    ['missing occupancy', (s: any) => { delete s.measurements[0].occupancy; }, 'measurements[0].occupancy'],
    ['occupancy without source', (s: any) => { delete s.measurements[0].occupancy.source; }, 'occupancy.source'],
    ['occupancy source "estimated"', (s: any) => { s.measurements[0].occupancy.source = 'estimated'; }, 'occupancy.source'],
    ['speaker outside the frame', (s: any) => { s.measurements[0].occupancy.speaker.w = 1.4; }, 'normalized box inside the frame'],
    ['speaker with NaN', (s: any) => { s.measurements[0].occupancy.speaker.x = null; }, 'occupancy.speaker'],
    ['zero-size speaker', (s: any) => { s.measurements[0].occupancy.speaker.h = 0; }, 'normalized box inside the frame'],
    ['derived side tampered', (s: any) => { s.measurements[0].occupancy.preferredSide = s.measurements[0].occupancy.preferredSide === 'left' ? 'right' : 'left'; }, 'derived fields'],
    ['derived anchor tampered', (s: any) => { s.measurements[0].occupancy.overlayAnchor = 'bottom_left'; }, 'derived fields'],
    ['two primaries', (s: any) => { s.measurements[1].role = 'primary'; }, 'at most one measurement may be the primary'],
    ['unexpected measurement field', (s: any) => { s.measurements[0].confidence = 0.9; }, 'confidence: unexpected field'],
  ] as Array<[string, (s: any) => void, string]>)('%s', (_name, edit, expected) => {
    const found = reasons(mutate(edit));
    expect(found.length, found.join('\n')).toBeGreaterThan(0);
    expect(found.join('\n')).toContain(expected);
  });

  it('relabelling a fallback as vision with the SAME box is structurally valid, so only the hash and the arm check can catch it', async () => {
    const relabelled = reseal(clone((() => { const c = clone(good()) as Record<string, any>; c.measurements[2].occupancy.source = 'vision'; return c; })())) as unknown as OccupancySnapshot;
    expect(validateSnapshot(relabelled)).toEqual([]);
    expect(relabelled.contentSha256).not.toBe(good().contentSha256);
    expect(occupancyInputDigest(packOccupancyFromSnapshot(relabelled))).not.toBe(occupancyInputDigest(packOccupancyFromSnapshot(good())));
  });

  it('a snapshot edited after capture without re-sealing is rejected (hash mismatch)', () => {
    const tampered = mutate(s => { s.measurements[0].occupancy = occupancyFromSpeaker({x: 0.3, y: 0.1, w: 0.5, h: 0.7}, 'vision'); }, false);
    expect(reasons(tampered)).toEqual(['contentSha256: does not match the snapshot content: it was edited after capture, or the hash is wrong']);
  });

  it('parseSnapshot reports ok:false with the problems, and loadSnapshotFile throws on bad JSON, bad content and a missing file', () => {
    const parsed = parseSnapshot({});
    expect(parsed.ok).toBe(false);
    const badJson = join(dir, 'bad.json');
    writeFileSync(badJson, '{not json');
    expect(() => loadSnapshotFile(badJson)).toThrow(SnapshotError);
    const badContent = join(dir, 'bad-content.json');
    writeFileSync(badContent, JSON.stringify({snapshotVersion: 1}));
    expect(() => loadSnapshotFile(badContent)).toThrow(/invalid occupancy snapshot/);
    expect(() => loadSnapshotFile(join(dir, 'missing.json'))).toThrow(SnapshotError);
  });

  it('an explicit unknown source hash is a valid statement', () => {
    const snapshot = captureSnapshot({...goodInput(), source: {sourceId: 'synthetic:remote-only', videoSha256: unknown('source video not available locally')}});
    expect(validateSnapshot(snapshot)).toEqual([]);
  });
});

describe('what is preserved: unknown, fallback, estimated and repeated stay distinct', () => {
  it('a fallback measurement keeps its fallback indicator and default box; a vision measurement is never relabelled', () => {
    const snapshot = good();
    const fallback = snapshot.measurements.find(item => item.id === 's1')!;
    expect(fallback.occupancy.source).toBe('fallback');
    expect(fallback.occupancy.speaker).toEqual({x: 0.18, y: 0.16, w: 0.64, h: 0.62});
    expect(snapshot.measurements.find(item => item.id === 'p')!.occupancy.source).toBe('vision');
  });

  it('an instant that fell in a trimmed silence keeps outputSec null (it is not placed anywhere, and is not an observation of any output time)', () => {
    const snapshot = captureSnapshot({
      ...goodInput(),
      measurements: [...goodInput().measurements, {id: 'cut', role: 'sampled', sourceSec: 4.4, outputSec: null, occupancy: detectedA}],
    });
    expect(snapshot.measurements.find(item => item.id === 'cut')!.outputSec).toBeNull();
    const pack = packOccupancyFromSnapshot(snapshot);
    expect(pack.occupancyMeasured.map(slice => slice.atSec)).not.toContain(null);
    expect(pack.occupancyMeasured).toHaveLength(independentMeasurements(snapshot).length - 1);
  });

  it('there is no field in which a face could be recorded as measured', () => {
    expect(reasons(mutate(s => { s.measurements[0].occupancy.faceBox = {}; })).join()).toContain('unexpected field');
  });

  it('repeats are stored but are not independent: same instant and same value only', () => {
    const withRepeat = captureSnapshot({
      ...goodInput(),
      measurements: [...goodInput().measurements, {id: 's0-again', role: 'sampled', sourceSec: outputToSourceSec(KEEP, sampledOutputTimes[0]!), outputSec: sampledOutputTimes[0]!, occupancy: detectedB, repeatOf: 's0'}],
    });
    expect(repeatMeasurements(withRepeat)).toHaveLength(1);
    expect(independentMeasurements(withRepeat)).toHaveLength(good().measurements.length);
    expect(packOccupancyFromSnapshot(withRepeat).occupancyMeasured).toHaveLength(good().measurements.length);
    // the pack (and any digest of it) is the same with or without the repeat: it adds no evidence
    expect(occupancyInputDigest(packOccupancyFromSnapshot(withRepeat))).toBe(occupancyInputDigest(packOccupancyFromSnapshot(good())));
  });

  it.each([
    ['a repeat of a missing id', (s: any) => { s.measurements.push({id: 'r', role: 'sampled', sourceSec: 1, outputSec: 1, occupancy: s.measurements[1].occupancy, repeatOf: 'nope'}); }, 'not an earlier measurement'],
    ['a repeat with a different value', (s: any) => { s.measurements.push({...clone(s.measurements[1]), id: 'r', repeatOf: 's0', occupancy: occupancyFromSpeaker({x: 0.1, y: 0.1, w: 0.5, h: 0.5}, 'vision')}); }, 'same instants and the same value'],
    ['a repeat at a different instant', (s: any) => { s.measurements.push({...clone(s.measurements[1]), id: 'r', repeatOf: 's0', sourceSec: s.measurements[1].sourceSec + 1}); }, 'same instants and the same value'],
    ['a repeat of a repeat', (s: any) => { s.measurements.push({...clone(s.measurements[1]), id: 'r1', repeatOf: 's0'}, {...clone(s.measurements[1]), id: 'r2', repeatOf: 'r1'}); }, 'a repeat of a repeat'],
    ['a primary that is a repeat', (s: any) => { s.measurements.push({...clone(s.measurements[1]), id: 'r', role: 'primary', repeatOf: 's0'}); }, 'a repeat cannot be the primary'],
    ['a duplicate WITHOUT repeatOf (would count as separate evidence)', (s: any) => { s.measurements.push({...clone(s.measurements[1]), id: 'dup'}); }, 'two independent measurements at the same source instant'],
  ] as Array<[string, (s: any) => void, string]>)('rejects %s', (_name, edit, expected) => {
    expect(reasons(mutate(edit)).join('\n')).toContain(expected);
  });
});

describe('replay boundary: only recorded measurements are served', () => {
  it('serves each recorded instant as a deep copy and nothing else', async () => {
    const snapshot = good();
    const replay = replayMeasurer(snapshot);
    const at = snapshot.measurements.find(item => item.id === 's0')!.sourceSec;
    const first = await replay.measure({atSec: at}) as Occupancy;
    const second = await replay.measure({atSec: at}) as Occupancy;
    expect(first).toEqual(detectedB);
    expect(first).not.toBe(second);
    first.speaker.x = 0.99;
    expect(await replay.measure({atSec: at})).toEqual(detectedB);
  });

  it('an unrecorded instant is refused: no live measurement, no default box, no nearest neighbour', async () => {
    const replay = replayMeasurer(good());
    await expect(replay.measure({atSec: 12.34})).rejects.toBeInstanceOf(SnapshotReplayError);
    await expect(replay.measure({atSec: 12.34})).rejects.toThrow(/refusing to measure live, fall back, or reuse another measurement/);
    expect(replay.requests).toEqual([12.34, 12.34]);
  });

  it('reports recorded measurements that were never requested', async () => {
    const replay = replayMeasurer(good());
    expect(replay.unserved()).toEqual(['s0', 's1']);
    await replay.measure({atSec: good().measurements.find(item => item.id === 's0')!.sourceSec});
    expect(replay.unserved()).toEqual(['s1']);
  });

  it('the primary is supplied separately and is not served as a sampled measurement', async () => {
    const snapshot = good();
    expect(primaryOccupancyInput(snapshot)).toEqual({occupancy: detectedA, outputSec: primaryOutput});
    await expect(replayMeasurer(snapshot).measure({atSec: occupancySampleSec(SOURCE_SEC)})).rejects.toBeInstanceOf(SnapshotReplayError);
  });
});

describe('both arms receive identical occupancy through the REAL perception code', () => {
  /** One arm: a fresh replay of the snapshot driven through the real buildPerceptionPack, with the flag set as the arm requires. */
  const arm = async (snapshot: OccupancySnapshot, flagOn: boolean) => {
    e.OCCUPANCY_CONTEXT_V2 = flagOn;
    const replay = replayMeasurer(snapshot);
    holder.measure = replay.measure;
    const pack = await buildPerceptionPack({
      captionWords: [{text: 'a', start: 0, end: 1, sentenceIndex: 0}], sourceWords: [{text: 'a', start: 0, end: 1}], transcript: 'a',
      timeline, sourcePath: '/dev/null', stillDir: (name: string) => `/tmp/${name}`, visualContext: false,
      primaryOccupancy: primaryOccupancyInput(snapshot)?.occupancy, activeSourceDurationSec: SOURCE_SEC,
    } as never);
    return {pack, replay};
  };

  it('fidelity: the pack the real code builds from a replay equals the pack derived from the snapshot', async () => {
    const snapshot = good();
    const {pack, replay} = await arm(snapshot, false);
    const expected = packOccupancyFromSnapshot(snapshot);
    expect(stable(pack.occupancySlices)).toBe(stable(expected.occupancySlices));
    expect(stable(pack.occupancyMeasured)).toBe(stable(expected.occupancyMeasured));
    expect(stable(pack.occupancyMeasurements)).toBe(stable(expected.occupancyMeasurements));
    expect(pack.outputDurationSec).toBeCloseTo(expected.outputDurationSec, 9);
    expect(replay.unserved()).toEqual([]);
    expect(replay.requests).toHaveLength(2);
  });

  it('arm A (flag off) and arm B (flag on) receive byte-identical occupancy data; the check passes only when they do', async () => {
    const snapshot = good();
    const a = await arm(snapshot, false);
    const b = await arm(snapshot, true);
    expect(occupancyInputDigest(a.pack)).toBe(occupancyInputDigest(b.pack));
    const check = checkArmsReceivedSnapshot(snapshot, [{label: 'A', pack: a.pack}, {label: 'B', pack: b.pack}]);
    expect(check.problems).toEqual([]);
    expect(check.identical).toBe(true);
    expect(check.digests.A).toBe(check.digests.B);
    expect(check.digests.A).toBe(check.expectedDigest);
    expect(check.independentSeen).toEqual({A: 3, B: 3});
  });

  it('the wording differs between the arms; the data does not', async () => {
    const snapshot = good();
    const a = await arm(snapshot, false);
    const textOff = formatOccupancySlices(a.pack);
    e.OCCUPANCY_CONTEXT_V2 = true;
    const textOn = formatOccupancySlices(a.pack);
    expect(textOn).not.toBe(textOff);
    expect(textOn).toMatch(/3 independent measurements/);
    expect(textOn).toMatch(/speaker position UNKNOWN: detection failed/);
    expect(occupancyInputDigest(a.pack)).toBe(checkArmsReceivedSnapshot(snapshot, [{label: 'A', pack: a.pack}, {label: 'B', pack: a.pack}]).expectedDigest);
  });

  it('a changed snapshot given to one arm invalidates the comparison, whichever way it changed', async () => {
    const snapshot = good();
    const a = await arm(snapshot, false);
    const edits: Array<[string, (s: Record<string, any>) => void]> = [
      ['a different box', s => { s.measurements[1].occupancy = occupancyFromSpeaker({x: 0.1, y: 0.1, w: 0.5, h: 0.7}, 'vision'); }],
      ['a detected measurement replaced by a fallback', s => { s.measurements[1].occupancy = occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback'); }],
      ['a fallback relabelled as detected', s => { s.measurements[2].occupancy.source = 'vision'; }],
      ['a recorded output time that disagrees with where the pipeline places the measurement', s => { s.measurements[2].outputSec = 31.5; }],
    ];
    for (const [name, edit] of edits) {
      const other = reseal(clone((() => { const c = clone(snapshot) as Record<string, any>; edit(c); return c; })())) as unknown as OccupancySnapshot;
      const b = await arm(other, true);
      // Checked against B's OWN snapshot the arms never match it (and the snapshot hashes differ, which the manifest comparison also rejects).
      expect(other.contentSha256, name).not.toBe(snapshot.contentSha256);
      expect(checkArmsReceivedSnapshot(other, [{label: 'A', pack: a.pack}, {label: 'B', pack: b.pack}]).identical, name).toBe(false);
      // Checked against the original snapshot, every edit that changes the DATA B received is caught; a metadata-only edit
      // (the recorded output time) leaves B's data equal to A's, so only the two checks above reveal it.
      const against = checkArmsReceivedSnapshot(snapshot, [{label: 'A', pack: a.pack}, {label: 'B', pack: b.pack}]);
      if (!name.includes('recorded output time')) {
        expect(against.identical, name).toBe(false);
        expect(against.problems.join('\n'), name).toContain('B');
      }
    }
  });

  it('a shifted measurement instant makes the replay refuse (the arm fails; it does not measure or substitute)', async () => {
    const shifted = reseal(clone((() => { const c = clone(good()) as Record<string, any>; c.measurements[1].sourceSec += 1; c.measurements[1].outputSec += 1; return c; })())) as unknown as OccupancySnapshot;
    await expect(arm(shifted, true)).rejects.toBeInstanceOf(SnapshotReplayError);
  });

  it('one arm missing a measurement the other has is flagged', async () => {
    const snapshot = good();
    const a = await arm(snapshot, false);
    const b = await arm(snapshot, true);
    const truncated = {...b.pack, occupancyMeasured: b.pack.occupancyMeasured!.slice(0, 2)};
    const check = checkArmsReceivedSnapshot(snapshot, [{label: 'A', pack: a.pack}, {label: 'B', pack: truncated}]);
    expect(check.identical).toBe(false);
    expect(check.problems.join('\n')).toContain('arm B saw 2 independent measurements; the snapshot has 3');
  });

  it('a pack with occupancy slices but no independent measurement behind them is flagged, and a single arm is not a comparison', async () => {
    const snapshot = good();
    const a = await arm(snapshot, false);
    const hollow = {...a.pack, occupancyMeasured: [], occupancyMeasurements: []};
    expect(checkArmsReceivedSnapshot(snapshot, [{label: 'A', pack: a.pack}, {label: 'B', pack: hollow}]).problems.join('\n')).toContain('no independent measurements behind them');
    expect(checkArmsReceivedSnapshot(snapshot, [{label: 'A', pack: a.pack}]).problems).toContain('an occupancy comparison needs at least two arms');
  });

  it('a missing required snapshot cannot be replaced by live measurement: the arm fails instead of measuring', async () => {
    const snapshot = good();
    const incomplete = captureSnapshot({...goodInput(), measurements: goodInput().measurements.slice(0, 2)});
    await expect(arm(incomplete, false)).rejects.toBeInstanceOf(SnapshotReplayError);
    expect(snapshot.measurements).toHaveLength(3);
  });

  it('unknown stays unknown in both arms: fallback-only data confirms visibility nowhere', async () => {
    const fallbackOnly = captureSnapshot(fixture({primary: fallbackBox, sampled: [fallbackBox, fallbackBox]}, {id: 'synthetic-fallback-only'}));
    const a = await arm(fallbackOnly, false);
    const b = await arm(fallbackOnly, true);
    expect(checkArmsReceivedSnapshot(fallbackOnly, [{label: 'A', pack: a.pack}, {label: 'B', pack: b.pack}]).identical).toBe(true);
    for (const pack of [a.pack, b.pack]) {
      expect(speakerVisibleRanges(pack.occupancySlices)).toEqual([]);
      e.OCCUPANCY_CONTEXT_V2 = true;
      expect(confirmedVisibilityText(pack)).toMatch(/^unknown: visibility is not confirmed at any time/);
      expect(formatOccupancySlices(pack)).not.toMatch(/DETECTED/);
    }
  });

  it('repeated measurements stay repeated in both arms: they add no independent measurement and no new line', async () => {
    const withRepeat = captureSnapshot({
      ...goodInput(),
      measurements: [...goodInput().measurements, {id: 's0-again', role: 'sampled', sourceSec: outputToSourceSec(KEEP, sampledOutputTimes[0]!), outputSec: sampledOutputTimes[0]!, occupancy: detectedB, repeatOf: 's0'}],
    });
    const a = await arm(withRepeat, false);
    const b = await arm(withRepeat, true);
    expect(checkArmsReceivedSnapshot(withRepeat, [{label: 'A', pack: a.pack}, {label: 'B', pack: b.pack}]).independentSeen).toEqual({A: 3, B: 3});
    e.OCCUPANCY_CONTEXT_V2 = true;
    const lines = formatOccupancySlices(b.pack).split('\n').filter(line => line.startsWith('@'));
    expect(lines).toHaveLength(3);
    expect(new Set(lines.map(line => line.split(' ')[0])).size).toBe(3);
    // the replay never asked for the repeat as a separate measurement
    expect(a.replay.requests).toHaveLength(2);
  });
});

describe('v1 path: the same primary measurement reaches the real request builder in both arms', () => {
  const request = async (snapshot: OccupancySnapshot, flagOn: boolean) => {
    e.OCCUPANCY_CONTEXT_V2 = flagOn;
    e.GEMINI_API_KEY = 'test-key-offline';
    const {planVisualDirection} = await import('../stages/broll/geminiDirector.ts');
    const primary = primaryOccupancyInput(snapshot)!;
    await planVisualDirection({transcript: 'Quiet moments speak. We explore silence.', sourceDurationSec: 30, momentCount: 2, occupancy: primary.occupancy, occupancyAtSec: primary.outputSec});
    return holder.bodies.at(-1)!;
  };

  it('both arms get the same box and instant; only the wording of the occupancy block differs; a fallback primary is a default in the flagged arm', async () => {
    const snapshot = good();
    const off = await request(snapshot, false);
    const on = await request(snapshot, true);
    const textOff: string = off.contents[0].parts[0].text;
    const textOn: string = on.contents[0].parts[0].text;
    expect(textOff).toContain('x=0.20 y=0.10 w=0.60 h=0.70');
    expect(textOn).toContain('x=0.20 y=0.10 w=0.60 h=0.70');
    expect(textOn).toContain(`at ${primaryOutput!.toFixed(1)}s`);
    expect(off.systemInstruction).toEqual(on.systemInstruction);
    expect(off.generationConfig).toEqual(on.generationConfig);
    const fallbackPrimary = captureSnapshot(fixture({primary: fallbackBox, sampled: [detectedB, detectedB]}, {id: 'synthetic-fallback-primary'}));
    const unknownArm = await request(fallbackPrimary, true);
    expect(unknownArm.contents[0].parts[0].text).toContain('speaker position UNKNOWN: detection failed');
  });
});

describe('occupancyReplaySource: the object handed to the real pipeline', () => {
  it('refuses an invalid or tampered snapshot at construction, before anything can run', () => {
    expect(() => occupancyReplaySource(null as never)).toThrow(SnapshotError);
    const tampered = mutate(s => { s.measurements[0].occupancy = occupancyFromSpeaker({x: 0.3, y: 0.1, w: 0.5, h: 0.7}, 'vision'); }, false);
    expect(() => occupancyReplaySource(tampered as never)).toThrow(SnapshotError);
  });

  it('serves the primary only at the exact recorded instant and the samples only at theirs; every other request throws and is ledgered', () => {
    const snapshot = good();
    const source = occupancyReplaySource(snapshot);
    const primary = snapshot.measurements.find(item => item.role === 'primary')!;
    expect(source.primary({sampleSourceSec: primary.sourceSec, durationSec: 48.72})).toEqual(primary.occupancy);
    expect(() => source.primary({sampleSourceSec: primary.sourceSec + 0.5, durationSec: 48.72})).toThrow(OccupancyReplayError);
    expect(() => source.at({atSec: 1.234, durationSec: 48.72})).toThrow(/refusing to measure live, fall back, or reuse another measurement/);
    const sampled = snapshot.measurements.find(item => item.id === 's0')!;
    const served = source.at({atSec: sampled.sourceSec, durationSec: 48.72}) as Occupancy;
    expect(served).toEqual(sampled.occupancy);
    served.speaker.x = 0.99; // a caller cannot alter the recorded data
    expect(source.at({atSec: sampled.sourceSec, durationSec: 48.72})).toEqual(sampled.occupancy);
    expect(source.ledger.requests.map(request => request.outcome)).toEqual(['served', 'mismatch', 'miss', 'served', 'served']);
    expect(source.ledger.violations).toHaveLength(2);
    expect(source.unserved()).toEqual(['s1']);
  });

  it('a snapshot without a primary cannot serve the primary request', () => {
    const noPrimary = captureSnapshot({...goodInput(), measurements: goodInput().measurements.filter(item => item.role !== 'primary')});
    expect(() => occupancyReplaySource(noPrimary).primary({sampleSourceSec: 3, durationSec: 12})).toThrow(/has no primary measurement/);
  });

  it('repeats are not served as measurements and not counted as unserved', () => {
    const withRepeat = captureSnapshot({
      ...goodInput(),
      measurements: [...goodInput().measurements, {id: 'again', role: 'sampled', sourceSec: outputToSourceSec(KEEP, sampledOutputTimes[0]!), outputSec: sampledOutputTimes[0]!, occupancy: detectedB, repeatOf: 's0'}],
    });
    const source = occupancyReplaySource(withRepeat);
    expect(source.unserved().sort()).toEqual(['p', 's0', 's1']);
  });

  it('exposes the identity recorded as consumed evidence', () => {
    const source = occupancyReplaySource(good());
    expect(source.id).toBe('synthetic-hi-1');
    expect(source.contentSha256).toBe(good().contentSha256);
  });
});
