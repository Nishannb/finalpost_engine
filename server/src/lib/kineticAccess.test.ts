/**
 * V1 Kinetic access (lib/kineticAccess.ts): the pure policy. Synthetic ids only (00000000-…): no real account id exists anywhere in this repository.
 * Fail closed in every environment; production never accepts `all`; one malformed entry voids the list; nothing here may leak an id.
 */
import {describe, expect, it, vi} from 'vitest';

import {
  assertKineticAccess,
  assertKineticJobAccess,
  decideKineticAccess,
  describeKineticAccess,
  isKineticEntitlementMode,
  kineticAccessAllowed,
  kineticAccessFromEnv,
  logKineticAccessAtStartup,
  normalizeUuid,
  parseKineticAccess,
} from './kineticAccess.ts';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const OUTSIDER = '00000000-0000-4000-8000-0000000000ff';
const PROD = 'production';

const logger = () => ({info: vi.fn(), warn: vi.fn(), error: vi.fn()});
const everything = (l: ReturnType<typeof logger>) => JSON.stringify([l.info.mock.calls, l.warn.mock.calls, l.error.mock.calls]);

describe('parseKineticAccess: fail closed', () => {
  it('allowlist with valid UUIDs (case and spaces normalised)', () => {
    const c = parseKineticAccess({mode: ' AllowList ', ids: ` ${A.toUpperCase()} , ${B} `, nodeEnv: PROD});
    expect(c).toEqual({ok: true, mode: 'allowlist', ids: new Set([A, B])});
  });
  it.each([
    ['mode unset (production)', {mode: undefined, ids: A, nodeEnv: PROD}, 'mode_unset'],
    ['mode unset (development): no default grants access either', {mode: undefined, ids: A, nodeEnv: 'development'}, 'mode_unset'],
    ['mode empty', {mode: '  ', ids: A, nodeEnv: PROD}, 'mode_unset'],
    ['unknown mode', {mode: 'everyone', ids: A, nodeEnv: PROD}, 'mode_unknown'],
    ['typo in the mode', {mode: 'allowlst', ids: A, nodeEnv: PROD}, 'mode_unknown'],
    ['`all` is never a production mode', {mode: 'all', ids: '', nodeEnv: PROD}, 'all_not_permitted_in_production'],
    ['`all` with a different casing in production', {mode: 'ALL', ids: A, nodeEnv: ' Production '}, 'all_not_permitted_in_production'],
    ['allowlist with the list unset', {mode: 'allowlist', ids: undefined, nodeEnv: PROD}, 'allowlist_empty'],
    ['allowlist with an empty list', {mode: 'allowlist', ids: '', nodeEnv: PROD}, 'allowlist_empty'],
    ['allowlist with a blank list', {mode: 'allowlist', ids: '   ', nodeEnv: PROD}, 'allowlist_empty'],
    ['one malformed UUID', {mode: 'allowlist', ids: 'not-a-uuid', nodeEnv: PROD}, 'allowlist_malformed'],
    ['one malformed entry among valid ones voids the whole list', {mode: 'allowlist', ids: `${A},${B.slice(0, -1)},${OUTSIDER}`, nodeEnv: PROD}, 'allowlist_malformed'],
    ['a stray comma (empty segment) is malformed', {mode: 'allowlist', ids: `${A},`, nodeEnv: PROD}, 'allowlist_malformed'],
    ['a UUID-shaped value with a bad variant', {mode: 'allowlist', ids: '00000000-0000-4000-c000-000000000001', nodeEnv: PROD}, 'allowlist_malformed'],
  ])('%s -> nobody', (_name, input, problem) => {
    const c = parseKineticAccess(input);
    expect(c).toEqual({ok: false, problem});
    for (const user of [A, B, OUTSIDER, 'dev-user', '']) expect(decideKineticAccess(c, {userId: user}).allowed).toBe(false);
  });
  it('`all` is allowed outside production only, and only when explicitly configured', () => {
    for (const nodeEnv of ['development', 'test', undefined, '']) {
      const c = parseKineticAccess({mode: 'all', nodeEnv});
      expect(c).toEqual({ok: true, mode: 'all'});
      expect(decideKineticAccess(c, {userId: OUTSIDER}).allowed).toBe(true);
    }
  });
  it('reads the settings from an env object', () => {
    expect(kineticAccessFromEnv({NODE_ENV: PROD, V1_KINETIC_ACCESS: 'allowlist', V1_KINETIC_ALLOWED_USER_IDS: A})).toMatchObject({ok: true, mode: 'allowlist'});
    expect(kineticAccessFromEnv({NODE_ENV: PROD})).toEqual({ok: false, problem: 'mode_unset'});
  });
  it('`entitlement` is accepted in production and does not read the UUID list', () => {
    for (const ids of [undefined, '', '   ', 'not-a-uuid', `${A},oops`, A]) {
      const config = parseKineticAccess({mode: ' Entitlement ', ids, nodeEnv: PROD});
      expect(config).toEqual({ok: true, mode: 'entitlement'});
      expect(decideKineticAccess(config, {userId: A})).toEqual({allowed: false, reason: 'entitlement_required'});
      expect(decideKineticAccess(config, {userId: OUTSIDER})).toEqual({allowed: false, reason: 'entitlement_required'});
    }
    expect(isKineticEntitlementMode({NODE_ENV: PROD, V1_KINETIC_ACCESS: 'entitlement', V1_KINETIC_ALLOWED_USER_IDS: 'not-a-uuid'})).toBe(true);
    expect(isKineticEntitlementMode({NODE_ENV: PROD, V1_KINETIC_ACCESS: 'allowlist', V1_KINETIC_ALLOWED_USER_IDS: A})).toBe(false);
    expect(isKineticEntitlementMode({NODE_ENV: PROD, V1_KINETIC_ACCESS: 'all'})).toBe(false);
  });
});

describe('decideKineticAccess', () => {
  const config = parseKineticAccess({mode: 'allowlist', ids: `${A},${B}`, nodeEnv: PROD});
  it('admits listed accounts (any letter case) and refuses everyone else with a fixed code', () => {
    expect(decideKineticAccess(config, {userId: A})).toEqual({allowed: true});
    expect(decideKineticAccess(config, {userId: B.toUpperCase()})).toEqual({allowed: true});
    expect(decideKineticAccess(config, {userId: OUTSIDER})).toEqual({allowed: false, reason: 'not_allowlisted'});
  });
  it('refuses anything that is not a UUID, including the dev-bypass user and non-strings', () => {
    for (const userId of ['dev-user', '', 'x', null, undefined, 42, {}, [A]]) expect(decideKineticAccess(config, {userId})).toEqual({allowed: false, reason: 'invalid_user'});
  });
  it('has no exemption for any auth path: there is no `via` input at all', () => {
    expect(decideKineticAccess.length).toBe(2);
    expect(decideKineticAccess(config, {userId: OUTSIDER, via: 'service-key'} as never).allowed).toBe(false);
    expect(decideKineticAccess(config, {userId: OUTSIDER, via: 'dev'} as never).allowed).toBe(false);
  });
  it('reasons never contain an account id', () => {
    const reasons = [decideKineticAccess(config, {userId: OUTSIDER}), decideKineticAccess(parseKineticAccess({}), {userId: A}), decideKineticAccess(config, {userId: 'x'})];
    for (const r of reasons) expect(JSON.stringify(r)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe('assertKineticAccess / kineticAccessAllowed', () => {
  const env = {NODE_ENV: PROD, V1_KINETIC_ACCESS: 'allowlist', V1_KINETIC_ALLOWED_USER_IDS: A};
  it('passes for a listed account without logging', () => {
    const l = logger();
    expect(() => assertKineticAccess(env, {userId: A}, l, 'create')).not.toThrow();
    expect(kineticAccessAllowed(env, {userId: A})).toBe(true);
    expect(everything(l)).toBe('[[],[],[]]');
  });
  it('refuses with one generic public error for BOTH "not on the list" and "configuration invalid" (no reason leaks to the client)', () => {
    const errors = [
      () => assertKineticAccess(env, {userId: OUTSIDER}, logger(), 'create'),
      () => assertKineticAccess({NODE_ENV: PROD}, {userId: A}, logger(), 'create'),
      () => assertKineticAccess({NODE_ENV: PROD, V1_KINETIC_ACCESS: 'all'}, {userId: A}, logger(), 'create'),
      () => assertKineticAccess({NODE_ENV: PROD, V1_KINETIC_ACCESS: 'entitlement'}, {userId: A}, logger(), 'create'),
    ].map(run => {
      try {
        run();
      } catch (error) {
        return error as {code: string; message: string; details?: unknown};
      }
      throw new Error('expected a refusal');
    });
    for (const e of errors) expect(e).toMatchObject({code: 'kinetic_unavailable', message: 'Kinetic Typography is not available right now. Please try again later.', details: {reason: 'kinetic_access'}});
    expect(new Set(errors.map(e => JSON.stringify([e.code, e.message, e.details]))).size).toBe(1);
  });
  it('logs a fixed reason code and the route label, never an id', () => {
    const l = logger();
    expect(() => assertKineticAccess(env, {userId: OUTSIDER}, l, 'retry')).toThrow();
    expect(l.warn).toHaveBeenCalledWith({where: 'retry', reason: 'not_allowlisted'}, 'kinetic access refused');
    const entitlementLog = logger();
    expect(() => assertKineticAccess({NODE_ENV: PROD, V1_KINETIC_ACCESS: 'entitlement'}, {userId: A}, entitlementLog, 'create')).toThrow();
    expect(entitlementLog.warn).toHaveBeenCalledWith({where: 'create', reason: 'entitlement_required'}, 'kinetic access refused');
    expect(everything(entitlementLog)).not.toContain(A);
    expect(everything(l)).not.toContain(OUTSIDER);
    expect(everything(l)).not.toContain(A);
  });
});

describe('assertKineticJobAccess (retry / assets of an existing job)', () => {
  const base = {NODE_ENV: PROD, V1_KINETIC_RELEASE: true, V1_KINETIC_ACCESS: 'allowlist', V1_KINETIC_ALLOWED_USER_IDS: A};
  const kineticJob = {userId: A, style: 'kinetic_typography'};
  it('lets the listed owner through', () => {
    expect(() => assertKineticJobAccess(base, {userId: A}, kineticJob, logger(), 'retry')).not.toThrow();
  });
  it('refuses the owner of an old Kinetic job once access is revoked (list changed, emptied, malformed or mode removed)', () => {
    for (const patch of [{V1_KINETIC_ALLOWED_USER_IDS: B}, {V1_KINETIC_ALLOWED_USER_IDS: ''}, {V1_KINETIC_ALLOWED_USER_IDS: `${A},oops`}, {V1_KINETIC_ACCESS: ''}]) {
      expect(() => assertKineticJobAccess({...base, ...patch}, {userId: A}, kineticJob, logger(), 'retry')).toThrow(/not available/);
    }
  });
  it('does not touch other styles, other owners, missing jobs, or a release that is off (existing behaviour unchanged)', () => {
    const revoked = {...base, V1_KINETIC_ALLOWED_USER_IDS: B};
    expect(() => assertKineticJobAccess(revoked, {userId: A}, {userId: A, style: 'basic_captions'}, logger(), 'retry')).not.toThrow();
    expect(() => assertKineticJobAccess(revoked, {userId: A}, {userId: B, style: 'kinetic_typography'}, logger(), 'retry')).not.toThrow();
    expect(() => assertKineticJobAccess(revoked, {userId: A}, null, logger(), 'retry')).not.toThrow();
    expect(() => assertKineticJobAccess({...revoked, V1_KINETIC_RELEASE: false}, {userId: A}, kineticJob, logger(), 'retry')).not.toThrow();
  });
});

describe('startup report', () => {
  const idsAbsent = (l: ReturnType<typeof logger>) => expect(everything(l)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  it('says nothing while the release is off', () => {
    const l = logger();
    expect(logKineticAccessAtStartup({NODE_ENV: PROD, V1_KINETIC_RELEASE: false}, l)).toBeNull();
    expect(everything(l)).toBe('[[],[],[]]');
  });
  it('release ON with an invalid configuration: an ERROR that names the problem and says Kinetic is refused, without any id', () => {
    for (const [env, problem] of [
      [{NODE_ENV: PROD, V1_KINETIC_RELEASE: true}, 'mode_unset'],
      [{NODE_ENV: PROD, V1_KINETIC_RELEASE: true, V1_KINETIC_ACCESS: 'all'}, 'all_not_permitted_in_production'],
      [{NODE_ENV: PROD, V1_KINETIC_RELEASE: true, V1_KINETIC_ACCESS: 'allowlist', V1_KINETIC_ALLOWED_USER_IDS: `${A},bad`}, 'allowlist_malformed'],
    ] as const) {
      const l = logger();
      expect(logKineticAccessAtStartup(env, l)).toEqual({state: 'unavailable', problem});
      expect(l.error).toHaveBeenCalledTimes(1);
      expect(String(l.error.mock.calls[0]![1])).toContain('refused for every account');
      expect(l.error.mock.calls[0]![0]).toEqual({problem});
      idsAbsent(l);
    }
  });
  it('release ON with a valid allowlist: an info line with the COUNT only', () => {
    const l = logger();
    expect(logKineticAccessAtStartup({NODE_ENV: PROD, V1_KINETIC_RELEASE: true, V1_KINETIC_ACCESS: 'allowlist', V1_KINETIC_ALLOWED_USER_IDS: `${A},${B}`}, l)).toEqual({state: 'allowlist', allowlistCount: 2});
    expect(l.info).toHaveBeenCalledWith({allowlistCount: 2}, 'V1 Kinetic access: allowlist');
    idsAbsent(l);
  });
  it('explicit global access outside production: a warning', () => {
    const l = logger();
    expect(logKineticAccessAtStartup({NODE_ENV: 'development', V1_KINETIC_RELEASE: true, V1_KINETIC_ACCESS: 'all'}, l)).toEqual({state: 'all'});
    expect(l.warn).toHaveBeenCalledTimes(1);
  });
  it('describeKineticAccess is count-only', () => {
    expect(describeKineticAccess(parseKineticAccess({mode: 'allowlist', ids: A, nodeEnv: PROD}))).toEqual({state: 'allowlist', allowlistCount: 1});
  });
  it('release ON with entitlement mode: an info line, no account id, and a malformed UUID list is ignored', () => {
    const l = logger();
    expect(logKineticAccessAtStartup({NODE_ENV: PROD, V1_KINETIC_RELEASE: true, V1_KINETIC_ACCESS: 'entitlement', V1_KINETIC_ALLOWED_USER_IDS: `${A},bad`}, l)).toEqual({state: 'entitlement'});
    expect(l.info).toHaveBeenCalledWith({}, 'V1 Kinetic access: entitlement (active paid Pro / Pro Plus from RevenueCat; no account allowlist)');
    expect(l.error).not.toHaveBeenCalled();
    idsAbsent(l);
  });
});

describe('normalizeUuid', () => {
  it('accepts UUID versions 1-8 only in canonical shape', () => {
    expect(normalizeUuid(A)).toBe(A);
    expect(normalizeUuid(` ${A.toUpperCase()} `)).toBe(A);
    for (const bad of ['', 'abc', A.replace(/-/g, ''), `${A}x`, '00000000-0000-0000-8000-000000000001', 7, null]) expect(normalizeUuid(bad)).toBeNull();
  });
});
