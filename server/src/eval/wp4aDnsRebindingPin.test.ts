/**
 * WP4A pure tests: every hop connects only to the addresses the address guard checked. lib/addressGuard.ts imports only node:net, node:dns/promises (never called: the resolver is
 * injected) and the error taxonomy. lib/tempFiles.ts (logger, env) and lib/pinnedGet.ts (node:http/https) are read as text. No network, no socket, no DNS.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {assertPublicHttpUrl, BlockedUrlError, pinnedLookup, pinPublicHttpUrl, type HostResolver} from '../lib/addressGuard.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts: string[]) => readFileSync(resolve(SRC, ...parts), 'utf8');
const stripComments = (source: string) => source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const answers = (table: Record<string, string[]>): HostResolver & {calls: string[]} => {
  const calls: string[] = [];
  const resolver = (async (host: string) => {
    calls.push(host);
    const found = table[host];
    if (!found) throw new Error('ENOTFOUND');
    return found;
  }) as HostResolver & {calls: string[]};
  resolver.calls = calls;
  return resolver;
};

const refused = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, caught => caught);
  expect(error).toBeInstanceOf(BlockedUrlError);
  expect((error as BlockedUrlError).code).toBe('source_unreachable');
  expect((error as BlockedUrlError).message).toBe('Media URL is not allowed');
  return error as BlockedUrlError;
};

type Answer = {address: string; family: number};
const ask = (lookup: ReturnType<typeof pinnedLookup>, options: Record<string, unknown> = {}) =>
  new Promise<{error: Error | null; address: unknown; family: unknown}>(done => {
    (lookup as unknown as (host: string, options: unknown, callback: (error: Error | null, address: unknown, family: unknown) => void) => void)('cdn.example.com', options, (error, address, family) => done({error, address, family}));
  });

describe('the pin decision', () => {
  it('a public address is the only connect target', async () => {
    const pin = await pinPublicHttpUrl('https://cdn.example.com/a.mp4', {resolve: answers({'cdn.example.com': ['93.184.216.34']})});
    expect(pin.addresses).toEqual(['93.184.216.34']);
    expect(pin.url.hostname).toBe('cdn.example.com'); // the original name stays the URL: Host header and TLS server name
  });
  it('several public addresses are all allowed targets, deduplicated, in resolver order', async () => {
    const pin = await pinPublicHttpUrl('https://cdn.example.com/a.mp4', {resolve: answers({'cdn.example.com': ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946', '93.184.216.34']})});
    expect(pin.addresses).toEqual(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']);
  });
  it('a set that contains 127.0.0.1 is refused before any connect, with the existing error', async () => {
    const error = await refused(pinPublicHttpUrl('https://rebind.example.com/a.mp4', {resolve: answers({'rebind.example.com': ['93.184.216.34', '127.0.0.1']})}));
    expect(error.category).toBe('resolves_to_loopback');
  });
  it('every blocked family in a set refuses it (private, metadata, ULA, mapped IPv4)', async () => {
    for (const bad of ['10.0.0.5', '169.254.169.254', 'fd00:ec2::254', '::ffff:127.0.0.1', '192.168.1.1']) {
      await refused(pinPublicHttpUrl('https://x.example.com/', {resolve: answers({'x.example.com': ['8.8.8.8', bad]})}));
    }
  });
  it('an empty set, or a name that does not resolve, is refused', async () => {
    await refused(pinPublicHttpUrl('https://x.example.com/', {resolve: answers({'x.example.com': []})}));
    await refused(pinPublicHttpUrl('https://nope.example.com/', {resolve: answers({})}));
  });
  it('the refusal message never echoes the URL, host or address', async () => {
    const error = await refused(pinPublicHttpUrl('https://secret.example.com/', {resolve: answers({'secret.example.com': ['10.1.2.3']})}));
    expect(error.message).not.toMatch(/secret|10\.1\.2\.3/);
  });
  it('the scheme, credentials, malformed URL and blocked hostname checks are unchanged', async () => {
    for (const bad of ['ftp://x.example.com/', 'https://u:p@x.example.com/', 'not a url', 'http://localhost/', 'http://foo.internal/', 'http://127.0.0.1/', 'http://[::1]/']) {
      await refused(pinPublicHttpUrl(bad, {resolve: answers({'x.example.com': ['8.8.8.8']})}));
    }
  });
  it('a public IP literal pins to itself and resolves nothing', async () => {
    const resolver = answers({});
    const pin = await pinPublicHttpUrl('http://93.184.216.34/a.mp4', {resolve: resolver});
    expect(pin.addresses).toEqual(['93.184.216.34']);
    expect(resolver.calls).toEqual([]);
  });
  it('agrees with assertPublicHttpUrl for every non-allowed host (same verdict, same URL)', async () => {
    const cases: Record<string, string[]> = {'ok.example.com': ['93.184.216.34'], 'bad.example.com': ['127.0.0.1'], 'mixed.example.com': ['8.8.8.8', '10.0.0.1']};
    for (const host of Object.keys(cases)) {
      const url = `https://${host}/x`;
      const assertResult = await assertPublicHttpUrl(url, {resolve: answers(cases)}).then(value => value.href, () => 'refused');
      const pinResult = await pinPublicHttpUrl(url, {resolve: answers(cases)}).then(value => value.url.href, () => 'refused');
      expect(pinResult).toBe(assertResult);
    }
  });
});

describe('a redirect hop gets its own pin', () => {
  it('each hop is resolved, classified and pinned on its own; a hop that rebinds is refused', async () => {
    const resolver = answers({'cdn.example.com': ['93.184.216.34'], 'edge.example.net': ['151.101.1.1'], 'evil.example.org': ['169.254.169.254']});
    const first = await pinPublicHttpUrl('https://cdn.example.com/a', {resolve: resolver});
    const second = await pinPublicHttpUrl('https://edge.example.net/b', {resolve: resolver});
    expect(first.addresses).toEqual(['93.184.216.34']);
    expect(second.addresses).toEqual(['151.101.1.1']);
    expect(resolver.calls).toEqual(['cdn.example.com', 'edge.example.net']);
    await refused(pinPublicHttpUrl('https://evil.example.org/c', {resolve: resolver}));
  });
  it('the same name answered differently on a later hop is pinned to the later, checked answer', async () => {
    let n = 0;
    const flip: HostResolver = async () => (n++ === 0 ? ['93.184.216.34'] : ['93.184.216.35']);
    expect((await pinPublicHttpUrl('https://a.example.com/', {resolve: flip})).addresses).toEqual(['93.184.216.34']);
    expect((await pinPublicHttpUrl('https://a.example.com/', {resolve: flip})).addresses).toEqual(['93.184.216.35']);
  });
});

describe('INGEST_ALLOWED_PRIVATE_HOSTS', () => {
  it('an allowed exact hostname is pinned to the addresses it resolved to (not classified, as before)', async () => {
    const pin = await pinPublicHttpUrl('http://media.internal/a.mp4', {allowHosts: ['media.internal'], resolve: answers({'media.internal': ['10.0.0.7']})});
    expect(pin.addresses).toEqual(['10.0.0.7']);
  });
  it('the allow list is not widened: another name, a subdomain or a parent stays blocked', async () => {
    const resolver = answers({'other.internal': ['10.0.0.7'], 'a.media.internal': ['10.0.0.7']});
    await refused(pinPublicHttpUrl('http://other.internal/', {allowHosts: ['media.internal'], resolve: resolver}));
    await refused(pinPublicHttpUrl('http://a.media.internal/', {allowHosts: ['media.internal'], resolve: resolver}));
    await refused(pinPublicHttpUrl('http://127.0.0.1/', {allowHosts: ['media.internal'], resolve: resolver}));
  });
  it('an allowed host that does not resolve (nothing to pin) is refused; an allowed name is case-insensitive', async () => {
    await refused(pinPublicHttpUrl('http://media.internal/', {allowHosts: ['media.internal'], resolve: answers({})}));
    const pin = await pinPublicHttpUrl('http://Media.Internal/', {allowHosts: [' MEDIA.internal '], resolve: answers({'media.internal': ['10.0.0.7']})});
    expect(pin.addresses).toEqual(['10.0.0.7']);
  });
  it('assertPublicHttpUrl still returns an allowed host without resolving it (unchanged)', async () => {
    const resolver = answers({});
    await assertPublicHttpUrl('http://media.internal/', {allowHosts: ['media.internal'], resolve: resolver});
    expect(resolver.calls).toEqual([]);
  });
});

describe('the lookup the connection uses', () => {
  it('answers only with pinned addresses (single answer)', async () => {
    const result = await ask(pinnedLookup(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']));
    expect(result).toEqual({error: null, address: '93.184.216.34', family: 4});
  });
  it('with all: true (Node\'s dual-stack connect) answers with every pinned address and nothing else', async () => {
    const result = await ask(pinnedLookup(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']), {all: true});
    expect(result.error).toBeNull();
    expect(result.address as Answer[]).toEqual([{address: '93.184.216.34', family: 4}, {address: '2606:2800:220:1:248:1893:25c8:1946', family: 6}]);
  });
  it('honours a family filter and errors when the pinned set has none of that family', async () => {
    expect((await ask(pinnedLookup(['93.184.216.34', '2606:2800::1']), {family: 6})).address).toBe('2606:2800::1');
    const none = await ask(pinnedLookup(['93.184.216.34']), {family: 6});
    expect(none.error).toBeInstanceOf(Error);
  });
  it('an empty pinned set connects to nothing', async () => {
    const result = await ask(pinnedLookup([]));
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as NodeJS.ErrnoException).code).toBe('ENOTFOUND');
  });
  it('ignores the requested hostname: it never consults DNS or returns anything outside the set', async () => {
    const lookup = pinnedLookup(['93.184.216.34']);
    for (const host of ['localhost', 'metadata', '127.0.0.1', 'rebind.example.com']) {
      const result = await new Promise<{address: unknown}>(done => (lookup as unknown as (h: string, o: unknown, c: (e: Error | null, a: unknown) => void) => void)(host, {}, (_e, address) => done({address})));
      expect(result.address).toBe('93.184.216.34');
    }
  });
  it('a non-IP entry in a set is never offered', async () => {
    expect((await ask(pinnedLookup(['not-an-ip', '93.184.216.34']), {all: true})).address).toEqual([{address: '93.184.216.34', family: 4}]);
  });
});

describe('downloadToFile uses the pin (source text)', () => {
  const temp = stripComments(read('lib', 'tempFiles.ts'));
  const get = stripComments(read('lib', 'pinnedGet.ts'));
  const guard = stripComments(read('lib', 'addressGuard.ts'));
  it('it pins the first URL and each redirect target with pinPublicHttpUrl, and no longer calls assertPublicHttpUrl or fetch', () => {
    expect(temp.match(/pinPublicHttpUrl\(/g)).toHaveLength(2);
    expect(temp).toContain('let target = await pinPublicHttpUrl(url, {allowHosts});');
    expect(temp).toContain('target = await pinPublicHttpUrl(next.href, {allowHosts});');
    expect(temp).not.toMatch(/assertPublicHttpUrl|\bfetch\(/);
  });
  it('every request goes through pinnedGet with the pinned target', () => {
    expect(temp).toContain('response = await pinnedGet(target, {');
    expect(temp.match(/pinnedGet\(/g)).toHaveLength(1);
  });
  it('the redirect loop and its hop limit are as before: manual, MAX_REDIRECT_HOPS, a new pin before the next request', () => {
    const loop = temp.slice(temp.indexOf('for (let hops = 0;'), temp.indexOf('const status ='));
    expect(loop).toContain('if (hops >= MAX_REDIRECT_HOPS) {');
    expect(loop.indexOf('if (hops >= MAX_REDIRECT_HOPS)')).toBeLessThan(loop.indexOf('target = await pinPublicHttpUrl(next.href'));
    expect(loop).toContain('redirectTarget(response.statusCode ?? 0,');
  });
  it('the request connects through the pinned lookup, keeps the hostname URL, uses its own connection and does not follow redirects', () => {
    expect(get).toContain('transport.request(\n      target.url,');
    expect(get).toContain('lookup: pinnedLookup(target.addresses)');
    expect(get).toContain('agent: false');
    expect(get).not.toMatch(/\.hostname\s*=|servername|setHeader\(\s*'host'|host:/i);
    expect(get).not.toMatch(/redirect|follow/i);
    expect(get).not.toContain('dns');
  });
  it('the pure guard has no logger and exports the decision', () => {
    expect([...guard.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort()).toEqual(['./errors.ts', 'node:dns/promises', 'node:net']);
    expect(guard).toContain('export async function pinPublicHttpUrl');
    expect(guard).toContain('export function pinnedLookup');
  });
  it('the blocked ranges and the error are untouched', () => {
    expect(guard).toContain("super('source_unreachable', 'Media URL is not allowed'");
    expect(guard).toContain("if (a === 169 && b === 254) return block('link_local_metadata');");
    expect(guard).toContain("if ((g0 & 0xfe00) === 0xfc00) return block('unique_local');");
  });
  it('the remaining behaviour of the download is kept: byte ceiling, declared length, empty file, timeout mapping', () => {
    expect(temp).toContain("throw new EngineError('source_too_large', 'Source video is too large');");
    expect(temp).toContain("if (declared > options.maxBytes) {");
    expect(temp).toContain("throw new EngineError('source_unreachable', 'Source video was empty');");
    expect(temp).toContain("new EngineError('upstream_timeout', 'Source download timed out')");
  });
  it('the other caller of the guard (the Lambda output check) still uses assertPublicHttpUrl before its download', () => {
    expect(stripComments(read('lib', 'lambdaOutputCheck.ts'))).toContain('await assertPublicHttpUrl(input.outputUrl');
  });
  it('the defaults are untouched', () => {
    const env = stripComments(read('config', 'env.ts'));
    expect(env).toMatch(/PRODUCT_EDIT_PROFILE:[^\n]*cuts/);
    expect(env).toMatch(/MOTION_GRAPHICS_ENABLED:\s*bool\(false\)/);
  });
});
