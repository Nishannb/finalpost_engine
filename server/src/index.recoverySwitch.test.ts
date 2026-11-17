/**
 * Boot gate: FULL_EDIT_RECOVERY_ENABLED decides whether index.ts starts the recovery worker.
 * The rest of startup (store connect, listen) still runs when the worker stays off.
 */
import {afterEach, describe, expect, it, vi} from 'vitest';

const state = vi.hoisted(() => ({
  enabled: false,
  started: 0,
  listened: 0,
}));

vi.mock('./config/env.ts', () => ({
  env: {
    PORT: 0,
    NODE_ENV: 'test',
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_JWT_SECRET: '',
    DEV_AUTH_BYPASS: false,
    get FULL_EDIT_RECOVERY_ENABLED() {
      return state.enabled;
    },
  },
  isProduction: () => false,
}));

vi.mock('./pipeline/captionsEditRunner.ts', () => ({
  startFullEditRecoveryWorker: () => {
    state.started += 1;
  },
}));

vi.mock('./app.ts', () => ({
  createApp: () => ({
    listen: (_port: number, cb?: () => void) => {
      state.listened += 1;
      cb?.();
      return {close(done?: () => void) { done?.(); }};
    },
  }),
}));

vi.mock('./store/kv.ts', () => ({getKv: async () => ({})}));
vi.mock('./lib/sfxCatalog.ts', () => ({validateSfxLibrary: async () => ({issues: []})}));
vi.mock('./lib/kineticAccess.ts', () => ({logKineticAccessAtStartup: () => {}}));
vi.mock('./lib/logger.ts', () => ({logger: {info() {}, warn() {}, error() {}, debug() {}}}));

const bootListeners = {
  SIGTERM: [] as NodeJS.SignalsListener[],
  SIGINT: [] as NodeJS.SignalsListener[],
  unhandledRejection: [] as NodeJS.UnhandledRejectionListener[],
};

afterEach(() => {
  for (const listener of bootListeners.SIGTERM) process.off('SIGTERM', listener);
  for (const listener of bootListeners.SIGINT) process.off('SIGINT', listener);
  for (const listener of bootListeners.unhandledRejection) process.off('unhandledRejection', listener);
  bootListeners.SIGTERM = [];
  bootListeners.SIGINT = [];
  bootListeners.unhandledRejection = [];
});

async function boot(): Promise<void> {
  state.started = 0;
  state.listened = 0;
  const before = {
    SIGTERM: new Set(process.listeners('SIGTERM')),
    SIGINT: new Set(process.listeners('SIGINT')),
    unhandledRejection: new Set(process.listeners('unhandledRejection')),
  };
  vi.resetModules();
  await import('./index.ts');
  await vi.waitFor(() => {
    if (state.listened === 0) throw new Error('engine has not listened yet');
  });
  bootListeners.SIGTERM = process.listeners('SIGTERM').filter(listener => !before.SIGTERM.has(listener));
  bootListeners.SIGINT = process.listeners('SIGINT').filter(listener => !before.SIGINT.has(listener));
  bootListeners.unhandledRejection = process.listeners('unhandledRejection').filter(listener => !before.unhandledRejection.has(listener));
}

describe('index recovery switch', () => {
  it('does not start the recovery worker when the switch is off', async () => {
    state.enabled = false;
    await boot();
    expect(state.started).toBe(0);
    expect(state.listened).toBe(1);
  });

  it('starts the recovery worker once when the switch is on', async () => {
    state.enabled = true;
    await boot();
    expect(state.started).toBe(1);
    expect(state.listened).toBe(1);
  });
});
