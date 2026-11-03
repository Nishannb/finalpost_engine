import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {sha256} from './baseline.ts';
import {collectFromEnv, collectManifest, CONFIG_KEYS, writeCollected, type CollectInput} from './manifestCollector.ts';
import {captureSnapshot, occupancyInputDigest, packOccupancyFromSnapshot, snapshotToJson} from './occupancySnapshot.ts';
import {occupancyFromSpeaker} from '../stages/layout/occupancy.ts';
import {PROMPT_FILES} from './promptLint.ts';
import {compareManifestsVerified, verifyManifestFiles} from './manifestVerify.ts';
import {compareManifests, isUnknown, validateManifest} from './runManifest.ts';

/**
 * A throw-away git repository with the same code roots as the engine. Nothing here touches the real repository, the real
 * baselines, a model or the network.
 */
const GIT_ENV = {...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com'};
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {cwd, env: GIT_ENV, encoding: 'utf8'});
const put = (root: string, path: string, content: string | Buffer) => {
  mkdirSync(dirname(join(root, path)), {recursive: true});
  writeFileSync(join(root, path), content);
};

let root: string;
let workdir: string;

const CONFIG = {HOOK_TITLE_POLICY: 'placeholder', OCCUPANCY_CONTEXT_V2: false, VISUAL_CONTEXT_V2: false, GENERATED_TRANSITIONS_ENABLED: false, DIRECTOR_V2: false, NORTH_STAR: false, PIPELINE_MODE: 'lean', ZOOM_SCALE: 1.25, MOTION_GRAPHICS_ENABLED: false, CONTENT_PROFILE_ENABLED: true, HOOK_DURATION_SEC: 3, BROLL_MOMENT_COUNT: 5, GEMINI_MODEL: 'gemini-3.6-flash'};
const HEX = (c: string) => c.repeat(64);

const SNAP = captureSnapshot({
  id: 'collector-fixture',
  source: {sourceId: 'synthetic:collector', videoSha256: HEX('a')},
  capture: {method: 'synthetic', capturedAt: '2026-10-11T00:00:00Z', note: 'fixture'},
  outputDurationSec: 12.5,
  measurements: [
    {id: 'p', role: 'primary', sourceSec: 3.5, outputSec: 3.5, occupancy: occupancyFromSpeaker({x: 0.2, y: 0.1, w: 0.6, h: 0.7}, 'vision')},
    {id: 's0', role: 'sampled', sourceSec: 5.6, outputSec: 5.6, occupancy: occupancyFromSpeaker({x: 0.18, y: 0.16, w: 0.64, h: 0.62}, 'fallback')},
  ],
});
const STAGES = [
  {id: 'transcribe', startedAt: '2026-10-11T00:00:00Z', endedAt: '2026-10-11T00:00:05Z', status: 'ok' as const},
  {id: 'director', startedAt: '2026-10-11T00:00:05Z', endedAt: '2026-10-11T00:00:20Z', status: 'ok' as const},
  {id: 'render', startedAt: '2026-10-11T00:00:20Z', endedAt: '2026-10-11T00:01:00Z', status: 'ok' as const},
];

const full = (over: Partial<CollectInput> = {}): CollectInput => ({
  root,
  run: {id: 'r1', arm: 'A', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const},
  source: {videoPath: 'media/clip.mp4', durationSec: 12.5, trim: [{sourceStart: 0, sourceEnd: 12.5, outputStart: 0}], transcriptPath: 'media/clip.transcript.json'},
  pipeline: {path: 'v1'},
  models: {director: {id: 'gemini-test'}, motionDirector: null, graphicsWorker: null, transcription: {id: 'asr-test'}},
  prompts: {directorSystemSha256: HEX('1'), directorSchemaSha256: HEX('6'), contentProfileBlockSha256: HEX('2')},
  config: CONFIG,
  stages: STAGES,
  occupancy: {snapshotPath: 'media/occupancy.snapshot.json', receivedPack: packOccupancyFromSnapshot(SNAP)},
  visualContext: {frameTimesOutputSec: [0.4, 1.9], imagesAttached: 2},
  broll: {mode: 'creator', assets: [{id: 'ub1', path: 'media/ub1.mp4'}], stockFrozen: true},
  renderer: {engine: 'local', fps: 30, width: 1080, height: 1920, codec: 'h264'},
  rubric: {version: 'test', path: 'rubric.md'},
  outputs: [{kind: 'render', path: 'out/a.mp4'}],
  ...over,
});

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), 'collector-'));
  root = join(workdir, 'repo');
  mkdirSync(root);
  git(root, 'init', '-q');
  put(root, 'server/src/a.ts', 'export const a = 1;\n');
  put(root, 'server/src/b.ts', 'export const b = 2;\n');
  put(root, 'remotion/src/v.tsx', 'export const v = 1;\n');
  for (const file of PROMPT_FILES) {
    put(root, file, `prompt ${file}\n`);
  }
  put(root, 'server/package.json', '{}');
  put(root, 'remotion/package.json', '{}');
  put(root, 'remotion/node_modules/remotion/package.json', '{"version": "4.0.999"}');
  put(root, '.env', 'GEMINI_API_KEY=super-secret-key-do-not-leak\n');
  put(root, 'media/clip.mp4', Buffer.from('fake video bytes'));
  put(root, 'media/clip.transcript.json', '{"words":[]}');
  put(root, 'media/ub1.mp4', Buffer.from('fake asset'));
  put(root, 'rubric.md', 'rubric v-test');
  put(root, 'media/occupancy.snapshot.json', snapshotToJson(SNAP));
  put(root, 'out/a.mp4', Buffer.from('fake render'));
  put(root, '.gitignore', '.env\nnode_modules/\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
});

afterAll(() => {
  rmSync(workdir, {recursive: true, force: true});
});

describe('what the collector verifies against actual files and git', () => {
  it('hashes the source video, transcript, B-roll asset, rubric and output from their bytes', () => {
    const {manifest, origin} = collectManifest(full());
    expect(manifest.source.videoSha256).toBe(sha256(Buffer.from('fake video bytes')));
    expect(manifest.source.sizeBytes).toBe('fake video bytes'.length);
    expect(manifest.source.transcriptSha256).toBe(sha256('{"words":[]}'));
    expect(manifest.broll.assets).toEqual([{id: 'ub1', sha256: sha256(Buffer.from('fake asset'))}]);
    expect(manifest.rubric.sha256).toBe(sha256('rubric v-test'));
    expect(manifest.outputs).toEqual([{kind: 'render', path: 'out/a.mp4', sha256: sha256(Buffer.from('fake render'))}]);
    expect(origin['source.videoSha256']).toBe('verified_from_file');
    expect(origin['source.sizeBytes']).toBe('verified_from_file');
    expect(origin['broll.assets[0].sha256']).toBe('verified_from_file');
    expect(origin['outputs[0].sha256']).toBe('verified_from_file');
  });

  it('reads the commit from git, the Node version from the runtime and the installed Remotion version from node_modules', () => {
    const {manifest, origin} = collectManifest(full());
    expect(manifest.pipeline.headCommit).toBe(git(root, 'rev-parse', 'HEAD').trim());
    expect(manifest.pipeline.nodeVersion).toBe(process.version);
    expect(manifest.renderer.remotionVersion).toBe('4.0.999');
    expect([origin['pipeline.headCommit'], origin['pipeline.treeSha256'], origin['pipeline.nodeVersion'], origin['renderer.remotionVersion']]).toEqual(['verified_from_git', 'verified_from_git', 'verified_from_runtime', 'verified_from_file']);
  });

  it('computes the prompt-files hash from the actual prompt files when a prompt-using model is included', () => {
    const {manifest, origin} = collectManifest(full());
    const expected = sha256(PROMPT_FILES.map(file => `${file}:${sha256(`prompt ${file}\n`)}`).join('\n'));
    expect(manifest.prompts.promptFilesSha256).toBe(expected);
    expect(origin['prompts.promptFilesSha256']).toBe('verified_from_file');
  });

  it('a collected, fully supplied manifest passes the validator with nothing unknown', () => {
    const {validation} = collectManifest(full());
    expect(validation).toEqual({valid: true, missing: [], invalid: [], unknownFields: []});
  });
});

describe('installed Remotion version lookup', () => {
  it('finds the hoisted repo-root install when there is no workspace-local one, and prefers a local one when present', () => {
    const hoisted = mkdtempSync(join(workdir, 'hoist-'));
    git(hoisted, 'init', '-q');
    put(hoisted, 'server/src/a.ts', 'x');
    put(hoisted, 'node_modules/remotion/package.json', '{"version": "4.0.111"}');
    git(hoisted, 'add', '-A');
    git(hoisted, 'commit', '-q', '-m', 'init');
    expect(collectManifest({root: hoisted, run: {id: 'r', arm: 'A', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const}}).manifest.renderer.remotionVersion).toBe('4.0.111');
    put(hoisted, 'remotion/node_modules/remotion/package.json', '{"version": "4.0.222"}');
    expect(collectManifest({root: hoisted, run: {id: 'r', arm: 'A', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const}}).manifest.renderer.remotionVersion).toBe('4.0.222');
  });

  it('is unknown (not guessed) when no install is found', () => {
    const bare = mkdtempSync(join(workdir, 'bare-'));
    git(bare, 'init', '-q');
    put(bare, 'server/src/a.ts', 'x');
    git(bare, 'add', '-A');
    git(bare, 'commit', '-q', '-m', 'init');
    expect(isUnknown(collectManifest({root: bare, run: {id: 'r', arm: 'A', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const}}).manifest.renderer.remotionVersion)).toBe(true);
  });

  it('on this repository the real installed version is read from the hoisted install', () => {
    const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const installed = JSON.parse(readFileSync(join(repo, 'node_modules', 'remotion', 'package.json'), 'utf8')) as {version: string};
    expect(collectManifest({root: repo, run: {id: 'r', arm: 'A', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const}}).manifest.renderer.remotionVersion).toBe(installed.version);
  });
});

describe('what it only records as supplied metadata (it cannot verify these)', () => {
  it('marks models, prompt hashes, frame times, image count, renderer settings, trim, duration, mode and freeze flag as supplied', () => {
    const {origin} = collectManifest(full());
    for (const path of ['source.durationSec', 'source.trim', 'pipeline.path', 'models.director', 'models.transcription', 'prompts.directorSystemSha256', 'prompts.directorSchemaSha256', 'prompts.contentProfileBlockSha256', 'visualContext.frameTimesOutputSec', 'visualContext.imagesAttached', 'broll.mode', 'broll.stockFrozen', 'renderer.engine', 'renderer.fps', 'renderer.width', 'renderer.height', 'renderer.codec', 'rubric.version']) {
      expect(origin[path], path).toBe('supplied');
    }
  });

  it('a stage declared not part of the run is "not_applicable" (null), which the schema accepts only where legitimate', () => {
    const {manifest, origin, validation} = collectManifest(full());
    expect(manifest.models.motionDirector).toBeNull();
    expect(origin['models.motionDirector']).toBe('not_applicable');
    expect(validation.valid).toBe(true);
    const noDirector = collectManifest(full({models: {director: null, motionDirector: null, graphicsWorker: null, transcription: {id: 'asr-test'}}}));
    expect(noDirector.manifest.prompts).toEqual({directorSystemSha256: null, directorSchemaSha256: null, promptFilesSha256: null, contentProfileBlockSha256: null});
    expect(noDirector.validation.valid).toBe(true);
  });
});

describe('it never claims a missing value is known', () => {
  it('with nothing supplied beyond the run identity, every unverifiable field is an explicit unknown with a reason', () => {
    const {manifest, origin, validation} = collectManifest({root, run: {id: 'r0', arm: 'A', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const}});
    expect(validation.valid).toBe(true);
    for (const path of ['source.videoSha256', 'source.durationSec', 'source.sizeBytes', 'source.trim', 'source.transcriptSha256', 'pipeline.path', 'models.director', 'models.transcription', 'prompts.directorSystemSha256', 'visualContext.imagesAttached', 'broll.assets', 'broll.mode', 'renderer.codec', 'rubric.sha256']) {
      expect(origin[path], path).toBe('unknown');
    }
    expect(isUnknown(manifest.source.videoSha256)).toBe(true);
    expect((manifest.source.videoSha256 as {$unknown: string}).$unknown).toContain('not supplied');
    expect(validation.unknownFields.length).toBeGreaterThan(15);
  });

  it('a path that does not exist is unknown ("file not found"), not an empty or made-up hash', () => {
    const {manifest} = collectManifest(full({source: {videoPath: 'media/missing.mp4', durationSec: 1, trim: [{sourceStart: 0, sourceEnd: 1, outputStart: 0}], transcriptPath: 'media/clip.transcript.json'}, outputs: [{kind: 'render', path: 'out/missing.mp4'}], broll: {mode: 'creator', assets: [{id: 'x', path: 'media/nope.mp4'}], stockFrozen: true}}));
    expect((manifest.source.videoSha256 as {$unknown: string}).$unknown).toContain('file not found');
    expect(isUnknown(manifest.source.sizeBytes)).toBe(true);
    expect(isUnknown(manifest.outputs[0]!.sha256)).toBe(true);
    expect(isUnknown((manifest.broll.assets as Array<{sha256: unknown}>)[0]!.sha256)).toBe(true);
  });

  it('a configuration snapshot missing a flag records that flag as unknown, not false', () => {
    const {HOOK_TITLE_POLICY: _omitted, ...rest} = CONFIG;
    const {manifest, origin} = collectManifest(full({config: rest}));
    expect(isUnknown((manifest.flags as Record<string, unknown>).HOOK_TITLE_POLICY)).toBe(true);
    expect(origin['flags.HOOK_TITLE_POLICY']).toBe('unknown');
  });

  it('a manifest containing unknowns is never comparable, even against a copy of itself with a declared difference', () => {
    const a = collectManifest(full({run: {id: 'r1', arm: 'A', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const}, rubric: {version: 'test'}})).manifest;
    const b = collectManifest(full({run: {id: 'r2', arm: 'B', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const}, rubric: {version: 'test'}, config: {...CONFIG, HOOK_TITLE_POLICY: 'optional'}})).manifest;
    const result = compareManifests(a, b, ['flags.HOOK_TITLE_POLICY']);
    expect(result.verdict).toBe('not_comparable');
    expect(result.fields['rubric.sha256']).toBe('unknown');
  });
});

describe('working-tree identity', () => {
  it('records tracked changes and untracked source files with hashes; treeSha256 changes with either', () => {
    const before = collectManifest(full());
    expect(before.evidence.trackedChanges).toEqual([]);
    expect(before.evidence.untrackedFiles).toEqual([]);
    put(root, 'server/src/a.ts', 'export const a = 42;\n');
    put(root, 'server/src/new.ts', 'export const fresh = true;\n');
    const after = collectManifest(full());
    expect(after.evidence.trackedChanges).toEqual([{status: 'M', path: 'server/src/a.ts', sha256: sha256('export const a = 42;\n')}]);
    expect(after.evidence.untrackedFiles).toEqual([{path: 'server/src/new.ts', sha256: sha256('export const fresh = true;\n')}]);
    expect(after.manifest.pipeline.treeSha256).not.toBe(before.manifest.pipeline.treeSha256);
    expect(after.manifest.pipeline.dirtyFileCount).toBe(2);
    expect(after.manifest.pipeline.headCommit).toBe(before.manifest.pipeline.headCommit);
    expect(after.evidence.trackedDiffSha256).not.toBe(before.evidence.trackedDiffSha256);
    // an edit that only changes an untracked file is also visible
    put(root, 'server/src/new.ts', 'export const fresh = false;\n');
    expect(collectManifest(full()).manifest.pipeline.treeSha256).not.toBe(after.manifest.pipeline.treeSha256);
    // restore
    git(root, 'checkout', '--', 'server/src/a.ts');
    rmSync(join(root, 'server/src/new.ts'));
    expect(collectManifest(full()).manifest.pipeline.treeSha256).toBe(before.manifest.pipeline.treeSha256);
  });

  it('records a deleted tracked file', () => {
    rmSync(join(root, 'server/src/b.ts'));
    const result = collectManifest(full());
    expect(result.evidence.trackedChanges).toEqual([{status: 'D', path: 'server/src/b.ts', sha256: null}]);
    git(root, 'checkout', '--', 'server/src/b.ts');
  });

  it('is deterministic: collecting twice on an unchanged tree yields identical manifests, evidence and provenance', () => {
    const one = collectManifest(full());
    const two = collectManifest(full());
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });
});

describe('secrets and unrelated files', () => {
  it('never reads .env or lists files outside the behaviour-defining code roots; the key text appears nowhere', () => {
    put(root, 'server/src/untracked-note.md', 'x');
    const result = collectManifest(full());
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('super-secret-key');
    expect(serialised).not.toContain('GEMINI_API_KEY');
    expect(result.evidence.untrackedFiles.concat(result.evidence.trackedChanges as never).map(file => file.path)).not.toContain('.env');
    expect(result.evidence.untrackedFiles.map(file => file.path)).toEqual(['server/src/untracked-note.md']);
    rmSync(join(root, 'server/src/untracked-note.md'));
  });

  it('records only the named flags and settings from a configuration snapshot', () => {
    const {manifest} = collectManifest(full({config: {...CONFIG, GEMINI_API_KEY: 'sk-secret', SOMETHING_ELSE: 'x'}}));
    expect(Object.keys(manifest.flags as object).sort()).toEqual([...CONFIG_KEYS].sort());
    expect(JSON.stringify(manifest)).not.toContain('sk-secret');
  });

  it('collectFromEnv reads only the named keys from the validated engine env (defaults: both Phase 18 flags off)', async () => {
    const {manifest, origin} = await collectFromEnv({root, run: {id: 'r1', arm: 'A', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const}});
    const flags = manifest.flags as Record<string, unknown>;
    expect(Object.keys(flags).sort()).toEqual([...CONFIG_KEYS].sort());
    expect(flags.HOOK_TITLE_POLICY).toBe('placeholder');
    expect(flags.OCCUPANCY_CONTEXT_V2).toBe(false);
    expect(origin['flags.HOOK_TITLE_POLICY']).toBe('verified_from_runtime');
  });
});

describe('legitimate single-variable comparison built from collected manifests', () => {
  it('two collected arms that differ only in HOOK_TITLE_POLICY are comparable; also for OCCUPANCY_CONTEXT_V2', () => {
    const a = collectManifest(full()).manifest;
    const hook = collectManifest(full({run: {id: 'r2', arm: 'B', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const}, config: {...CONFIG, HOOK_TITLE_POLICY: 'optional'}, outputs: [{kind: 'render', path: 'out/a.mp4'}]})).manifest;
    expect(compareManifests(a, hook, ['flags.HOOK_TITLE_POLICY'])).toMatchObject({verdict: 'comparable', differing: ['flags.HOOK_TITLE_POLICY']});
    const occupancy = collectManifest(full({run: {id: 'r3', arm: 'B', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const}, config: {...CONFIG, OCCUPANCY_CONTEXT_V2: true}})).manifest;
    expect(compareManifests(a, occupancy, ['flags.OCCUPANCY_CONTEXT_V2']).verdict).toBe('comparable');
    expect(compareManifests(a, occupancy, ['flags.HOOK_TITLE_POLICY']).verdict).toBe('not_comparable');
  });

  it('a code edit between two arms makes them incomparable (tree identity differs)', () => {
    const a = collectManifest(full()).manifest;
    put(root, 'server/src/a.ts', 'export const a = 7;\n');
    const b = collectManifest(full({run: {id: 'r2', arm: 'B', repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const}, config: {...CONFIG, HOOK_TITLE_POLICY: 'optional'}})).manifest;
    git(root, 'checkout', '--', 'server/src/a.ts');
    const result = compareManifests(a, b, ['flags.HOOK_TITLE_POLICY']);
    expect(result.verdict).toBe('not_comparable');
    expect(result.reasons).toContain('pipeline.treeSha256 differs but is not the declared variable');
  });
});

describe('writing manifests stays separate from the frozen baselines', () => {
  it('writes a new manifest and evidence file, and refuses to overwrite either', () => {
    const collected = collectManifest(full());
    const out = join(workdir, 'manifests');
    const written = writeCollected(root, out, 'run-1', collected);
    expect(JSON.parse(readFileSync(written.manifestPath, 'utf8'))).toEqual(JSON.parse(JSON.stringify(collected.manifest)));
    expect(validateManifest(JSON.parse(readFileSync(written.manifestPath, 'utf8'))).valid).toBe(true);
    expect(() => writeCollected(root, out, 'run-1', collected)).toThrow(/refusing to overwrite/);
  });

  it('refuses the frozen baselines, goldens and fixtures directories, and unsafe names', () => {
    const collected = collectManifest(full());
    for (const dir of ['server/src/eval/baselines', 'server/src/eval/golden', 'server/src/eval/fixtures', 'server/src/eval/baselines/nested']) {
      expect(() => writeCollected(root, join(root, dir), 'x', collected), dir).toThrow(/frozen directory/);
    }
    expect(() => writeCollected(root, join(workdir, 'm2'), '../escape', collected)).toThrow(/invalid manifest name/);
    expect(existsSync(join(root, 'server/src/eval/baselines'))).toBe(false);
  });
});

describe('not integrated into production', () => {
  it('no module outside server/src/eval imports the collector or the run-manifest validator', () => {
    const serverSrc = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (path !== join(serverSrc, 'eval')) {
            walk(path);
          }
        } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && /manifestCollector|runManifest/.test(readFileSync(path, 'utf8'))) {
          offenders.push(path);
        }
      }
    };
    walk(serverSrc);
    expect(offenders).toEqual([]);
  });
});


const RUN = (id: string, arm: string, over: Record<string, unknown> = {}) => ({id, arm, repeat: 0, createdAt: '2026-10-11T00:00:00Z', status: 'complete' as const, ...over});

describe('occupancy snapshot identity and the occupancy the run says it received', () => {
  it('the snapshot hash is verified from the file; the mode and the received digest are only supplied', () => {
    const {manifest, origin, evidence, validation} = collectManifest(full());
    expect(manifest.occupancy).toEqual({mode: 'replay', snapshotSha256: SNAP.contentSha256, receivedDigestSha256: occupancyInputDigest(packOccupancyFromSnapshot(SNAP))});
    expect(origin['occupancy.snapshotSha256']).toBe('verified_from_file');
    expect(origin['occupancy.mode']).toBe('supplied');
    expect(origin['occupancy.receivedDigestSha256']).toBe('supplied');
    expect(evidence.occupancy).toMatchObject({snapshotId: 'collector-fixture', snapshotSha256: SNAP.contentSha256, independentMeasurements: 2, repeats: 0, receivedMatchesSnapshot: true, problems: []});
    expect(validation.valid).toBe(true);
  });

  it('a received pack that differs from the snapshot is reported in the evidence; the digest recorded is the pack\'s real digest, never the snapshot\'s', () => {
    const pack = packOccupancyFromSnapshot(SNAP);
    const altered = {...pack, occupancyMeasured: pack.occupancyMeasured.slice(0, 1)};
    const {manifest, evidence} = collectManifest(full({occupancy: {snapshotPath: 'media/occupancy.snapshot.json', receivedPack: altered}}));
    expect(manifest.occupancy.receivedDigestSha256).toBe(occupancyInputDigest(altered));
    expect(manifest.occupancy.receivedDigestSha256).not.toBe(occupancyInputDigest(pack));
    expect(evidence.occupancy!.receivedMatchesSnapshot).toBe(false);
    expect(evidence.occupancy!.problems.join('\n')).toContain('independent measurements');
  });

  it('no received pack: the snapshot is known, the received digest is an explicit unknown (and the run is not comparable)', () => {
    const {manifest, origin} = collectManifest(full({occupancy: {snapshotPath: 'media/occupancy.snapshot.json'}}));
    expect(manifest.occupancy.snapshotSha256).toBe(SNAP.contentSha256);
    expect(isUnknown(manifest.occupancy.receivedDigestSha256)).toBe(true);
    expect(origin['occupancy.receivedDigestSha256']).toBe('unknown');
  });

  it.each([
    ['a missing file', () => 'media/nope.snapshot.json'],
    ['a tampered file', () => {
      const raw = JSON.parse(snapshotToJson(SNAP));
      raw.measurements[0].occupancy.speaker.x = 0.25;
      put(root, 'media/tampered.snapshot.json', JSON.stringify(raw));
      return 'media/tampered.snapshot.json';
    }],
    ['a malformed file', () => {
      put(root, 'media/garbage.snapshot.json', '{"snapshotVersion": 1}');
      return 'media/garbage.snapshot.json';
    }],
    ['a non-JSON file', () => {
      put(root, 'media/text.snapshot.json', 'not json');
      return 'media/text.snapshot.json';
    }],
  ])('%s: the snapshot is an explicit unknown with the reason, never "verified"', (_name, make) => {
    const snapshotPath = make();
    const {manifest, origin} = collectManifest(full({occupancy: {snapshotPath, receivedPack: packOccupancyFromSnapshot(SNAP)}}));
    expect(isUnknown(manifest.occupancy.snapshotSha256)).toBe(true);
    expect(origin['occupancy.snapshotSha256']).toBe('unknown');
    expect(isUnknown(manifest.occupancy.receivedDigestSha256)).toBe(true);
    expect(validateManifest(manifest).valid).toBe(true);
    expect(compareManifests(manifest, collectManifest(full({run: RUN('r2', 'B')})).manifest, ['flags.OCCUPANCY_CONTEXT_V2']).verdict).toBe('not_comparable');
  });

  it('live detection records nothing as frozen; omitted occupancy leaves mode, snapshot and digest unknown', () => {
    const live = collectManifest(full({occupancy: {mode: 'live'}})).manifest.occupancy;
    expect(live.mode).toBe('live');
    expect(isUnknown(live.snapshotSha256) && isUnknown(live.receivedDigestSha256)).toBe(true);
    const none = collectManifest(full({occupancy: undefined})).manifest.occupancy;
    expect(isUnknown(none.mode) && isUnknown(none.snapshotSha256) && isUnknown(none.receivedDigestSha256)).toBe(true);
  });

  it('two arms replaying the same snapshot differ only in the declared flag => comparable; different snapshots => not', () => {
    const a = collectManifest(full()).manifest;
    const b = collectManifest(full({run: RUN('r2', 'B'), config: {...CONFIG, OCCUPANCY_CONTEXT_V2: true}})).manifest;
    expect(compareManifests(a, b, ['flags.OCCUPANCY_CONTEXT_V2']).verdict).toBe('comparable');
    const other = captureSnapshot({...SNAP, id: 'other', measurements: SNAP.measurements.map(item => ({...item}))});
    put(root, 'media/other.snapshot.json', snapshotToJson(other));
    const c = collectManifest(full({run: RUN('r3', 'B'), config: {...CONFIG, OCCUPANCY_CONTEXT_V2: true}, occupancy: {snapshotPath: 'media/other.snapshot.json', receivedPack: packOccupancyFromSnapshot(other)}})).manifest;
    const result = compareManifests(a, c, ['flags.OCCUPANCY_CONTEXT_V2']);
    expect(result.verdict).toBe('not_comparable');
    expect(result.reasons.join('\n')).toContain('occupancy.snapshotSha256 differs but is not the declared variable');
  });
});

describe('stages, status and incomplete runs', () => {
  it('stage records are supplied (not observed); omitted stages are an explicit unknown', () => {
    const { manifest, origin } = collectManifest(full());
    expect(manifest.stages).toEqual(STAGES);
    expect(origin.stages).toBe('supplied');
    expect(origin['run.status']).toBe('supplied');
    const none = collectManifest(full({stages: undefined}));
    expect(isUnknown(none.manifest.stages)).toBe(true);
    expect(none.origin.stages).toBe('unknown');
    expect(none.validation.valid).toBe(true);
  });

  it.each(['failed', 'incomplete'] as const)('a "%s" run is recorded honestly and can never be compared', status => {
    const a = collectManifest(full()).manifest;
    const b = collectManifest(full({run: RUN('r2', 'B', {status}), config: {...CONFIG, HOOK_TITLE_POLICY: 'optional'}})).manifest;
    expect(b.run.status).toBe(status);
    const result = compareManifests(a, b, ['flags.HOOK_TITLE_POLICY']);
    expect(result.verdict).toBe('not_comparable');
    expect(result.reasons).toContain(`B run status is "${status}"; only complete runs can be compared`);
  });

  it('a run with a failed stage is not comparable even if its status says complete', () => {
    const a = collectManifest(full()).manifest;
    const failedStage = STAGES.map(stage => (stage.id === 'director' ? {...stage, status: 'failed' as const} : stage));
    const b = collectManifest(full({run: RUN('r2', 'B'), stages: failedStage, config: {...CONFIG, HOOK_TITLE_POLICY: 'optional'}})).manifest;
    expect(compareManifests(a, b, ['flags.HOOK_TITLE_POLICY']).reasons.join('\n')).toContain('B has a failed stage (director)');
  });

  it('an output that was never produced (failed run) is an explicit unknown hash, so the run cannot be compared', () => {
    const a = collectManifest(full()).manifest;
    const b = collectManifest(full({run: RUN('r2', 'B'), outputs: [{kind: 'render', path: 'out/never-written.mp4'}], config: {...CONFIG, HOOK_TITLE_POLICY: 'optional'}})).manifest;
    expect(isUnknown(b.outputs[0]!.sha256)).toBe(true);
    expect(compareManifests(a, b, ['flags.HOOK_TITLE_POLICY']).reasons).toContain('B has an output whose hash is unknown; its provenance cannot be established');
  });
});

describe('recorded hashes are re-checked against the files that exist', () => {
  const pair = () => ({
    a: collectManifest(full()).manifest,
    b: collectManifest(full({run: RUN('r2', 'B'), config: {...CONFIG, HOOK_TITLE_POLICY: 'optional'}})).manifest,
  });
  const filesOf = () => ({ root, sourcePath: 'media/clip.mp4', transcriptPath: 'media/clip.transcript.json', rubricPath: 'rubric.md', assetPaths: {ub1: 'media/ub1.mp4'} });

  it('an untouched set of files verifies completely; the pair is comparable', () => {
    const { a, b } = pair();
    const verification = verifyManifestFiles(a, filesOf());
    expect(verification.checks.map(item => item.status)).toEqual(['verified_match', 'verified_match', 'verified_match', 'verified_match', 'verified_match']);
    const result = compareManifestsVerified(a, b, ['flags.HOOK_TITLE_POLICY'], {A: filesOf(), B: filesOf()});
    expect(result.verdict).toBe('comparable');
    expect(result.unverified).toEqual([]);
  });

  it('an output file changed after the manifest was written => mismatch => not comparable', () => {
    const { a, b } = pair();
    put(root, 'out/a.mp4', Buffer.from('a different render'));
    try {
      const result = compareManifestsVerified(a, b, ['flags.HOOK_TITLE_POLICY'], {A: filesOf(), B: filesOf()});
      expect(result.verdict).toBe('not_comparable');
      expect(result.reasons).toContain('A outputs[0]: the recorded hash does not match the file on disk (out/a.mp4)');
      expect(result.fileChecks.A.find(item => item.label === 'outputs[0]')).toMatchObject({status: 'mismatch', actual: sha256(Buffer.from('a different render'))});
    } finally {
      put(root, 'out/a.mp4', Buffer.from('fake render'));
    }
  });

  it.each([
    ['source video', 'media/clip.mp4', Buffer.from('other video')],
    ['B-roll asset', 'media/ub1.mp4', Buffer.from('other asset')],
    ['rubric', 'rubric.md', Buffer.from('other rubric')],
    ['transcript', 'media/clip.transcript.json', Buffer.from('{}')],
  ])('a changed %s file is caught', (_name, path, bytes) => {
    const { a, b } = pair();
    const original = readFileSync(join(root, path));
    put(root, path, bytes);
    try {
      expect(compareManifestsVerified(a, b, ['flags.HOOK_TITLE_POLICY'], {A: filesOf(), B: filesOf()}).verdict).toBe('not_comparable');
    } finally {
      put(root, path, original);
    }
  });

  it('a hand-edited manifest hash (file untouched) is caught as a mismatch', () => {
    const { a, b } = pair();
    const edited = JSON.parse(JSON.stringify(a));
    edited.outputs[0].sha256 = HEX('0');
    expect(verifyManifestFiles(edited, filesOf()).mismatches.map(item => item.label)).toEqual(['outputs[0]']);
    expect(compareManifestsVerified(edited, b, ['flags.HOOK_TITLE_POLICY'], {A: filesOf(), B: filesOf()}).verdict).toBe('not_comparable');
  });

  it('files that are not available are reported as unverified, not as failures and not as verified', () => {
    const { a, b } = pair();
    const result = compareManifestsVerified(a, b, ['flags.HOOK_TITLE_POLICY'], {A: {root: join(workdir, 'elsewhere')}, B: {root: join(workdir, 'elsewhere')}});
    expect(result.verdict).toBe('comparable');
    expect(result.unverified).toEqual(['A outputs[0] (file_unavailable)', 'B outputs[0] (file_unavailable)']);
    expect(result.fileChecks.A[0]!.status).toBe('file_unavailable');
  });

  it('a hash recorded as unknown is reported as such and never as verified', () => {
    const { a } = pair();
    const withUnknown = JSON.parse(JSON.stringify(a));
    withUnknown.outputs[0].sha256 = {$unknown: 'not hashed'};
    expect(verifyManifestFiles(withUnknown, filesOf()).checks.find(item => item.label === 'outputs[0]')!.status).toBe('recorded_unknown');
  });
});
