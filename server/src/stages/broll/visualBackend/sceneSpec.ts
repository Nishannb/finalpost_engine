/**
 * WP53: the pure scene spec shared by every visual backend (riso / collage_gbro / anidoodle / native). Intent vs render: the toolkit (cutaway / counter / kinetic_text / card / emphasis) is WHY, the L2 template id is WHICH
 * move, the backend is HOW it is drawn. A spec whose on-screen text or numbers are not grounded in the spoken sentence is rejected (`visual_backend:ungrounded`): live polish never ships invented copy or statistics.
 */
export type VisualBackendId = 'riso' | 'collage_gbro' | 'anidoodle' | 'native';
export type VisualToolkit = 'cutaway' | 'counter' | 'kinetic_text' | 'card' | 'emphasis';

export type VisualSceneSpec = {
  /** Catalog id (clip_27..34). */
  templateId: string;
  toolkit: VisualToolkit;
  backend: VisualBackendId;
  start: number;
  end: number;
  /** Verbatim spoken window. */
  sentence: string;
  /** Substrings of `sentence` only. */
  onScreenText: string[];
  numbers?: Array<{label: string; value: number; unit?: string}>;
  accent?: string;
  ground?: string;
  ink?: string;
  aspect: '9:16';
  width: 1080 | 720;
  height: 1920 | 1280;
};

/** Lower-case, strip punctuation / markup brackets, collapse whitespace. */
export function normalizeGrounding(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[\[\]]/g, ' ')
    .replace(/[^a-z0-9%$'\s.]/g, ' ')
    .replace(/(?<![0-9])\.|\.(?![0-9])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGroundedText(text: string, sentence: string): boolean {
  const needle = normalizeGrounding(text);
  if (!needle) return false;
  return ` ${normalizeGrounding(sentence)} `.includes(` ${needle} `);
}

const SMALL_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};

/** Every number the sentence actually states: digits ("200", "10,000", "1.5") and simple number words. */
export function spokenNumbers(sentence: string): number[] {
  const found: number[] = [];
  const clean = sentence.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1');
  for (const match of clean.matchAll(/\d+(?:\.\d+)?/g)) found.push(Number(match[0]));
  for (const match of clean.matchAll(/\b[a-z]+\b/g)) {
    const value = SMALL_WORDS[match[0]];
    if (value !== undefined) found.push(value);
  }
  return found;
}

export function isGroundedNumber(value: number, sentence: string): boolean {
  return spokenNumbers(sentence).some(n => n === value);
}

export type SceneSpecCheck = {ok: true} | {ok: false; warning: string; detail: string};

export function validateSceneSpec(spec: VisualSceneSpec): SceneSpecCheck {
  const fail = (detail: string): SceneSpecCheck => ({ok: false, warning: 'visual_backend:ungrounded', detail});
  if (!spec.sentence.trim()) return fail('empty sentence');
  if (!(spec.end > spec.start)) return fail('empty window');
  for (const text of spec.onScreenText) if (!isGroundedText(text, spec.sentence)) return fail(`text not in sentence: ${text}`);
  for (const item of spec.numbers ?? []) if (!isGroundedNumber(item.value, spec.sentence)) return fail(`number not in sentence: ${item.value}`);
  return {ok: true};
}

export type RisoPaletteId = 'pal-blue' | 'pal-teal' | 'pal-red' | 'pal-ink';

function hexToHsl(hex: string): {h: number; s: number; l: number} | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return {h: 0, s: 0, l};
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return {h, s, l};
}

/** Nearest riso palette by mood: red/orange/pink -> red, yellow-green/teal/cyan -> teal, blue/violet -> blue, grey / dark neutral -> ink. Never a hardcoded fluorescent pink. */
export function mapPaletteToRiso(accent?: string, ground?: string): RisoPaletteId {
  const a = accent ? hexToHsl(accent) : null;
  if (!a) {
    const g = ground ? hexToHsl(ground) : null;
    return g && g.l < 0.2 ? 'pal-ink' : 'pal-blue';
  }
  if (a.s < 0.15) return 'pal-ink';
  if (a.h < 50 || a.h >= 320) return 'pal-red';
  if (a.h < 200) return 'pal-teal';
  return 'pal-blue';
}
