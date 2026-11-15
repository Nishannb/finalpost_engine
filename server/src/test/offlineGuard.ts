/**
 * Vitest setup (server/vitest.config.ts): offline engine tests must not be able to reach a real provider.
 *  1. Secret-looking variables exported by the developer's shell are removed from `process.env` before any test file loads (`.env` files are already skipped by config/dotenvLoader.ts under vitest).
 *     Tests that need a (fake) key set it themselves, after this runs.
 *  2. `fetch` to a known provider host is refused locally unless the test replaced `fetch` with its own stub (every existing test that touches a provider does).
 * Opt out for a deliberate live run with ENGINE_TEST_LOAD_DOTENV=1. Does not apply outside vitest.
 */
type EnvLike = Record<string, string | undefined>;

export const SECRET_NAME = /(API_KEY|SECRET_KEY|_SECRET|ACCESS_KEY(_ID)?|AUTH_TOKEN|_TOKEN)$/i;
// built from parts, as the repo's own source-text tests do (eval/wp3cGeminiBudget.test.ts), so this file, which only BLOCKS these hosts, is not mistaken for a call site
const host = (...parts: string[]) => parts.join('.');
export const PROVIDER_HOSTS = [host('generativelanguage', 'googleapis', 'com'), host('api', 'anthropic', 'com'), host('api', 'openai', 'com'), host('api', 'groq', 'com'), host('api', 'runware', 'ai'), host('api', 'elevenlabs', 'io')] as readonly string[];

/** removes secret-looking variables; returns the NAMES removed (never values) */
export function scrubSecrets(env: EnvLike): string[] {
  const removed: string[] = [];
  for (const k of Object.keys(env)) if (SECRET_NAME.test(k)) { delete env[k]; removed.push(k); }
  return removed;
}

export const isProviderUrl = (input: unknown): boolean => {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as {url?: string})?.url ?? String(input);
    const host = new URL(url).hostname.toLowerCase();
    return PROVIDER_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
  } catch { return false; }
};

export function installFetchGuard(g: {fetch?: typeof fetch}): void {
  const inner = g.fetch;
  if (!inner || (inner as {__offlineGuard?: boolean}).__offlineGuard) return;
  const guarded = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (isProviderUrl(input)) throw new Error('offline test guard: a test tried to reach a real provider host; stub fetch in the test (ENGINE_TEST_LOAD_DOTENV=1 is for deliberate live runs only)');
    return inner(input, init);
  }) as typeof fetch;
  (guarded as {__offlineGuard?: boolean}).__offlineGuard = true;
  g.fetch = guarded;
}

if (process.env.VITEST === 'true' && process.env.ENGINE_TEST_LOAD_DOTENV !== '1') {
  scrubSecrets(process.env);
  installFetchGuard(globalThis as {fetch?: typeof fetch});
}
