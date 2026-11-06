/**
 * WP15: KLIPY GIF / sticker search client.
 * Uses KLIPY_APP_KEY. Prefer MP4 URLs for Remotion (OffthreadVideo). Do not rewrite static.* URLs (ToS).
 * Server-side search+bake may require written KLIPY approval — see docs/klipy notes in WP15 report.
 */

import {env} from '../../config/env.ts';
import {jobFlag} from '../../lib/effectiveFlags.ts';
import {requestJson} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {KlipyKind} from './klipyContextQuery.ts';

const log = stageLogger('stage-klipy');

const BASE = 'https://api.klipy.com/api/v1';

export type KlipyAsset = {
  provider: 'klipy';
  providerId: number;
  slug: string;
  title: string;
  kind: KlipyKind;
  /** Prefer mp4 for Remotion video path; gif/webp as image fallback. */
  assetUrl: string;
  mediaKind: 'video' | 'image';
  width: number;
  height: number;
  credit: string;
  creditUrl: string;
  query: string;
};

type FileVariant = {url?: string; width?: number; height?: number; size?: number};
type FileBucket = Partial<Record<'gif' | 'webp' | 'jpg' | 'mp4' | 'webm', FileVariant>>;
type KlipyItem = {
  id?: number | string;
  slug?: string;
  title?: string;
  type?: string;
  file?: Partial<Record<'hd' | 'md' | 'sm' | 'xs', FileBucket>>;
};

type KlipySearchResponse = {
  result?: boolean;
  data?: {data?: KlipyItem[]; current_page?: number; per_page?: number; has_next?: boolean};
};

export function klipyConfigured(): boolean {
  return Boolean(env.KLIPY_APP_KEY?.trim()) && jobFlag('klipyOverlays', env.KLIPY_OVERLAYS_ENABLED) !== false;
}

function pickFile(item: KlipyItem): {url: string; mediaKind: 'video' | 'image'; width: number; height: number} | null {
  const buckets = [item.file?.md, item.file?.hd, item.file?.sm, item.file?.xs].filter(Boolean) as FileBucket[];
  for (const bucket of buckets) {
    const mp4 = bucket.mp4;
    if (mp4?.url) {
      return {url: mp4.url, mediaKind: 'video', width: mp4.width ?? 320, height: mp4.height ?? 320};
    }
  }
  for (const bucket of buckets) {
    const webp = bucket.webp ?? bucket.gif ?? bucket.jpg;
    if (webp?.url) {
      return {url: webp.url, mediaKind: 'image', width: webp.width ?? 320, height: webp.height ?? 320};
    }
  }
  return null;
}

function toAsset(item: KlipyItem, kind: KlipyKind, query: string): KlipyAsset | null {
  const file = pickFile(item);
  if (!file) return null;
  const rawId = typeof item.id === 'number' ? item.id : Number(item.id);
  const providerId = Number.isFinite(rawId) && rawId > 0 ? Math.trunc(rawId % 1_000_000_000) : Math.abs(hashSlug(item.slug ?? file.url)) % 1_000_000_000;
  const slug = item.slug ?? String(item.id ?? 'klipy');
  return {
    provider: 'klipy',
    providerId,
    slug,
    title: item.title ?? slug,
    kind,
    assetUrl: file.url,
    mediaKind: file.mediaKind,
    width: file.width,
    height: file.height,
    credit: 'KLIPY',
    creditUrl: 'https://klipy.com',
    query,
  };
}

/** Deterministic non-crypto hash for slug → providerId when KLIPY id is missing. */
function hashSlug(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/**
 * Search KLIPY GIFs or stickers. Returns the first usable asset (caller may pass excludeSlugs).
 * `customerId` should be stable per end-user when available (KLIPY personalization).
 */
export async function searchKlipy(input: {
  kind: KlipyKind;
  query: string;
  customerId?: string;
  excludeSlugs?: Set<string>;
  contentFilter?: 'off' | 'low' | 'medium' | 'high';
}): Promise<KlipyAsset | null> {
  if (!klipyConfigured()) return null;
  const key = env.KLIPY_APP_KEY.trim();
  const path = input.kind === 'sticker' ? 'stickers/search' : 'gifs/search';
  const url = new URL(`${BASE}/${encodeURIComponent(key)}/${path}`);
  url.searchParams.set('q', input.query);
  url.searchParams.set('page', '1');
  url.searchParams.set('per_page', '8');
  url.searchParams.set('content_filter', input.contentFilter ?? 'high');
  url.searchParams.set('customer_id', input.customerId ?? 'finalpost-engine');
  url.searchParams.set('locale', 'us');

  try {
    const body = await requestJson<KlipySearchResponse>(url.toString(), {
      label: `klipy-${input.kind}-search`,
      timeoutMs: 12_000,
      retries: 1,
      failureCode: 'internal',
    });
    const items = body.data?.data ?? [];
    for (const item of items) {
      if (item.type === 'ad') continue;
      const slug = item.slug ?? '';
      if (slug && input.excludeSlugs?.has(slug)) continue;
      const asset = toAsset(item, input.kind, input.query);
      if (asset) return asset;
    }
    log.info({query: input.query, kind: input.kind, count: items.length}, 'klipy search empty');
    return null;
  } catch (error) {
    log.warn({err: error, query: input.query, kind: input.kind}, 'klipy search failed');
    return null;
  }
}
