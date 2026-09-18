/**
 * Stock-search hygiene.
 *
 * Pexels matches query tokens, not meaning. A transcript word like "app" or
 * "women" therefore returns phones and laundry even when the video is about
 * travel. Every search we fire must be a multi-word scene, never a leftover
 * noun from ASR.
 */

const GENERIC_STOCK_WORDS = new Set([
  'about', 'action', 'ambitious', 'app', 'apps', 'application', 'bold',
  'community', 'content', 'day', 'dream', 'dreams', 'follow', 'followers',
  'inspiration', 'life', 'like', 'live', 'living', 'make', 'mobile',
  'online', 'people', 'person', 'phone', 'really', 'see', 'thing', 'things',
  'time', 'today', 'using', 'video', 'want', 'way', 'work', 'working',
  'world', 'your',
]);

/** Kept in scene queries so Pexels does not fill "traveler" with the wrong gender. */
const SUBJECT_WORDS = new Set([
  'woman', 'women', 'man', 'men', 'girl', 'girls', 'guy', 'guys',
]);

export type StockSubject = 'woman' | 'man' | null;

const THEME_SCENES: Array<{needles: string[]; queries: string[]}> = [
  {
    needles: [
      'passport', 'travel', 'airport', 'flight', 'plane', 'airplane', 'trip',
      'adventure', 'destination', 'visa', 'suitcase', 'luggage', 'abroad',
    ],
    queries: [
      'woman walking airport terminal',
      'woman looking airplane window',
      'passport stamps closeup',
      'woman hiking mountain trail',
      'woman pulling suitcase airport',
    ],
  },
  {
    needles: ['coffee', 'cafe', 'latte', 'espresso'],
    queries: [
      'coffee pour latte art',
      'busy cafe morning',
      'espresso machine closeup',
    ],
  },
  {
    needles: ['skincare', 'skin', 'glow', 'makeup', 'beauty', 'serum'],
    queries: [
      'skincare routine bathroom',
      'applying moisturizer closeup',
      'natural sunlight portrait',
    ],
  },
  {
    needles: ['gym', 'workout', 'fitness', 'run', 'running', 'lift'],
    queries: [
      'sunrise outdoor running',
      'gym weight training',
      'athlete stretching outdoors',
    ],
  },
  {
    needles: ['cook', 'recipe', 'food', 'kitchen', 'meal'],
    queries: [
      'home cooking in kitchen',
      'plating restaurant food',
      'fresh ingredients closeup',
    ],
  },
  {
    needles: ['business', 'sales', 'client', 'brand', 'startup', 'money'],
    queries: [
      'laptop work at cafe',
      'city office skyline',
      'creative desk overhead',
    ],
  },
];

const FILLER_WORDS = new Set([
  'a', 'an', 'and', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with',
]);

const DEFAULT_SCENES = [
  'cinematic city street night',
  'golden hour portrait outdoors',
  'hands writing in notebook',
];

export function isGenericStockWord(word: string): boolean {
  return GENERIC_STOCK_WORDS.has(word.trim().toLowerCase());
}

/** Drop single generic nouns and keep a 2–6 word Pexels scene query. */
export function sanitizeVisualQuery(raw: string): string {
  const parts = raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => !FILLER_WORDS.has(word))
    .filter(
      word =>
        SUBJECT_WORDS.has(word) ||
        !isGenericStockWord(word) ||
        word.length > 8,
    )
    .slice(0, 6);
  const sceneParts = parts.filter(word => !SUBJECT_WORDS.has(word));
  // "women" alone is not a scene. "woman walking airport" is.
  if (sceneParts.length === 0) {
    return '';
  }
  if (parts.length >= 2) {
    return parts.join(' ');
  }
  if (parts.length === 1 && !isGenericStockWord(parts[0]!)) {
    return `${parts[0]} cinematic`;
  }
  return '';
}

/**
 * Queries to try, in order. Never falls back to a lone transcript noun
 * ("app", "women") which is how unrelated stock used to leak in.
 */
export function keywordFallbacks(keyword: string): string[] {
  const cleaned = sanitizeVisualQuery(keyword);
  if (!cleaned) {
    return [];
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  if (parts.length >= 2) {
    out.push(parts.join(' '));
  }
  if (parts.length >= 3) {
    out.push(parts.slice(0, 3).join(' '));
  }
  return [...new Set(out)];
}

export function themeQueriesFromTranscript(transcript: string, count = 4): string[] {
  const hay = transcript.toLowerCase();
  const subject = inferStockSubject(transcript);
  const scored = THEME_SCENES.map(theme => ({
    hits: theme.needles.filter(needle => hay.includes(needle)).length,
    queries: theme.queries,
  }))
    .filter(theme => theme.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  const pool = scored.length > 0 ? scored.flatMap(theme => theme.queries) : DEFAULT_SCENES;
  return [...new Set(pool)]
    .map(query => applySubjectToQuery(query, subject))
    .slice(0, Math.max(2, count));
}

export function inferStockSubject(transcript: string): StockSubject {
  const hay = transcript.toLowerCase();
  const count = (needles: string[]) =>
    needles.reduce((sum, needle) => sum + (hay.split(needle).length - 1), 0);
  const women = count(['women', 'woman', 'girls', 'girl', 'ladies', 'female']);
  const men = count([' men', ' man', 'guys', ' guy', 'male', 'boys']);
  if (women > men && women > 0) {
    return 'woman';
  }
  if (men > women && men > 0) {
    return 'man';
  }
  return null;
}

const PEOPLE_SCENE =
  /\b(travel|airport|hiking|walking|passport|trip|adventure|solo|backpack|portrait|tourist|suitcase|terminal|boarding|lounge|traveler|traveller)\b/i;

export function applySubjectToQuery(query: string, subject: StockSubject): string {
  const cleaned = query.trim();
  if (!subject || !cleaned) {
    return cleaned;
  }
  if (/\b(woman|women|man|men|girl|girls|guy|guys)\b/i.test(cleaned)) {
    return cleaned.replace(
      /\b(women|woman|men|man|girls|girl|guys|guy)\b/gi,
      subject,
    );
  }
  if (PEOPLE_SCENE.test(cleaned)) {
    return `${subject} ${cleaned}`;
  }
  return cleaned;
}

/**
 * Extra Pexels phrasings so "travel" stock does not default to men when the
 * talk is about women (and vice versa). Object closeups are left alone.
 */
export function genderedQueryVariants(
  query: string,
  subject: StockSubject,
): string[] {
  const cleaned = query.trim();
  if (!cleaned) {
    return [];
  }
  const bases = keywordFallbacks(cleaned);
  const pool = bases.length > 0 ? bases : [cleaned];
  if (!subject) {
    return pool;
  }
  const alt = subject === 'woman' ? 'female' : 'male';
  const out: string[] = [];
  for (const item of pool) {
    const people =
      PEOPLE_SCENE.test(item) ||
      /^(woman|women|man|men|female|male)\b/i.test(item);
    if (!people) {
      out.push(item);
      continue;
    }
    const rest = item.replace(/^(woman|women|man|men|female|male)\s+/i, '');
    out.push(`${subject} ${rest}`.trim());
    out.push(`${alt} ${rest}`.trim());
    if (subject === 'woman') {
      out.push(`women ${rest}`.trim());
    }
  }
  return [...new Set(out.filter(value => value.split(/\s+/).length >= 2))];
}

/** 1–2 short spoken slogans for side-of-frame type, never over the face. */
export function keyPhrasesFromTranscript(transcript: string, max = 2): string[] {
  const fromTo = transcript.match(
    /\bfrom\s+[a-z]+(?:\s+[a-z]+)?\s+to\s+[a-z]+/i,
  );
  const out: string[] = [];
  if (fromTo) {
    out.push(fromTo[0].replace(/\s+/g, ' ').trim());
  }
  const sentences = transcript
    .split(/[.!?]/)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(part => part.split(' ').length >= 3 && part.split(' ').length <= 7);
  for (const sentence of sentences) {
    if (out.length >= max) {
      break;
    }
    if (out.some(existing => existing.toLowerCase() === sentence.toLowerCase())) {
      continue;
    }
    out.push(sentence);
  }
  return out.slice(0, max);
}
