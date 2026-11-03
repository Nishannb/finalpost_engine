/**
 * WP2 pure tests: the address classifier, the per-hop URL decision (with an injected resolver: no DNS, no network) and the post-render integrity decision.
 * Import graph: addressGuard.ts, renderIntegrity.ts, errors.ts, billingGuard.ts (node:async_hooks only), node:net, node:dns/promises (imported, never called: the
 * resolver is always injected). No logger, `.env`, SDK, FFmpeg or network client. Source-text checks read files; they do not import the wired modules.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

import {assertPublicHttpUrl, BlockedUrlError, classifyAddress, classifyHostname, redirectTarget} from '../lib/addressGuard.ts';
import {assertRenderOutputValid, judgeRenderOutput, type RenderExpectation} from '../lib/renderIntegrity.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const blocked = (address: string) => classifyAddress(address).blocked;

describe('classifyAddress', () => {
  it('blocks loopback, link-local/metadata, private, CGNAT, unspecified, multicast, reserved (IPv4)', () => {
    for (const address of ['127.0.0.1', '127.255.255.254', '169.254.169.254', '169.254.170.2', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '240.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.0.8']) {
      expect(blocked(address), address).toBe(true);
    }
  });
  it('allows public IPv4 and the edges just outside each private range', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.0.1', '169.255.0.1', '192.167.0.1', '11.0.0.1', '223.255.255.255']) {
      expect(blocked(address), address).toBe(false);
    }
  });
  it('blocks IPv6 loopback, unspecified, link-local, unique-local (incl. AWS metadata), multicast, documentation', () => {
    for (const address of ['::1', '::', 'fe80::1', 'febf::1', 'fc00::1', 'fd00:ec2::254', 'ff02::1', '2001:db8::1']) expect(blocked(address), address).toBe(true);
  });
  it('judges the IPv4 embedded in mapped, compatible, NAT64 and 6to4 IPv6 forms', () => {
    for (const address of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:10.1.2.3', '::127.0.0.1', '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::1', '2002:a9fe:a9fe::']) {
      expect(blocked(address), address).toBe(true);
    }
    for (const address of ['::ffff:8.8.8.8', '64:ff9b::808:808', '2002:808:808::1', '2606:4700:4700::1111', '2001:4860:4860::8888']) expect(blocked(address), address).toBe(false);
  });
  it('fails closed on anything that is not an address', () => {
    for (const address of ['', 'example.com', '999.1.1.1', '1.2.3', 'gggg::1']) expect(blocked(address), address).toBe(true);
  });
});

describe('classifyHostname', () => {
  it('blocks internal names and literals, however the URL spelled the IPv4', () => {
    for (const host of ['localhost', 'LOCALHOST', 'app.localhost', 'metadata.google.internal', 'metadata', 'db.internal', 'printer.local', 'host.localdomain', 'localhost.', '[::1]', '127.0.0.1', '']) {
      expect(classifyHostname(host).blocked, host).toBe(true);
    }
    // WHATWG URL normalises these to dotted decimal before the guard sees them.
    for (const spelled of ['http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://127.1/', 'http://[::ffff:7f00:1]/']) {
      expect(classifyHostname(new URL(spelled).hostname).blocked, spelled).toBe(true);
    }
  });
  it('lets ordinary public names through to resolution', () => {
    expect(classifyHostname('cdn.example.com').blocked).toBe(false);
    expect(classifyHostname('storage.googleapis.com').blocked).toBe(false);
  });
});

describe('assertPublicHttpUrl (resolver injected)', () => {
  const never = async () => {
    throw new Error('resolver must not be called');
  };
  const to = (...addresses: string[]) => async () => addresses;
  const reason = async (url: string, resolve = never as (h: string) => Promise<string[]>, allowHosts: string[] = []) => {
    try {
      await assertPublicHttpUrl(url, {resolve, allowHosts});
      return null;
    } catch (error) {
      expect(error).toBeInstanceOf(BlockedUrlError);
      return (error as BlockedUrlError).category;
    }
  };

  it('refuses the required literals without resolving anything', async () => {
    expect(await reason('http://127.0.0.1/a.mp4')).toBe('loopback');
    expect(await reason('http://169.254.169.254/latest/meta-data/')).toBe('link_local_metadata');
    expect(await reason('http://[fd00:ec2::254]/')).toBe('unique_local');
    expect(await reason('http://localhost:8090/x')).toBe('internal_hostname');
    expect(await reason('http://metadata.google.internal/computeMetadata/v1/')).toBe('internal_hostname');
  });
  it('refuses a public-looking name that resolves to an internal address, including when any one of several answers is internal', async () => {
    expect(await reason('https://evil.example/a.mp4', to('10.0.0.5'))).toBe('resolves_to_private');
    expect(await reason('https://evil.example/a.mp4', to('93.184.216.34', '169.254.169.254'))).toBe('resolves_to_link_local_metadata');
    expect(await reason('https://evil.example/a.mp4', to('::ffff:127.0.0.1'))).toBe('resolves_to_loopback');
  });
  it('fails closed when the host does not resolve, resolves to nothing, or the scheme/URL is wrong', async () => {
    expect(await reason('https://nx.example/a.mp4', async () => { throw new Error('ENOTFOUND'); })).toBe('unresolvable');
    expect(await reason('https://empty.example/a.mp4', to())).toBe('unresolvable');
    expect(await reason('file:///etc/passwd')).toBe('scheme');
    expect(await reason('ftp://example.com/a')).toBe('scheme');
    expect(await reason('not a url')).toBe('malformed_url');
    expect(await reason('https://user:pw@example.com/a')).toBe('credentials_in_url');
  });
  it('accepts a public host and a public literal', async () => {
    const url = await assertPublicHttpUrl('https://cdn.example.com/a.mp4?x=1', {resolve: to('93.184.216.34', '2606:4700:4700::1111')});
    expect(url.hostname).toBe('cdn.example.com');
    expect((await assertPublicHttpUrl('http://8.8.8.8/a.mp4', {resolve: never})).hostname).toBe('8.8.8.8');
  });
  it('honours an exact-hostname opt-out only, and never for a different host', async () => {
    expect(await reason('http://media.corp.internal/a.mp4', never, ['media.corp.internal'])).toBeNull();
    expect(await reason('http://other.corp.internal/a.mp4', never, ['media.corp.internal'])).toBe('internal_hostname');
    expect(await reason('http://127.0.0.1/a', never, [])).toBe('loopback');
  });
  it('does not echo the URL, host or address in the error message', async () => {
    try {
      await assertPublicHttpUrl('http://169.254.169.254/secret-path', {resolve: never});
    } catch (error) {
      expect((error as Error).message).toBe('Media URL is not allowed');
      expect(JSON.stringify((error as BlockedUrlError).details)).not.toContain('169.254');
      expect((error as BlockedUrlError).code).toBe('source_unreachable');
    }
  });
});

describe('redirect hops', () => {
  const here = new URL('https://cdn.example.com/dir/a.mp4');
  it('resolves relative and absolute Location headers and ignores non-redirects', () => {
    expect(redirectTarget(302, '/b.mp4', here)?.href).toBe('https://cdn.example.com/b.mp4');
    expect(redirectTarget(301, 'http://127.0.0.1/x', here)?.href).toBe('http://127.0.0.1/x');
    expect(redirectTarget(200, '/b.mp4', here)).toBeNull();
    expect(redirectTarget(302, null, here)).toBeNull();
  });
  it('a redirect onto an internal address is refused by the same per-hop check', async () => {
    const resolveNever = async () => {
      throw new Error('literal needs no DNS');
    };
    for (const location of ['http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://10.0.0.1/', '//localhost/x']) {
      const next = redirectTarget(302, location, here)!;
      await expect(assertPublicHttpUrl(next.href, {resolve: resolveNever}), location).rejects.toBeInstanceOf(BlockedUrlError);
    }
  });
});

describe('downloadToFile wiring (source text; the module imports the logger so it is not imported)', () => {
  const text = readFileSync(resolve(SRC, 'lib', 'tempFiles.ts'), 'utf8');
  it('follows redirects by hand and checks the first URL and every hop before fetching', () => {
    // WP4A: the hops are still followed by hand (pinnedGet never follows a redirect) and each one is checked AND pinned before it is requested.
    expect(text).not.toContain("redirect: 'follow'");
    expect(text).not.toMatch(/\bfetch\(/);
    expect(text).toMatch(/let target = await pinPublicHttpUrl\(url, \{allowHosts\}\)/);
    expect(text).toMatch(/target = await pinPublicHttpUrl\(next\.href, \{allowHosts\}\)/);
    expect(text.indexOf('pinPublicHttpUrl(url')).toBeLessThan(text.indexOf('await pinnedGet(target'));
    expect(text).toContain('MAX_REDIRECT_HOPS');
  });
  it('the default allowlist is empty', () => {
    const env = readFileSync(resolve(SRC, 'config', 'env.ts'), 'utf8');
    expect(env).toMatch(/INGEST_ALLOWED_PRIVATE_HOSTS: str\(\),/);
  });
});

const GOOD = {path: '/x.mp4', exists: true, bytes: 2_000_000, probe: {width: 1080, height: 1920, durationSec: 30.1, fps: 30, hasAudio: true}, decode: {ok: true, videoFrames: 900, decodedSec: 30, errors: []}};
const EXPECT: RenderExpectation = {width: 1080, height: 1920, durationSec: 30, expectAudio: true};
const checks = (output: Parameters<typeof judgeRenderOutput>[0], expected = EXPECT) => judgeRenderOutput(output, expected).map(item => item.check);

describe('judgeRenderOutput', () => {
  it('passes a good file', () => {
    expect(checks(GOOD)).toEqual([]);
    expect(() => assertRenderOutputValid(GOOD, EXPECT)).not.toThrow();
  });
  it('fails a missing, empty or unreadable file with one named check', () => {
    expect(checks({path: '/x', exists: false, bytes: 0})).toEqual(['output_missing']);
    expect(checks({...GOOD, bytes: 0, probe: undefined, decode: undefined})).toEqual(['output_empty']);
    expect(checks({...GOOD, bytes: 9_999})).toEqual(['output_empty']);
    expect(checks({path: '/x', exists: true, bytes: 50_000, probeError: 'moov atom not found'})).toEqual(['output_unreadable']);
  });
  it('fails wrong dimensions and wrong duration (truncated or padded)', () => {
    expect(checks({...GOOD, probe: {...GOOD.probe, width: 720, height: 1280}})).toEqual(['dimensions_mismatch']);
    expect(checks({...GOOD, probe: {...GOOD.probe, durationSec: 12}})).toEqual(['duration_mismatch']);
    expect(checks({...GOOD, probe: {...GOOD.probe, durationSec: 30.4}})).toEqual([]); // within the 0.5 s tolerance
    expect(checks({...GOOD, probe: {...GOOD.probe, durationSec: 30.6}})).toEqual(['duration_mismatch']);
    expect(checks(GOOD, {...EXPECT, durationSec: Number.NaN})).toEqual(['duration_mismatch']);
  });
  it('fails a silent render only when the source is known to have audio', () => {
    const silent = {...GOOD, probe: {...GOOD.probe, hasAudio: false}};
    expect(checks(silent)).toEqual(['audio_missing']);
    expect(checks(silent, {...EXPECT, expectAudio: false})).toEqual([]);
    expect(checks(silent, {...EXPECT, expectAudio: undefined})).toEqual([]);
  });
  it('treats absent decode facts as a failure and a bad decode as corruption', () => {
    expect(checks({...GOOD, decode: undefined})).toEqual(['output_not_decoded']);
    expect(checks({...GOOD, decode: {ok: false, videoFrames: 400, decodedSec: 13, errors: ['decoded 400 video frames, expected at least 882']}})).toEqual(['output_corrupt']);
  });
  it('reports every failed check together and throws a typed render_failed naming them', () => {
    const bad = {...GOOD, probe: {width: 720, height: 1280, durationSec: 5, fps: 30, hasAudio: false}, decode: undefined};
    expect(checks(bad)).toEqual(['dimensions_mismatch', 'duration_mismatch', 'audio_missing', 'output_not_decoded']);
    try {
      assertRenderOutputValid(bad, EXPECT);
      expect.unreachable();
    } catch (error) {
      expect((error as {code: string}).code).toBe('render_failed');
      expect((error as Error).message).toContain('dimensions_mismatch, duration_mismatch, audio_missing, output_not_decoded');
    }
  });
});

describe('localRender wiring (source text)', () => {
  const text = readFileSync(resolve(SRC, 'stages', 'render', 'localRender.ts'), 'utf8');
  it('inspects the exact upload file after the colour grade and before any upload or engine-served fallback', () => {
    const check = text.indexOf('assertRenderOutputValid(await inspectOutput(uploadPath)');
    expect(check).toBeGreaterThan(text.indexOf('uploadPath = gradedPath'));
    expect(check).toBeLessThan(text.indexOf('uploadRenderedVideo(uploadPath'));
    expect(check).toBeLessThan(text.indexOf('persistLocalServedRender(\n        uploadPath'));
  });
  it('is not inside the upload try/catch that falls back to local serving', () => {
    const between = text.slice(text.indexOf('assertRenderOutputValid('), text.indexOf('uploadRenderedVideo(uploadPath'));
    expect(between).toMatch(/\n    try \{\n      const uploaded/);
  });
});
