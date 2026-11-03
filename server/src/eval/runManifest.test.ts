import {describe, expect, it} from 'vitest';

import {checks, compareManifests, FLAG_DOMAINS, isUnknown, REQUIRED_FLAGS, REQUIRED_PROVENANCE_PATHS, REQUIRED_SETTINGS, stable, unknown, validateManifest, type RunManifest} from './runManifest.ts';

const HEX = (c: string) => c.repeat(64);

const base = (over: Record<string, unknown> = {}): RunManifest =>
  ({
    manifestVersion: 1,
    run: {id: 'r1', arm: 'A', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete'},
    stages: [
      {id: 'transcribe', startedAt: '2026-10-11T00:00:00Z', endedAt: '2026-10-11T00:00:05Z', status: 'ok'},
      {id: 'director', startedAt: '2026-10-11T00:00:05Z', endedAt: '2026-10-11T00:00:20Z', status: 'ok'},
      {id: 'render', startedAt: '2026-10-11T00:00:20Z', endedAt: '2026-10-11T00:01:00Z', status: 'ok'},
    ],
    source: {videoSha256: HEX('a'), durationSec: 48.72, sizeBytes: 6070697, trim: [{sourceStart: 0, sourceEnd: 4.16, outputStart: 0}], transcriptSha256: HEX('b')},
    pipeline: {headCommit: 'c'.repeat(40), treeSha256: HEX('d'), dirtyFileCount: 40, path: 'v1', nodeVersion: 'v24.5.0'},
    models: {director: {id: 'gemini-3.6-flash', temperature: 0.45}, motionDirector: null, graphicsWorker: null, transcription: {id: 'asr-1'}},
    prompts: {directorSystemSha256: HEX('1'), directorSchemaSha256: HEX('5'), promptFilesSha256: HEX('2'), contentProfileBlockSha256: HEX('3')},
    flags: {HOOK_TITLE_POLICY: 'placeholder', OCCUPANCY_CONTEXT_V2: false, VISUAL_CONTEXT_V2: false, GENERATED_TRANSITIONS_ENABLED: false, DIRECTOR_V2: false, NORTH_STAR: false, PIPELINE_MODE: 'lean', ZOOM_SCALE: 1.25, MOTION_GRAPHICS_ENABLED: false, CONTENT_PROFILE_ENABLED: true, HOOK_DURATION_SEC: 3, BROLL_MOMENT_COUNT: 5, GEMINI_MODEL: 'gemini-3.6-flash'},
    occupancy: {mode: 'replay', snapshotSha256: HEX('c'), receivedDigestSha256: HEX('4')},
    visualContext: {enabled: false, frameTimesOutputSec: [0.4, 1.9], imagesAttached: 8},
    broll: {mode: 'creator', assets: [{id: 'ub', sha256: HEX('e')}], stockFrozen: true},
    renderer: {engine: 'local', remotionVersion: '4.0.524', fps: 30, width: 1080, height: 1920, codec: 'h264'},
    rubric: {version: 'phase14', sha256: HEX('f')},
    outputs: [{kind: 'render', path: 'a.mp4', sha256: HEX('7')}],
    ...over,
  }) as RunManifest;

const withPath = (m: RunManifest, path: string, value: unknown): RunManifest => {
  const copy = JSON.parse(JSON.stringify(m));
  const parts = path.split('.');
  let node = copy;
  for (const part of parts.slice(0, -1)) {
    node = node[part];
  }
  if (value === undefined) {
    delete node[parts.at(-1)!];
  } else {
    node[parts.at(-1)!] = value;
  }
  return copy;
};

/** The B arm: another run, labelled B, with one field changed. */
const armB = (path: string, value: unknown, m: RunManifest = base()): RunManifest => withPath(withPath(withPath(m, 'run.id', 'r2'), 'run.arm', 'B'), path, value);
const PROMPT_B = HEX('9');
const reasons = (a: unknown, b: unknown, declared: string[], mode?: 'ab' | 'repeat') => compareManifests(a, b, declared, mode ? {mode} : {}).reasons;

describe('manifest validity: missing vs invalid vs unknown', () => {
  it('a complete manifest is valid with nothing unknown', () => {
    expect(validateManifest(base())).toEqual({valid: true, missing: [], invalid: [], unknownFields: []});
  });

  it.each([...REQUIRED_PROVENANCE_PATHS])('absence of %s makes the manifest invalid', path => {
    const result = validateManifest(withPath(base(), path, undefined));
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(path);
  });

  it('an explicit unknown is valid (it is a statement, not an omission) but is reported', () => {
    const result = validateManifest(withPath(base(), 'source.videoSha256', unknown('source file not available locally')));
    expect(result).toEqual({valid: true, missing: [], invalid: [], unknownFields: ['source.videoSha256']});
  });

  it('an unknown nested inside a value (one asset hash) or inside flags is reported', () => {
    expect(validateManifest(withPath(base(), 'broll.assets', [{id: 'ub', sha256: unknown('not hashed')}])).unknownFields).toEqual(['broll.assets[0].sha256']);
    expect(validateManifest(withPath(base(), 'flags.VISUAL_CONTEXT_V2', unknown('env not recorded'))).unknownFields).toEqual(['flags.VISUAL_CONTEXT_V2']);
  });

  it('rejects non-manifests', () => {
    expect(validateManifest(null).valid).toBe(false);
    expect(validateManifest({manifestVersion: 2}).valid).toBe(false);
  });

  it('an unknown with no reason is malformed, not a statement', () => {
    expect(validateManifest(withPath(base(), 'source.videoSha256', {$unknown: ''})).invalid).toEqual([{path: 'source.videoSha256', reason: 'an unknown value must give a non-empty reason'}]);
    expect(validateManifest(withPath(base(), 'source.videoSha256', {$unknown: '   '})).valid).toBe(false);
  });
});

describe('negative: null, empty, malformed and wrongly typed values are invalid, never "known"', () => {
  const SHA_PATHS = ['source.videoSha256', 'source.transcriptSha256', 'pipeline.treeSha256', 'prompts.directorSystemSha256', 'prompts.promptFilesSha256', 'prompts.contentProfileBlockSha256', 'rubric.sha256'];
  const BAD_SHAS: Array<[string, unknown]> = [['null', null], ['empty', ''], ['whitespace', '   '], ['too short', 'abc123'], ['63 chars', 'a'.repeat(63)], ['65 chars', 'a'.repeat(65)], ['uppercase', 'A'.repeat(64)], ['non-hex', 'g'.repeat(64)], ['a number', 12345], ['an object', {}], ['an array', ['a']], ['a boolean', true]];

  it.each(SHA_PATHS.flatMap(path => BAD_SHAS.map(([name, value]) => [path, name, value] as const)))('%s rejects %s', (path, _name, value) => {
    const result = validateManifest(withPath(base(), path, value));
    expect(result.valid).toBe(false);
    expect(result.invalid.map(item => item.path)).toContain(path);
  });

  it.each([
    ['source.durationSec', [null, '', 0, -1, NaN, Infinity, '48']],
    ['source.sizeBytes', [null, 0, -5, 1.5, '100']],
    ['source.trim', [null, [], 'x', [{sourceStart: 5, sourceEnd: 5, outputStart: 0}], [{sourceStart: 0, sourceEnd: 4}], [{sourceStart: -1, sourceEnd: 2, outputStart: 0}]]],
    ['pipeline.headCommit', [null, '', 'abc', 'C'.repeat(40), 'c'.repeat(41)]],
    ['pipeline.dirtyFileCount', [null, -1, 1.5, '3']],
    ['pipeline.path', [null, '', 'v3', 'V1']],
    ['pipeline.nodeVersion', [null, '', 'node', '24']],
    ['visualContext.enabled', [null, 'false', 0]],
    ['visualContext.frameTimesOutputSec', [null, 'x', [-1], [NaN], ['1']]],
    ['visualContext.imagesAttached', [null, -1, 2.5]],
    ['broll.mode', [null, '', 'both']],
    ['broll.stockFrozen', [null, 'true']],
    ['renderer.engine', [null, '', '  ']],
    ['renderer.remotionVersion', [null, '', 'latest']],
    ['renderer.fps', [null, 0, 29.97, '30']],
    ['renderer.width', [null, 0, -1080]],
    ['renderer.height', [null, 0, 1920.5]],
    ['renderer.codec', [null, '']],
    ['rubric.version', [null, '']],
    ['run.id', [null, '']],
    ['run.arm', [null, '']],
    ['run.repeat', [null, -1, 1.2]],
    ['run.createdAt', [null, '', 'yesterday', 12]],
  ] as Array<[string, unknown[]]>)('%s rejects malformed values', (path, values) => {
    for (const value of values) {
      const result = validateManifest(withPath(base(), path, value));
      expect(result.valid, `${path}=${JSON.stringify(value)}`).toBe(false);
      expect(result.invalid.map(item => item.path), `${path}=${JSON.stringify(value)}`).toContain(path);
    }
  });

  it('models: null means "stage not included"; a present model needs a non-empty id; unknown is explicit', () => {
    expect(validateManifest(withPath(base(), 'models.motionDirector', null)).valid).toBe(true);
    for (const value of ['', 'gemini', {}, {id: ''}, {id: '  '}, {id: 5}, []]) {
      expect(validateManifest(withPath(base(), 'models.director', value)).invalid.map(item => item.path), JSON.stringify(value)).toContain('models.director');
    }
    expect(validateManifest(withPath(base(), 'models.director', unknown('not recorded'))).unknownFields).toContain('models.director');
  });

  it('prompt hashes are required when the corresponding model-backed stage is included, and may be null only when it is not', () => {
    const noDirector = withPath(withPath(withPath(base(), 'models.director', null), 'prompts.directorSystemSha256', null), 'prompts.contentProfileBlockSha256', null);
    expect(validateManifest(noDirector)).toMatchObject({valid: true, invalid: []});
    const noPromptModels = withPath(noDirector, 'prompts.promptFilesSha256', null);
    expect(validateManifest(noPromptModels)).toMatchObject({valid: true, invalid: []});
    // Director included but its prompt hash null -> invalid
    expect(validateManifest(withPath(base(), 'prompts.directorSystemSha256', null)).invalid[0]).toMatchObject({path: 'prompts.directorSystemSha256'});
    expect(validateManifest(withPath(base(), 'prompts.promptFilesSha256', null)).invalid[0]).toMatchObject({path: 'prompts.promptFilesSha256'});
    // A motion-director stage alone also requires the prompt-files hash.
    expect(validateManifest(withPath(withPath(noPromptModels, 'models.motionDirector', {id: 'm-1'}), 'prompts.promptFilesSha256', null)).invalid.map(item => item.path)).toContain('prompts.promptFilesSha256');
    // The content-profile block may be null only when the profile is disabled (or no Director runs).
    expect(validateManifest(withPath(base(), 'prompts.contentProfileBlockSha256', null)).invalid[0]).toMatchObject({path: 'prompts.contentProfileBlockSha256'});
    expect(validateManifest(withPath(withPath(base(), 'prompts.contentProfileBlockSha256', null), 'flags.CONTENT_PROFILE_ENABLED', false)).valid).toBe(true);
  });

  it('every required flag and setting must be in its allowed domain', () => {
    const bad: Record<string, unknown[]> = {
      HOOK_TITLE_POLICY: [null, '', 'Optional', 'on', true, 'WATCH THIS'],
      OCCUPANCY_CONTEXT_V2: [null, 'false', 0, 'true'],
      VISUAL_CONTEXT_V2: [null, 'yes'],
      GENERATED_TRANSITIONS_ENABLED: [null, 1],
      DIRECTOR_V2: [null, 'no'],
      NORTH_STAR: [null, ''],
      PIPELINE_MODE: [null, '', 'Lean', 'fast'],
      ZOOM_SCALE: [null, 0, -1, '1.25', NaN],
      MOTION_GRAPHICS_ENABLED: [null, 'false'],
      CONTENT_PROFILE_ENABLED: [null, 'true'],
      HOOK_DURATION_SEC: [null, 0, -3, '3'],
      BROLL_MOMENT_COUNT: [null, 0, 2.5, '5'],
      GEMINI_MODEL: [null, '', '  ', 7],
    };
    expect(Object.keys(bad).sort()).toEqual([...REQUIRED_FLAGS, ...REQUIRED_SETTINGS].sort());
    for (const [name, values] of Object.entries(bad)) {
      for (const value of values) {
        const result = validateManifest(withPath(base(), `flags.${name}`, value));
        expect(result.valid, `${name}=${JSON.stringify(value)}`).toBe(false);
        expect(result.invalid.map(item => item.path), `${name}=${JSON.stringify(value)}`).toContain(`flags.${name}`);
      }
    }
    expect(Object.keys(FLAG_DOMAINS).sort()).toEqual([...REQUIRED_FLAGS, ...REQUIRED_SETTINGS].sort());
    expect(validateManifest(withPath(base(), 'flags.HOOK_TITLE_POLICY', 'optional')).valid).toBe(true);
    expect(validateManifest(withPath(base(), 'flags.PIPELINE_MODE', 'full')).valid).toBe(true);
  });

  it.each([...REQUIRED_SETTINGS])('a manifest that does not state the setting %s is invalid', name => {
    expect(validateManifest(withPath(base(), `flags.${name}`, undefined)).missing).toContain(`flags.${name}`);
  });

  it('extra flags must be scalars (no null, objects or arrays)', () => {
    expect(validateManifest(withPath(base(), 'flags.EXTRA', true)).valid).toBe(true);
    for (const value of [null, {a: 1}, [1]]) {
      expect(validateManifest(withPath(base(), 'flags.EXTRA', value)).invalid.map(item => item.path)).toContain('flags.EXTRA');
    }
  });

  it('flags must be an object (or an explicit unknown)', () => {
    for (const value of [null, 'lean', [], 5]) {
      expect(validateManifest(withPath(base(), 'flags', value)).invalid.map(item => item.path)).toContain('flags');
    }
  });
});

describe('B-roll assets and outputs', () => {
  it('assets: a mode other than "none" must list assets, each with an id and a valid hash (or an explicit unknown)', () => {
    expect(validateManifest(withPath(base(), 'broll.assets', [])).invalid.map(item => item.path)).toContain('broll.assets');
    expect(validateManifest(withPath(base(), 'broll.assets', [{id: 'ub'}])).missing).toEqual(['broll.assets[0].sha256']);
    for (const sha of [null, '', 'abc', 'A'.repeat(64), 7]) {
      expect(validateManifest(withPath(base(), 'broll.assets', [{id: 'ub', sha256: sha}])).invalid.map(item => item.path), String(sha)).toContain('broll.assets[0].sha256');
    }
    for (const id of [undefined, '', '  ', 3]) {
      expect(validateManifest(withPath(base(), 'broll.assets', [{id, sha256: HEX('a')}])).invalid.map(item => item.path)).toContain('broll.assets[0].id');
    }
    expect(validateManifest(withPath(base(), 'broll.assets', [{id: 'x', sha256: HEX('a')}, {id: 'x', sha256: HEX('b')}])).invalid[0]).toMatchObject({reason: 'duplicate asset id x'});
    expect(validateManifest(withPath(base(), 'broll.assets', 'ub')).invalid.map(item => item.path)).toContain('broll.assets');
    expect(validateManifest(withPath(base(), 'broll.assets', unknown('assets not recorded'))).unknownFields).toContain('broll.assets');
  });

  it('assets: mode "none" must have no assets, and then needs none', () => {
    expect(validateManifest(withPath(withPath(base(), 'broll.mode', 'none'), 'broll.assets', [])).valid).toBe(true);
    expect(validateManifest(withPath(base(), 'broll.mode', 'none')).invalid.map(item => item.path)).toContain('broll.assets');
  });

  it('outputs: kind, path and hash are required and valid; an explicit unknown hash is allowed but blocks comparison; paths are unique', () => {
    expect(validateManifest(withPath(base(), 'outputs', [{kind: 'render', path: 'a.mp4'}])).missing).toEqual(['outputs[0].sha256']);
    expect(validateManifest(withPath(base(), 'outputs', [{path: 'a.mp4', sha256: HEX('7')}])).missing).toEqual(['outputs[0].kind']);
    expect(validateManifest(withPath(base(), 'outputs', [{kind: 'render', sha256: HEX('7')}])).missing).toEqual(['outputs[0].path']);
    for (const sha of [null, '', 'o1', 'A'.repeat(64)]) {
      expect(validateManifest(withPath(base(), 'outputs', [{kind: 'render', path: 'a.mp4', sha256: sha}])).invalid.map(item => item.path), String(sha)).toContain('outputs[0].sha256');
    }
    for (const field of ['kind', 'path']) {
      const output = {kind: 'render', path: 'a.mp4', sha256: HEX('7'), [field]: ''};
      expect(validateManifest(withPath(base(), 'outputs', [output])).invalid.map(item => item.path)).toContain(`outputs[0].${field}`);
    }
    expect(validateManifest(withPath(base(), 'outputs', 'a.mp4')).invalid.map(item => item.path)).toContain('outputs');
    expect(validateManifest(withPath(base(), 'outputs', [null])).invalid.map(item => item.path)).toContain('outputs[0]');
    expect(validateManifest(withPath(base(), 'outputs', [{kind: 'render', path: 'a.mp4', sha256: HEX('7')}, {kind: 'still', path: 'a.mp4', sha256: HEX('8')}])).invalid[0]).toMatchObject({reason: 'duplicate output path a.mp4'});
    const unknownHash = withPath(base(), 'outputs', [{kind: 'render', path: 'a.mp4', sha256: unknown('render not hashed')}]);
    expect(validateManifest(unknownHash)).toMatchObject({valid: true, unknownFields: ['outputs[0].sha256']});
    expect(reasons(unknownHash, armB('prompts.directorSystemSha256', PROMPT_B), ['prompts.directorSystemSha256'])).toContain('A has an output whose hash is unknown; its provenance cannot be established');
  });
});

describe('malformed manifests can never be classified as comparable or repeat', () => {
  const A = base();
  const MUTATIONS: Array<[string, string, unknown]> = [
    ['null source hash', 'source.videoSha256', null],
    ['empty source hash', 'source.videoSha256', ''],
    ['malformed tree hash', 'pipeline.treeSha256', 'tree1'],
    ['malformed commit', 'pipeline.headCommit', 'abc'],
    ['null model', 'models.director', ''],
    ['empty codec', 'renderer.codec', ''],
    ['bad flag domain', 'flags.HOOK_TITLE_POLICY', 'on'],
    ['asset without a hash', 'broll.assets', [{id: 'ub', sha256: null}]],
    ['output with an empty hash', 'outputs', [{kind: 'render', path: 'a.mp4', sha256: ''}]],
  ];
  it.each(MUTATIONS)('B has a %s: not comparable, with the invalid field named', (_name, path, value) => {
    const B = armB('prompts.directorSystemSha256', PROMPT_B, withPath(base(), path, value));
    const result = compareManifests(A, B, ['prompts.directorSystemSha256']);
    expect(result.verdict).toBe('not_comparable');
    expect(result.reasons.join('\n')).toMatch(/^B (has an invalid|is missing) /m);
    expect(Object.values(result.fields)).toContain('invalid');
  });

  it.each(MUTATIONS)('the same mutation on A (%s) is also rejected, and as a repeat', (_name, path, value) => {
    const bad = withPath(base(), path, value);
    const B = withPath(withPath(base(), 'run.id', 'r2'), 'run.repeat', 1);
    expect(compareManifests(bad, armB('prompts.directorSystemSha256', PROMPT_B), ['prompts.directorSystemSha256']).verdict).toBe('not_comparable');
    expect(compareManifests(bad, B, [], {mode: 'repeat'}).verdict).toBe('not_comparable');
  });

  it('two manifests that are both all-null/empty (the Phase 19 probe) are not comparable', () => {
    const nulls = (m: RunManifest): RunManifest => {
      let out = m;
      for (const path of REQUIRED_PROVENANCE_PATHS.filter(item => item !== 'flags')) {
        out = withPath(out, path, null);
      }
      return out;
    };
    const result = compareManifests(nulls(A), armB('prompts.directorSystemSha256', null, nulls(A)), ['prompts.directorSystemSha256']);
    expect(result.verdict).toBe('not_comparable');
    expect(result.reasons.length).toBeGreaterThan(10);
  });
});

describe('comparison rules', () => {
  const A = base();
  it('differs only in the declared variable → comparable; run identity and outputs are ignored', () => {
    const B = armB('prompts.directorSystemSha256', PROMPT_B, withPath(base(), 'outputs', [{kind: 'render', path: 'b.mp4', sha256: HEX('8')}]));
    const result = compareManifests(A, B, ['prompts.directorSystemSha256']);
    expect(result).toMatchObject({verdict: 'comparable', reasons: [], differing: ['prompts.directorSystemSha256'], declaredVariables: ['prompts.directorSystemSha256']});
    expect(result.fields['prompts.directorSystemSha256']).toBe('known_mismatch');
    expect(result.fields['source.videoSha256']).toBe('known_match');
  });

  it.each([
    ['flags.HOOK_TITLE_POLICY', 'optional'],
    ['flags.OCCUPANCY_CONTEXT_V2', true],
    ['flags.VISUAL_CONTEXT_V2', true],
  ])('a single flag (%s) can be the declared variable', (path, value) => {
    expect(compareManifests(A, armB(path, value), [path]).verdict).toBe('comparable');
  });

  it('rejects when a factor other than the declared variable differs', () => {
    const B = armB('models.director', {id: 'gemini-3.7-flash', temperature: 0.45}, withPath(base(), 'prompts.directorSystemSha256', PROMPT_B));
    const result = compareManifests(A, B, ['prompts.directorSystemSha256']);
    expect(result.verdict).toBe('not_comparable');
    expect(result.reasons).toEqual(['models.director differs but is not the declared variable']);
  });

  it.each([
    ['a different source video', 'source.videoSha256', 'e'.repeat(64)],
    ['different trims', 'source.trim', [{sourceStart: 1, sourceEnd: 3, outputStart: 0}]],
    ['a different code state', 'pipeline.treeSha256', HEX('5')],
    ['different assets', 'broll.assets', [{id: 'ub', sha256: HEX('6')}]],
    ['an unfrozen stock search', 'broll.stockFrozen', false],
    ['a different renderer', 'renderer.codec', 'h265'],
    ['a different rubric', 'rubric.version', 'phase15'],
    ['a different extra flag', 'flags.GENERATED_TRANSITIONS_ENABLED', true],
    ['a different setting', 'flags.ZOOM_SCALE', 1.4],
    ['different image count', 'visualContext.imagesAttached', 10],
  ])('rejects %s', (_name, path, value) => {
    const B = armB(path, value, withPath(base(), 'prompts.directorSystemSha256', PROMPT_B));
    const result = compareManifests(A, B, ['prompts.directorSystemSha256']);
    expect(result.verdict).toBe('not_comparable');
    expect(result.reasons.join()).toContain(path);
  });

  it('never calls runs comparable when a required value is unknown — even if the other run has the same unknown', () => {
    const unk = unknown('source not available locally');
    const A2 = withPath(base(), 'source.videoSha256', unk);
    const B2 = armB('prompts.directorSystemSha256', PROMPT_B, withPath(base(), 'source.videoSha256', unk));
    const result = compareManifests(A2, B2, ['prompts.directorSystemSha256']);
    expect(result.verdict).toBe('not_comparable');
    expect(result.reasons[0]).toContain('source.videoSha256 is unknown in both runs');
    expect(isUnknown(unk)).toBe(true);
  });

  it('rejects when the declared variable itself is unknown in either run', () => {
    expect(compareManifests(A, armB('prompts.directorSystemSha256', unknown('prompt hash not recorded')), ['prompts.directorSystemSha256']).verdict).toBe('not_comparable');
  });

  it('the declared variable must actually differ', () => {
    const B = armB('run.createdAt', '2026-10-12T00:00:00Z');
    expect(reasons(A, B, ['prompts.directorSystemSha256'])).toContain('declared variable prompts.directorSystemSha256 does not differ');
    expect(compareManifests(A, B, ['prompts.directorSystemSha256']).verdict).toBe('not_comparable');
  });

  it('rejects an invalid manifest (missing field) on either side, and an A/B with no declared variable', () => {
    const broken = withPath(base(), 'renderer.fps', undefined);
    expect(compareManifests(A, armB('prompts.directorSystemSha256', PROMPT_B, broken), ['prompts.directorSystemSha256'])).toMatchObject({verdict: 'not_comparable', reasons: ['B is missing renderer.fps']});
    expect(compareManifests(broken, A, ['prompts.directorSystemSha256']).reasons).toContain('A is missing renderer.fps');
    expect(reasons(A, armB('run.id', 'r9'), [])[0]).toContain('no declared variable');
  });

  it('rejects two declared variables when only one differs, and unknown variable names', () => {
    const B = armB('prompts.directorSystemSha256', PROMPT_B);
    expect(reasons(A, B, ['prompts.directorSystemSha256', 'flags.VISUAL_CONTEXT_V2'])).toContain('declared variable flags.VISUAL_CONTEXT_V2 does not differ');
    expect(reasons(A, B, ['prompts.nope']).join()).toContain('declared variable prompts.nope is not a comparable provenance field');
  });

  it('a flag present in only one run is a difference that must be declared', () => {
    const B = armB('flags.NEW_FLAG', true, withPath(base(), 'prompts.directorSystemSha256', PROMPT_B));
    expect(reasons(A, B, ['prompts.directorSystemSha256'])).toContain('flags.NEW_FLAG is present in only one run');
  });

  it('key order does not create false differences', () => {
    expect(stable({b: 1, a: [2, {d: 1, c: 2}]})).toBe(stable({a: [2, {c: 2, d: 1}], b: 1}));
    const B = armB('prompts.directorSystemSha256', PROMPT_B, withPath(base(), 'models.director', {temperature: 0.45, id: 'gemini-3.6-flash'}));
    expect(compareManifests(A, B, ['prompts.directorSystemSha256']).verdict).toBe('comparable');
  });

  it('whole-flags unknown blocks comparison', () => {
    const B = armB('flags', unknown('env not captured'), withPath(base(), 'prompts.directorSystemSha256', PROMPT_B));
    expect(compareManifests(A, B, ['prompts.directorSystemSha256']).verdict).toBe('not_comparable');
  });

  it('reports every field as known_match, known_mismatch, unknown, missing or invalid', () => {
    let B = withPath(withPath(withPath(base(), 'prompts.directorSystemSha256', PROMPT_B), 'models.director', {id: 'other'}), 'source.videoSha256', unknown('not available'));
    B = armB('run.arm', 'B', B);
    const result = compareManifests(A, B, ['prompts.directorSystemSha256']);
    expect(result.fields['prompts.directorSystemSha256']).toBe('known_mismatch');
    expect(result.fields['models.director']).toBe('known_mismatch');
    expect(result.fields['source.videoSha256']).toBe('unknown');
    expect(result.fields['renderer.codec']).toBe('known_match');
    expect(compareManifests(A, armB('renderer.fps', undefined), ['prompts.directorSystemSha256']).fields['renderer.fps']).toBe('missing');
    expect(compareManifests(A, armB('renderer.fps', 0), ['prompts.directorSystemSha256']).fields['renderer.fps']).toBe('invalid');
  });

  it('two arms are required for an A/B, and two distinct runs for any comparison', () => {
    const sameArm = withPath(withPath(base(), 'run.id', 'r2'), 'prompts.directorSystemSha256', PROMPT_B);
    expect(reasons(A, sameArm, ['prompts.directorSystemSha256'])).toEqual(['both runs are arm "A"; an A/B comparison needs two arms']);
    const sameRun = withPath(base(), 'run.arm', 'B');
    const sameRunDiff = withPath(sameRun, 'prompts.directorSystemSha256', PROMPT_B);
    expect(reasons(A, sameRunDiff, ['prompts.directorSystemSha256'])).toEqual(['both manifests describe the same run (r1); a comparison needs two runs']);
  });
});

describe('repeat semantics', () => {
  const A = base();
  const rerun = (over: Record<string, unknown> = {}) =>
    Object.entries(over).reduce(
      (m, [path, value]) => withPath(m, path, value),
      withPath(withPath(withPath(base(), 'run.id', 'r2'), 'run.repeat', 1), 'outputs', [{kind: 'render', path: 'b.mp4', sha256: HEX('8')}]),
    );

  it('identical configuration is a repeat only when a repeat is explicitly requested', () => {
    expect(compareManifests(A, rerun(), [], {mode: 'repeat'})).toMatchObject({verdict: 'repeat', reasons: [], differing: []});
  });

  it('identical configuration is NOT an A/B (default mode), with an explicit reason', () => {
    const result = compareManifests(A, rerun(), ['prompts.directorSystemSha256']);
    expect(result.verdict).toBe('not_comparable');
    expect(result.reasons).toContain('declared variable prompts.directorSystemSha256 does not differ');
    expect(compareManifests(A, rerun(), []).reasons[0]).toContain('request mode "repeat"');
  });

  it('a repeat takes no declared variable', () => {
    expect(reasons(A, rerun(), ['prompts.directorSystemSha256'], 'repeat')).toContain('a repeat compares one configuration with itself, so it takes no declared variable');
  });

  it('a repeat must be the same arm, a different run and a different repeat index', () => {
    expect(reasons(A, rerun({'run.arm': 'B'}), [], 'repeat')).toContain('a repeat must be the same arm, got "A" and "B"');
    expect(reasons(A, rerun({'run.repeat': 0}), [], 'repeat')).toContain('both runs have repeat index 0; a repeat needs distinct repeat indexes');
    expect(reasons(A, rerun({'run.id': 'r1'}), [], 'repeat')).toContain('both manifests describe the same run (r1); a comparison needs two runs');
  });

  it('a repeat with any difference or unknown is not a repeat', () => {
    expect(compareManifests(A, rerun({'prompts.directorSystemSha256': PROMPT_B}), [], {mode: 'repeat'}).reasons).toEqual(['prompts.directorSystemSha256 differs but is not the declared variable']);
    expect(compareManifests(withPath(base(), 'source.videoSha256', unknown('x')), rerun({'source.videoSha256': unknown('x')}), [], {mode: 'repeat'}).verdict).toBe('not_comparable');
  });
});

describe('required flags and output provenance', () => {
  const A = base();
  it.each([...REQUIRED_FLAGS])('a manifest that does not state %s is invalid (an omitted policy flag cannot be assumed off)', name => {
    const result = validateManifest(withPath(base(), `flags.${name}`, undefined));
    expect(result.valid).toBe(false);
    expect(result.missing).toContain(`flags.${name}`);
  });

  it('flipping both policy flags with only one declared is rejected', () => {
    const B = armB('flags.OCCUPANCY_CONTEXT_V2', true, withPath(base(), 'flags.HOOK_TITLE_POLICY', 'optional'));
    expect(reasons(A, B, ['flags.HOOK_TITLE_POLICY'])).toEqual(['flags.OCCUPANCY_CONTEXT_V2 differs but is not the declared variable']);
  });

  it('runs with no recorded outputs have nothing to compare', () => {
    const B = armB('outputs', [], withPath(base(), 'prompts.directorSystemSha256', PROMPT_B));
    expect(reasons(A, B, ['prompts.directorSystemSha256'])).toContain('B has no recorded outputs, so there is nothing to compare');
  });

  it('historical outputs without manifests are never comparable: nothing can be derived for them', () => {
    expect(compareManifests({outputs: []}, A, ['prompts.directorSystemSha256']).verdict).toBe('not_comparable');
    expect(validateManifest({outputs: []}).valid).toBe(false);
  });

  it('checks helpers reject what they should', () => {
    expect(checks.sha256(HEX('a'))).toBeNull();
    expect(checks.sha256('abc')).not.toBeNull();
    expect(checks.oneOf(['a'])('b')).not.toBeNull();
  });
});

describe('run status, stages and occupancy provenance (Phase 20B)', () => {
  const A = base();
  const ab = (path: string, value: unknown, over?: RunManifest) => armB(path, value, withPath(over ?? base(), 'prompts.directorSystemSha256', PROMPT_B));
  const DECLARED = ['prompts.directorSystemSha256'];

  it.each(['incomplete', 'failed'])('a run with status "%s" is a valid record but can never be compared (as B, as A, or as a repeat)', status => {
    const bad = withPath(base(), 'run.status', status);
    expect(validateManifest(bad).valid).toBe(true);
    expect(reasons(A, ab('run.status', status), DECLARED)).toContain(`B run status is "${status}"; only complete runs can be compared`);
    expect(reasons(bad, ab('run.arm', 'B'), DECLARED)).toContain(`A run status is "${status}"; only complete runs can be compared`);
    const rerun = withPath(withPath(withPath(base(), 'run.id', 'r2'), 'run.repeat', 1), 'run.status', status);
    expect(compareManifests(A, rerun, [], {mode: 'repeat'}).verdict).toBe('not_comparable');
  });

  it.each([['', null], ['"done"', 'done'], ['a number', 1]])('run.status %s is invalid', (_name, value) => {
    expect(validateManifest(withPath(base(), 'run.status', value)).invalid.map(item => item.path)).toContain('run.status');
  });
  it('run.status absent is missing', () => {
    expect(validateManifest(withPath(base(), 'run.status', undefined)).missing).toContain('run.status');
  });

  it('a failed stage anywhere makes the run incomparable even when run.status says complete (a stale or hand-written status cannot hide it)', () => {
    const failedStage = withPath(base(), 'stages', [
      {id: 'transcribe', startedAt: '2026-10-11T00:00:00Z', endedAt: '2026-10-11T00:00:05Z', status: 'ok'},
      {id: 'director', startedAt: '2026-10-11T00:00:05Z', endedAt: '2026-10-11T00:00:20Z', status: 'failed'},
      {id: 'render', startedAt: '2026-10-11T00:00:20Z', endedAt: '2026-10-11T00:01:00Z', status: 'ok'},
    ]);
    expect(validateManifest(failedStage).valid).toBe(true);
    const found = reasons(A, ab('stages', (failedStage as unknown as {stages: unknown}).stages), DECLARED);
    expect(found.join('\n')).toContain('B has a failed stage (director)');
  });

  it('stages unknown => valid but not comparable; stages absent => invalid', () => {
    expect(validateManifest(withPath(base(), 'stages', unknown('not captured'))).valid).toBe(true);
    expect(reasons(A, ab('stages', unknown('not captured')), DECLARED)).toContain('B stages are unknown, so the run cannot be shown to have completed');
    expect(validateManifest(withPath(base(), 'stages', undefined)).missing).toContain('stages');
  });

  it('a different stage sequence between arms (an extra or skipped stage) prevents comparison', () => {
    const extra = (base() as unknown as {stages: Array<Record<string, string>>}).stages.concat([{id: 'layout_critique', startedAt: '2026-10-11T00:01:00Z', endedAt: '2026-10-11T00:01:01Z', status: 'ok'}]);
    expect(reasons(A, ab('stages', extra), DECLARED).join('\n')).toContain('the stage sequence differs');
    const skipped = (base() as unknown as {stages: Array<Record<string, string>>}).stages.map(stage => (stage.id === 'director' ? {...stage, status: 'skipped'} : stage));
    expect(reasons(A, ab('stages', skipped), DECLARED).join('\n')).toContain('the stage sequence differs');
  });

  it('timestamps differ between runs without affecting comparability', () => {
    const shifted = (base() as unknown as {stages: Array<Record<string, string>>}).stages.map(stage => ({...stage, startedAt: '2026-11-01T00:00:00Z', endedAt: '2026-11-01T00:00:09Z'}));
    expect(compareManifests(A, ab('stages', shifted), DECLARED).verdict).toBe('comparable');
  });

  it.each([
    ['no id', [{startedAt: '2026-10-11T00:00:00Z', endedAt: '2026-10-11T00:00:01Z', status: 'ok'}]],
    ['an empty id', [{id: '', startedAt: '2026-10-11T00:00:00Z', endedAt: '2026-10-11T00:00:01Z', status: 'ok'}]],
    ['a duplicate id', [{id: 'a', startedAt: '2026-10-11T00:00:00Z', endedAt: '2026-10-11T00:00:01Z', status: 'ok'}, {id: 'a', startedAt: '2026-10-11T00:00:01Z', endedAt: '2026-10-11T00:00:02Z', status: 'ok'}]],
    ['a bad start time', [{id: 'a', startedAt: 'soon', endedAt: '2026-10-11T00:00:01Z', status: 'ok'}]],
    ['an end before the start', [{id: 'a', startedAt: '2026-10-11T00:00:05Z', endedAt: '2026-10-11T00:00:01Z', status: 'ok'}]],
    ['a bad status', [{id: 'a', startedAt: '2026-10-11T00:00:00Z', endedAt: '2026-10-11T00:00:01Z', status: 'done'}]],
    ['an empty list', []],
    ['a non-list', 'stages'],
    ['null', null],
  ])('stages with %s is invalid', (_name, stages) => {
    expect(validateManifest(withPath(base(), 'stages', stages)).invalid.map(item => item.path).some(path => path.startsWith('stages'))).toBe(true);
  });

  describe('occupancy snapshot identity', () => {
    it('a replay needs a snapshot hash and a received-data digest; null, empty and malformed values are invalid', () => {
      for (const path of ['occupancy.snapshotSha256', 'occupancy.receivedDigestSha256']) {
        for (const value of [null, '', 'abc', 'C'.repeat(64), 5]) {
          expect(validateManifest(withPath(base(), path, value)).invalid.map(item => item.path), `${path}=${String(value)}`).toContain(path);
        }
        expect(validateManifest(withPath(base(), path, undefined)).missing).toContain(path);
      }
      expect(validateManifest(withPath(base(), 'occupancy.mode', 'frozen')).invalid.map(item => item.path)).toContain('occupancy.mode');
    });

    it('live detection is never frozen: both hashes must be explicit unknowns, so it can never be compared', () => {
      const live = withPath(withPath(withPath(base(), 'occupancy.mode', 'live'), 'occupancy.snapshotSha256', unknown('live detection')), 'occupancy.receivedDigestSha256', unknown('live detection'));
      expect(validateManifest(live)).toMatchObject({valid: true, invalid: []});
      expect(reasons(A, ab('occupancy', (live as unknown as {occupancy: unknown}).occupancy), DECLARED).join('\n')).toContain('occupancy.snapshotSha256 is unknown in B');
      // claiming a hash for a live run is a false statement and is invalid
      expect(validateManifest(withPath(base(), 'occupancy.mode', 'live')).invalid.map(item => item.path)).toEqual(['occupancy.snapshotSha256', 'occupancy.receivedDigestSha256']);
    });

    it('a different snapshot between arms prevents comparison unless it is the declared variable', () => {
      const other = ab('occupancy.snapshotSha256', HEX('d'));
      expect(reasons(A, other, DECLARED)).toContain('occupancy.snapshotSha256 differs but is not the declared variable');
      expect(compareManifests(A, other, ['occupancy.snapshotSha256', 'prompts.directorSystemSha256']).reasons.join()).not.toContain('is not the declared variable');
    });

    it('arms that replayed the same snapshot but RECEIVED different data are not comparable', () => {
      expect(reasons(A, ab('occupancy.receivedDigestSha256', HEX('d')), DECLARED)).toContain('occupancy.receivedDigestSha256 differs but is not the declared variable');
    });

    it('a missing or unknown snapshot in either arm prevents a comparable verdict', () => {
      expect(reasons(A, ab('occupancy.snapshotSha256', undefined), DECLARED)).toContain('B is missing occupancy.snapshotSha256');
      expect(compareManifests(A, ab('occupancy.snapshotSha256', unknown('snapshot not recorded')), DECLARED).verdict).toBe('not_comparable');
      expect(compareManifests(withPath(base(), 'occupancy.snapshotSha256', unknown('snapshot not recorded')), ab('run.arm', 'B'), DECLARED).verdict).toBe('not_comparable');
    });

    it('the occupancy-wording comparison is comparable only with the same snapshot and received data in both arms', () => {
      const B = armB('flags.OCCUPANCY_CONTEXT_V2', true);
      expect(compareManifests(A, B, ['flags.OCCUPANCY_CONTEXT_V2']).verdict).toBe('comparable');
      const driftedSnapshot = withPath(B, 'occupancy.snapshotSha256', HEX('d'));
      expect(compareManifests(A, driftedSnapshot, ['flags.OCCUPANCY_CONTEXT_V2']).verdict).toBe('not_comparable');
    });
  });

  describe('a changed source, prompt, asset, renderer or undeclared flag prevents comparison (the declared variable stays the occupancy flag)', () => {
    const DECL = ['flags.OCCUPANCY_CONTEXT_V2'];
    const occB = (path: string, value: unknown) => withPath(armB('flags.OCCUPANCY_CONTEXT_V2', true), path, value);
    it.each([
      ['source video', 'source.videoSha256', HEX('9')],
      ['source trim', 'source.trim', [{sourceStart: 1, sourceEnd: 3, outputStart: 0}]],
      ['Director system prompt', 'prompts.directorSystemSha256', HEX('9')],
      ['prompt files', 'prompts.promptFilesSha256', HEX('9')],
      ['B-roll asset hash', 'broll.assets', [{id: 'ub', sha256: HEX('9')}]],
      ['B-roll asset set', 'broll.assets', [{id: 'ub', sha256: HEX('e')}, {id: 'ub2', sha256: HEX('9')}]],
      ['renderer codec', 'renderer.codec', 'h265'],
      ['renderer version', 'renderer.remotionVersion', '4.0.999'],
      ['renderer fps', 'renderer.fps', 24],
      ['undeclared hook policy', 'flags.HOOK_TITLE_POLICY', 'optional'],
      ['undeclared visual context', 'flags.VISUAL_CONTEXT_V2', true],
      ['undeclared director model setting', 'flags.GEMINI_MODEL', 'gemini-3.7-flash'],
      ['model id', 'models.director', {id: 'gemini-3.7-flash'}],
      ['code state', 'pipeline.treeSha256', HEX('9')],
      ['frame times', 'visualContext.frameTimesOutputSec', [0.5, 2]],
    ])('%s', (_name, path, value) => {
      const result = compareManifests(A, occB(path, value), DECL);
      expect(result.verdict).toBe('not_comparable');
      expect(result.reasons.join('\n')).toContain(`${path} differs but is not the declared variable`);
    });
  });
});

describe('request-schema identity (Phase 21A)', () => {
  const A = base();
  it('prompts.directorSchemaSha256 follows the same rules as the system-prompt hash: a SHA-256, null only when no Director ran, otherwise invalid', () => {
    for (const value of [null, '', 'abc', 'C'.repeat(64), 7]) {
      expect(validateManifest(withPath(base(), 'prompts.directorSchemaSha256', value)).invalid.map(item => item.path), String(value)).toContain('prompts.directorSchemaSha256');
    }
    expect(validateManifest(withPath(base(), 'prompts.directorSchemaSha256', unknown('request not parsed'))).unknownFields).toContain('prompts.directorSchemaSha256');
    const noDirector = withPath(withPath(withPath(withPath(base(), 'models.director', null), 'prompts.directorSystemSha256', null), 'prompts.directorSchemaSha256', null), 'prompts.contentProfileBlockSha256', null);
    expect(validateManifest(noDirector).valid).toBe(true);
  });

  it('a different request schema between arms blocks comparison unless it is declared (the hook policy changes the schema\'s required list)', () => {
    const B = withPath(armB('flags.HOOK_TITLE_POLICY', 'optional'), 'prompts.directorSchemaSha256', HEX('8'));
    expect(reasons(A, B, ['flags.HOOK_TITLE_POLICY'])).toEqual(['prompts.directorSchemaSha256 differs but is not the declared variable']);
    expect(compareManifests(A, B, ['flags.HOOK_TITLE_POLICY', 'prompts.directorSchemaSha256']).verdict).toBe('comparable');
  });
});
