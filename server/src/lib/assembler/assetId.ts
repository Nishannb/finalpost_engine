export const ASSET_ID_MAX_LENGTH = 32;
export const ASSET_ID_PREFIXES = ['ub', 'sc'] as const;

const ASSET_ID_PATTERN = /^(ub|sc)_[A-Za-z0-9]{1,16}$/;

export type ParsedAssetId =
  | {status: 'absent'}
  | {status: 'legal'; id: string}
  | {status: 'illegal'; preview: string};

export function previewAssetId(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length <= 24) {
    return trimmed || '(empty)';
  }
  return `${trimmed.slice(0, 16)}…(len ${trimmed.length})`;
}

export function isLegalAssetId(raw: string): boolean {
  return raw.length <= ASSET_ID_MAX_LENGTH && ASSET_ID_PATTERN.test(raw);
}

export function parseLegalAssetId(raw: unknown): ParsedAssetId {
  if (raw == null) {
    return {status: 'absent'};
  }
  const text = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  if (!text) {
    return {status: 'absent'};
  }
  if (text.length > ASSET_ID_MAX_LENGTH || !ASSET_ID_PATTERN.test(text)) {
    return {status: 'illegal', preview: previewAssetId(text)};
  }
  return {status: 'legal', id: text};
}
