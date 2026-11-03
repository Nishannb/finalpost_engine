/**
 * WP4A: one GET whose connection can only go to the addresses the address guard checked. No logger, no SDK: node:http / node:https and the guard only.
 *
 * The URL keeps its hostname, so the Host header and the TLS server name are the original hostname; the `lookup` option replaces DNS with the pinned set, so the HTTP client never
 * resolves the name again. `agent: false` gives every request its own connection (no pooled socket from an earlier hop is reused). Redirects are NOT followed here.
 */
import http from 'node:http';
import https from 'node:https';

import {pinnedLookup, type PinnedTarget} from './addressGuard.ts';

/**
 * WP4B: the headers of every source-download hop. `Accept-Encoding: identity` asks the server for the file as is: the downloader never decompresses, so a compressed body would otherwise
 * be written to disk as if it were the video.
 */
export function sourceRequestHeaders(): Record<string, string> {
  return {
    // GCS and some CDNs 403 the default Node user-agent.
    'User-Agent': 'KinmelVideoEngine/0.1 (video ingest)',
    Accept: '*/*',
    'Accept-Encoding': 'identity',
  };
}

/** WP4B: true when a response's `Content-Encoding` is absent, empty or `identity` (any case, surrounding space ignored). Anything else (gzip, br, deflate, a list, an unknown token) is not. */
export function isIdentityContentEncoding(value: string | string[] | undefined): boolean {
  if (value === undefined) return true;
  const values = Array.isArray(value) ? value : [value];
  return values.every(item => ['', 'identity'].includes(item.trim().toLowerCase()));
}

export function pinnedGet(target: PinnedTarget, options: {headers: Record<string, string>; signal?: AbortSignal}): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const transport = target.url.protocol === 'https:' ? https : http;
    const request = transport.request(
      target.url,
      {method: 'GET', headers: options.headers, signal: options.signal, agent: false, lookup: pinnedLookup(target.addresses)},
      resolve,
    );
    request.once('error', reject);
    request.end();
  });
}
