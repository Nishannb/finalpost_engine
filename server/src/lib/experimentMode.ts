/**
 * Phase 36E: explicit, mutually exclusive run modes for the Phase 36 runner. Pure (node:fs/path only, no side effects), so it can be tested without running anything.
 *
 *   paid     --mode=paid     [outDir]                                   requires P36_APPROVED=yes. Real providers. Never accepts an offline marker or a --source.
 *   offline  --mode=offline  <outDir> --source=<fixture> [--serve-port=N]  must NOT carry P36_APPROVED. Requires the deterministic fake transport published by the
 *                                                                          harness preload (a JS object whose `fetch` is the live `globalThis.fetch`), sentinel keys only,
 *                                                                          no endpoint/proxy override, and an output directory inside a temporary root named p36-dryrun-*.
 * Anything else (missing/duplicate/unknown mode, unknown flag, extra positional, conflicting signals) is a refusal, decided before any provider module is imported
 * and before any filesystem write. Mode flags and environment variables are NOT the network barrier; they only select which code path may start.
 */
import {existsSync, realpathSync} from 'node:fs';
import path from 'node:path';

export const OFFLINE_MARKER_KEY = 'finalpost.p36.offline';

/**
 * Phase 36G: the ONE credential value offline mode accepts, pinned here in reviewed source. It is a public placeholder, not a secret. The marker's own `sentinel`
 * field is only compared against it, never trusted as the expected value (before 36G the expected value was read from the marker, so a script that published a marker
 * naming a real key as its "sentinel" would have made that real key pass). Every preload imports this constant instead of keeping its own copy.
 */
export const OFFLINE_SENTINEL = 'DRYRUN-NOT-A-REAL-KEY';

export type FixtureVerdict = {ok: true; path: string; sha256: string} | {ok: false; reason: string};

export type OfflineMarker = {version: 1; fetch: unknown; sentinel: string; fixture: {path: string; sha256: string}; report: () => {denied: number; leaked: number}};

export type Invocation =
  | {ok: true; mode: 'paid'; outDir: string | null}
  | {ok: true; mode: 'offline'; outDir: string; source: string; servePort: number}
  | {ok: false; reason: string};

/** Environment names (never values) that can redirect a provider endpoint, a proxy, or inject code into a child Node process. */
export const ENDPOINT_OVERRIDE_VARS = [
  'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_VERTEX_BASE_URL',
  'OPENAI_BASE_URL', 'GEMINI_BASE_URL', 'GOOGLE_API_BASE_URL', 'GROQ_BASE_URL',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NODE_USE_ENV_PROXY', 'GLOBAL_AGENT_HTTP_PROXY',
  'NODE_OPTIONS',
] as const;

export function findEndpointOverrides(env: Record<string, string | undefined>): string[] {
  return ENDPOINT_OVERRIDE_VARS.filter(name => (env[name] ?? '').trim() !== '');
}

const KEY_NAMES = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'ANTHROPIC_API_KEY'] as const;

/** Offline output must be a NEW directory named p36-dryrun-* inside a temporary root (roots are passed in already canonical). */
export function checkOfflineOutDir(outDir: string, tmpRoots: string[]): string | null {
  if (!path.isAbsolute(outDir)) return 'offline output directory must be an absolute path';
  if (outDir.includes('\0') || outDir.split(path.sep).includes('..')) return 'offline output directory must be a normalised path';
  if (!/^p36-dryrun-[A-Za-z0-9._-]{1,80}$/.test(path.basename(outDir))) return 'offline output directory name must match p36-dryrun-<id>';
  const canonical = canonicalViaAncestor(outDir);
  const ok = tmpRoots.some(root => {
    const relative = path.relative(root, canonical);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  return ok ? null : 'offline output directory must be inside a temporary root, not inside the repository';
}

/** realpath of the nearest existing ancestor + the not-yet-existing tail (so a symlinked parent cannot smuggle the path out of the temporary root). */
export function canonicalViaAncestor(target: string): string {
  let probe = path.resolve(target);
  const tail: string[] = [];
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    tail.unshift(path.basename(probe));
    probe = parent;
  }
  return path.join(realpathSync(probe), ...tail);
}

export function parseExperimentInvocation(input: {
  /** process.argv.slice(2) */
  args: string[];
  env: Record<string, string | undefined>;
  /** globalThis[OFFLINE_MARKER_KEY] */
  marker: unknown;
  currentFetch: unknown;
  /** Canonical temporary roots permitted for offline output. */
  tmpRoots: string[];
  /** Independent fixture check (path, size, SHA-256, never the real source). Required for offline mode: without it offline mode is refused, never assumed. */
  validateFixture?: (candidate: string) => FixtureVerdict;
}): Invocation {
  const refuse = (reason: string): Invocation => ({ok: false, reason});
  let mode: string | undefined;
  let source: string | undefined;
  let servePort: string | undefined;
  const positional: string[] = [];
  for (const arg of input.args) {
    if (arg.startsWith('--mode=')) {
      if (mode !== undefined) return refuse('--mode given more than once');
      mode = arg.slice(7);
    } else if (arg.startsWith('--source=')) {
      if (source !== undefined) return refuse('--source given more than once');
      source = arg.slice(9);
    } else if (arg.startsWith('--serve-port=')) {
      if (servePort !== undefined) return refuse('--serve-port given more than once');
      servePort = arg.slice(13);
    } else if (arg.startsWith('-')) {
      return refuse(`unknown option ${arg.split('=')[0]}`);
    } else {
      positional.push(arg);
    }
  }
  if (mode === undefined) return refuse('--mode=paid or --mode=offline is required');
  if (mode !== 'paid' && mode !== 'offline') return refuse(`unknown mode "${mode}" (expected paid or offline)`);
  if (positional.length > 1) return refuse('more than one output directory given');
  if ((input.env.P36_MODE ?? '') !== '' && input.env.P36_MODE !== mode) return refuse('P36_MODE conflicts with --mode');
  const marker = input.marker as Partial<OfflineMarker> | undefined | null;

  if (mode === 'paid') {
    if (source !== undefined || servePort !== undefined) return refuse('--source and --serve-port are offline-only options');
    if (marker !== undefined && marker !== null) return refuse('an offline fake-transport marker is present, which conflicts with --mode=paid');
    if (input.env.P36_APPROVED !== 'yes') return refuse('P36_APPROVED=yes is required for --mode=paid (this run makes paid provider calls)');
    return {ok: true, mode: 'paid', outDir: positional[0] ?? null};
  }

  // offline
  if ((input.env.P36_APPROVED ?? '') !== '') return refuse('P36_APPROVED must not be set in offline mode (it authorises paid runs; offline mode never uses it)');
  if (positional.length !== 1) return refuse('offline mode requires an explicit output directory');
  if (source === undefined || source === '') return refuse('offline mode requires --source=<approved synthetic fixture>');
  if (!marker || marker.version !== 1 || typeof marker.report !== 'function' || typeof marker.sentinel !== 'string' || marker.sentinel === '' || !marker.fixture || typeof marker.fixture.path !== 'string') {
    return refuse('offline mode requires the deterministic fake-transport marker published by the harness preload; none is installed');
  }
  if (marker.sentinel !== OFFLINE_SENTINEL) return refuse('the offline marker names a sentinel other than the pinned one');
  if (marker.fetch !== input.currentFetch || typeof input.currentFetch !== 'function') return refuse('globalThis.fetch is not the fake transport that the harness published');
  if (path.resolve(source) !== marker.fixture.path) return refuse('--source is not the canonical fixture path validated by the harness preload');
  if (typeof input.validateFixture !== 'function') return refuse('offline mode requires an independent fixture validator; none was supplied');
  const fixture = input.validateFixture(path.resolve(source));
  if (!fixture.ok) return refuse(`fixture rejected by the independent check: ${fixture.reason}`);
  if (fixture.path !== marker.fixture.path || fixture.sha256 !== marker.fixture.sha256) return refuse('the marker\'s fixture identity differs from the independently validated fixture');
  for (const name of KEY_NAMES) {
    const value = input.env[name];
    if (value !== undefined && value !== '' && value !== OFFLINE_SENTINEL) return refuse(`${name} is not the pinned sentinel: a real credential is present`);
  }
  const overrides = findEndpointOverrides(input.env);
  if (overrides.length > 0) return refuse(`endpoint/proxy/injection variables are set: ${overrides.join(', ')}`);
  const outDir = path.resolve(positional[0]!);
  const outProblem = checkOfflineOutDir(outDir, input.tmpRoots);
  if (outProblem) return refuse(outProblem);
  let port = 0;
  if (servePort !== undefined) {
    port = Number(servePort);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return refuse('--serve-port must be an integer between 1024 and 65535');
  }
  return {ok: true, mode: 'offline', outDir, source: path.resolve(source), servePort: port};
}
