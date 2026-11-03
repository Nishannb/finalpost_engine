/**
 * WP2: URL-ingest address guard. Pure apart from an injectable resolver (the default uses node:dns), so the classifier and the per-hop decision are unit-testable
 * without a network. It imports only node:net / node:dns and the error taxonomy (no logger, no `.env`, no SDK).
 *
 * Refused: loopback, link-local (including the cloud metadata addresses 169.254.169.254 / 169.254.170.2 / fd00:ec2::254), private (RFC 1918, CGNAT, ULA),
 * unspecified, multicast, reserved and benchmarking ranges, IPv6 forms that embed an IPv4 address (mapped, NAT64, 6to4, compatible), and the hostnames
 * localhost / *.localhost / *.internal / *.local / *.localdomain / metadata.
 *
 * DNS rebinding (WP4A): `assertPublicHttpUrl` alone resolves the host once for the check, so a client that resolved it again could be answered with a private address. `pinPublicHttpUrl`
 * returns the CHECKED address set with the URL, and `pinnedLookup` turns that set into a `lookup` function for node:http / node:https, so the connection can only go to an address that
 * was classified (the original hostname stays the Host header and the TLS server name; nothing is resolved a second time).
 */
import {lookup as dnsLookup} from 'node:dns/promises';
import {isIP, type LookupFunction} from 'node:net';

import {EngineError} from './errors.ts';

export type AddressVerdict = {blocked: false} | {blocked: true; category: string};

const ok: AddressVerdict = {blocked: false};
const block = (category: string): AddressVerdict => ({blocked: true, category});

function ipv4Octets(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(part => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every(value => value >= 0 && value <= 255) ? octets : null;
}

export function classifyIPv4(address: string): AddressVerdict {
  const o = ipv4Octets(address);
  if (!o) return block('malformed_ipv4');
  const [a, b, c] = o as [number, number, number, number];
  if (a === 0) return block('unspecified');
  if (a === 10) return block('private');
  if (a === 100 && b >= 64 && b <= 127) return block('carrier_grade_nat');
  if (a === 127) return block('loopback');
  if (a === 169 && b === 254) return block('link_local_metadata');
  if (a === 172 && b >= 16 && b <= 31) return block('private');
  if (a === 192 && b === 0 && c === 0) return block('ietf_protocol');
  if (a === 192 && b === 168) return block('private');
  if (a === 198 && (b === 18 || b === 19)) return block('benchmarking');
  if (a >= 224 && a <= 239) return block('multicast');
  if (a >= 240) return block('reserved');
  return ok;
}

/** Expand an IPv6 literal into eight 16-bit groups (handles `::` and a trailing dotted IPv4). Returns null when malformed. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  const tail = text.lastIndexOf(':');
  if (text.includes('.')) {
    const octets = ipv4Octets(text.slice(tail + 1));
    if (!octets) return null;
    text = `${text.slice(0, tail + 1)}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (chunk: string): number[] | null => {
    if (chunk === '') return [];
    const groups = chunk.split(':').map(part => (/^[0-9a-f]{1,4}$/.test(part) ? parseInt(part, 16) : Number.NaN));
    return groups.every(Number.isFinite) ? groups : null;
  };
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (!head || !rest) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - rest.length;
  return fill < 1 ? null : [...head, ...Array<number>(fill).fill(0), ...rest];
}

const v4From = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;

export function classifyIPv6(address: string): AddressVerdict {
  const g = ipv6Groups(address);
  if (!g) return block('malformed_ipv6');
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g.every(group => group === 0)) return block('unspecified');
  if (g.slice(0, 7).every(group => group === 0) && g7 === 1) return block('loopback');
  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (deprecated IPv4-compatible): judge the embedded IPv4.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return classifyIPv4(v4From(g6, g7));
  // 64:ff9b::/96 NAT64: judge the embedded IPv4.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return classifyIPv4(v4From(g6, g7));
  // 2002::/16 6to4: judge the embedded IPv4.
  if (g0 === 0x2002) return classifyIPv4(v4From(g1, g2));
  if ((g0 & 0xffc0) === 0xfe80) return block('link_local');
  if ((g0 & 0xfe00) === 0xfc00) return block('unique_local'); // includes the AWS IPv6 metadata address fd00:ec2::254
  if ((g0 & 0xff00) === 0xff00) return block('multicast');
  if (g0 === 0x2001 && g1 === 0x0db8) return block('documentation');
  return ok;
}

export function classifyAddress(address: string): AddressVerdict {
  const kind = isIP(address);
  if (kind === 4) return classifyIPv4(address);
  if (kind === 6) return classifyIPv6(address);
  return block('not_an_ip');
}

const BLOCKED_HOSTNAME = /^(localhost|metadata|metadata\.google\.internal)$|\.(localhost|internal|local|localdomain)$/;

/** Hostname-only verdict (before any DNS). `host` is a WHATWG `URL.hostname`: lower-case, IPv6 in brackets, numeric IPv4 forms already normalised to dotted decimal. */
export function classifyHostname(host: string): AddressVerdict {
  const bare = host.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (bare === '') return block('empty_host');
  if (isIP(bare)) return classifyAddress(bare);
  return BLOCKED_HOSTNAME.test(bare) ? block('internal_hostname') : ok;
}

export type HostResolver = (hostname: string) => Promise<string[]>;

export const resolveHostAddresses: HostResolver = async hostname => (await dnsLookup(hostname, {all: true, verbatim: true})).map(entry => entry.address);

export class BlockedUrlError extends EngineError {
  readonly category: string;
  constructor(category: string) {
    // The message never echoes the URL, the resolved address or the host (nothing about the internal network is revealed to the caller).
    super('source_unreachable', 'Media URL is not allowed', {reason: 'blocked_address', category});
    this.category = category;
  }
}

/**
 * Throws `BlockedUrlError` unless `rawUrl` is http(s) and EVERY address its host resolves to is public. Fails closed: a host that does not resolve, or resolves to nothing,
 * is refused. `allowHosts` is an exact-hostname opt-out (default empty) for a deployment that must fetch from one named internal host.
 */
function parseCheckedUrl(rawUrl: string): {url: URL; hostname: string} {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError('malformed_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('scheme');
  if (url.username || url.password) throw new BlockedUrlError('credentials_in_url');
  return {url, hostname: url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()};
}

const isAllowedHost = (hostname: string, allowHosts: readonly string[] | undefined) => (allowHosts ?? []).some(allowed => allowed.trim().toLowerCase() === hostname);

/**
 * Throws `BlockedUrlError` unless `rawUrl` is http(s) and EVERY address its host resolves to is public. Fails closed: a host that does not resolve, or resolves to nothing,
 * is refused. `allowHosts` is an exact-hostname opt-out (default empty) for a deployment that must fetch from one named internal host.
 */
export async function assertPublicHttpUrl(rawUrl: string, options: {resolve?: HostResolver; allowHosts?: readonly string[]} = {}): Promise<URL> {
  const {url, hostname} = parseCheckedUrl(rawUrl);
  if (isAllowedHost(hostname, options.allowHosts)) return url;
  const named = classifyHostname(url.hostname);
  if (named.blocked) throw new BlockedUrlError(named.category);
  if (isIP(hostname)) return url; // a public literal: nothing to resolve
  let addresses: string[];
  try {
    addresses = await (options.resolve ?? resolveHostAddresses)(hostname);
  } catch {
    throw new BlockedUrlError('unresolvable');
  }
  if (addresses.length === 0) throw new BlockedUrlError('unresolvable');
  for (const address of addresses) {
    const verdict = classifyAddress(address);
    if (verdict.blocked) throw new BlockedUrlError(`resolves_to_${verdict.category}`);
  }
  return url;
}

/** WP4A: a URL together with the addresses that were checked for it. A connection for this URL may go only to one of `addresses`. Never empty. */
export type PinnedTarget = {url: URL; addresses: string[]};

/**
 * WP4A: the same checks as `assertPublicHttpUrl`, but it returns the checked address set so the caller can connect to exactly those addresses (see `pinnedLookup`) instead of letting the
 * HTTP client resolve the host again. Called once per hop, so every redirect target is resolved, classified and pinned on its own.
 *  - any blocked address in the set, or an empty / unresolvable set: `BlockedUrlError` (code source_unreachable, "Media URL is not allowed"); nothing is connected;
 *  - an exact `allowHosts` hostname is not classified (as before) but is still resolved here and pinned to the addresses it resolved to; if it does not resolve, it is refused;
 *  - an IP literal pins to itself.
 * The address ranges that are blocked are exactly those of `classifyAddress`.
 */
export async function pinPublicHttpUrl(rawUrl: string, options: {resolve?: HostResolver; allowHosts?: readonly string[]} = {}): Promise<PinnedTarget> {
  const {url, hostname} = parseCheckedUrl(rawUrl);
  const allowed = isAllowedHost(hostname, options.allowHosts);
  if (!allowed) {
    const named = classifyHostname(url.hostname);
    if (named.blocked) throw new BlockedUrlError(named.category);
  }
  if (isIP(hostname)) return {url, addresses: [hostname]};
  let resolved: string[];
  try {
    resolved = await (options.resolve ?? resolveHostAddresses)(hostname);
  } catch {
    throw new BlockedUrlError('unresolvable');
  }
  const addresses = [...new Set(resolved)];
  if (addresses.length === 0) throw new BlockedUrlError('unresolvable');
  if (!allowed) {
    for (const address of addresses) {
      const verdict = classifyAddress(address);
      if (verdict.blocked) throw new BlockedUrlError(`resolves_to_${verdict.category}`);
    }
  } else if (!addresses.every(address => isIP(address))) {
    throw new BlockedUrlError('unresolvable');
  }
  return {url, addresses};
}

/**
 * WP4A: a `lookup` function (the `lookup` option of node:http / node:https / node:net) that answers only with the pinned addresses, never with a DNS query. Honours `all: true`
 * (Node tries each address) and a `family` filter. An empty set, or a family with no pinned address, is an error, so nothing is connected.
 */
export function pinnedLookup(addresses: readonly string[]): LookupFunction {
  const entries = addresses.flatMap(address => {
    const family = isIP(address);
    return family === 4 || family === 6 ? [{address, family}] : [];
  });
  return (_hostname, options, callback) => {
    const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
    const usable = wanted ? entries.filter(entry => entry.family === wanted) : entries;
    if (usable.length === 0) {
      callback(Object.assign(new Error('no pinned address'), {code: 'ENOTFOUND'}) as NodeJS.ErrnoException, '', 0);
      return;
    }
    if (options.all) {
      (callback as unknown as (error: null, all: Array<{address: string; family: number}>) => void)(null, usable);
      return;
    }
    callback(null, usable[0]!.address, usable[0]!.family);
  };
}

export const MAX_REDIRECT_HOPS = 5;
export const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** The next hop for a redirect response, resolved against the current URL; null when the response is not a followable redirect. */
export function redirectTarget(status: number, location: string | null, current: URL): URL | null {
  if (!REDIRECT_STATUSES.has(status) || !location) return null;
  try {
    return new URL(location, current);
  } catch {
    return null;
  }
}
