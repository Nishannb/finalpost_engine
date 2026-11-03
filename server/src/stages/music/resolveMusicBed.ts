export type MusicBedSource = 'auto' | 'licensed' | 'generated' | 'off';

export type LicensedBed = {url: string};
export type GeneratedBed = {
  url: string;
  bpm?: number;
  key?: string;
  seed?: number;
  cacheKey?: string;
  integratedLufs?: number;
  costUsd?: number;
};

export type ResolvedMusicBed = {
  url: string;
  source: 'licensed' | 'generated';
  bpm?: number;
  key?: string;
  seed?: number;
  cacheKey?: string;
  integratedLufs?: number;
  costUsd?: number;
};

/**
 * The only function that may choose a bed URL.
 * Returns one bed or none — never both.
 */
export function resolveMusicBed(input: {
  licensed?: LicensedBed | null;
  generated?: GeneratedBed | null;
  source: MusicBedSource;
}): ResolvedMusicBed | null {
  const licensed = clean(input.licensed?.url);
  const generated = input.generated && clean(input.generated.url) ? input.generated : null;
  if (input.source === 'off') return null;
  if (input.source === 'licensed') {
    return licensed ? {url: licensed, source: 'licensed'} : null;
  }
  if (input.source === 'generated') {
    return generated ? toGenerated(generated) : null;
  }
  if (licensed) return {url: licensed, source: 'licensed'};
  if (generated) return toGenerated(generated);
  return null;
}

function toGenerated(bed: GeneratedBed): ResolvedMusicBed {
  return {
    url: clean(bed.url) as string,
    source: 'generated',
    bpm: bed.bpm,
    key: bed.key,
    seed: bed.seed,
    cacheKey: bed.cacheKey,
    integratedLufs: bed.integratedLufs,
    costUsd: bed.costUsd,
  };
}

function clean(url: string | undefined): string | null {
  const trimmed = (url ?? '').trim();
  return trimmed ? trimmed : null;
}
