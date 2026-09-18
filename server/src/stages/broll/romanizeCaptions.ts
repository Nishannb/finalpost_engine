/**
 * Display captions for non-English / code-mixed speech.
 *
 * Goal: same spoken wording in Latin letters (Hinglish / romanji), NEVER an
 * English translation. Example: "दोस्तों" / spoken "doston" → "doston", not "friends".
 */

import {env} from '../../config/env.ts';
import {requestJson} from '../../lib/http.ts';
import {stageLogger} from '../../lib/logger.ts';
import type {CaptionWord, LanguageCode, WordToken} from '../../types/blueprint.ts';
import {hasNonLatinScript} from './englishSearch.ts';

const log = stageLogger('stage-c-romanize');

type GeminiResponse = {
  candidates?: Array<{content?: {parts?: Array<{text?: string}>}}>;
};

/** Common English glosses Gemini wrongly substitutes — reject these mappings. */
const ENGLISH_GLOSSES = new Set([
  'hello', 'hi', 'hey', 'thanks', 'thank', 'you', 'please', 'yes', 'no', 'friend',
  'friends', 'good', 'morning', 'night', 'love', 'water', 'food', 'home',
  'work', 'today', 'tomorrow', 'yesterday', 'swim', 'swimming', 'travel',
  'people', 'guys', 'folks', 'welcome', 'back', 'listen', 'look', 'okay', 'ok',
  'because', 'before', 'after', 'never', 'always', 'really', 'very', 'thing',
  'things', 'world', 'life', 'time', 'video', 'content', 'creator', 'creators',
]);

const INDIC_LANG =
  /hindi|nepali|tamil|urdu|marathi|bengali|gujarati|punjabi|devanagari|\bhi\b|\bne\b|\bta\b|\bur\b/i;

export function needsRomanization(
  text: string,
  detectedLanguage = '',
  languageCode: LanguageCode | 'auto' | string = '',
): boolean {
  if (hasNonLatinScript(text)) {
    return true;
  }
  const lang = `${detectedLanguage} ${languageCode}`.toLowerCase();
  return INDIC_LANG.test(lang);
}

/** ASR forced to English often translates Hindi — recover spoken Hinglish. */
export function needsHinglishRecovery(input: {
  transcript: string;
  detectedLanguage: string;
  languageCode: LanguageCode | 'auto' | string;
}): boolean {
  const lang = `${input.detectedLanguage} ${input.languageCode}`.toLowerCase();
  const indicHint =
    INDIC_LANG.test(lang) ||
    input.languageCode === 'hi' ||
    input.languageCode === 'ne' ||
    input.languageCode === 'ta';
  if (!indicHint && !hasNonLatinScript(input.transcript)) {
    return false;
  }
  if (hasNonLatinScript(input.transcript)) {
    return true;
  }
  // Latin transcript + Indic language → likely English glosses or already Hinglish.
  // Always run recovery so English glosses become romanized spoken forms.
  return indicHint;
}

export async function romanizeCaptionWords(input: {
  captionWords: CaptionWord[];
  words: WordToken[];
  transcript: string;
  detectedLanguage: string;
  languageCode?: LanguageCode | 'auto' | string;
}): Promise<CaptionWord[]> {
  const languageCode = input.languageCode ?? '';
  const shouldTouch =
    needsRomanization(input.transcript, input.detectedLanguage, languageCode) ||
    needsHinglishRecovery({
      transcript: input.transcript,
      detectedLanguage: input.detectedLanguage,
      languageCode,
    });

  if (!shouldTouch) {
    return input.captionWords;
  }

  if (!env.GEMINI_API_KEY) {
    return input.captionWords.map(word => ({
      ...word,
      text: roughAscii(word.text) || word.text,
    }));
  }

  try {
    if (
      needsHinglishRecovery({
        transcript: input.transcript,
        detectedLanguage: input.detectedLanguage,
        languageCode,
      })
    ) {
      const recovered = await recoverSpokenRomanCaptions(input);
      if (recovered.length === input.captionWords.length) {
        return recovered;
      }
    }

    const unique = [
      ...new Set(
        [...input.captionWords, ...input.words]
          .map(word => word.text.trim())
          .filter(text => text.length > 0),
      ),
    ].slice(0, 220);

    if (unique.length === 0) {
      return input.captionWords;
    }

    const map = await fetchRomanizationMap(unique, input.detectedLanguage, languageCode);
    return input.captionWords.map(word => {
      const key = word.text.trim();
      const mapped = map.get(key);
      if (mapped && isValidRomanization(key, mapped)) {
        return {...word, text: mapped};
      }
      return {...word, text: roughAscii(word.text) || word.text};
    });
  } catch (error) {
    log.warn({error}, 'romanization failed; using ascii fold');
    return input.captionWords.map(word => ({
      ...word,
      text: roughAscii(word.text) || word.text,
    }));
  }
}

export function isValidRomanization(original: string, candidate: string): boolean {
  const out = candidate.trim();
  if (!out) {
    return false;
  }
  // Already-Latin originals that are NOT English glosses may stay themselves.
  if (!hasNonLatinScript(original)) {
    const bareOut = out.toLowerCase().replace(/[^a-z]/g, '');
    const bareIn = original.toLowerCase().replace(/[^a-z]/g, '');
    if (bareOut === bareIn) {
      return true;
    }
    // Reject swapping a Latin token for a different English gloss.
    if (ENGLISH_GLOSSES.has(bareOut) && bareOut !== bareIn) {
      return false;
    }
    return /^[A-Za-z][A-Za-z0-9'’-]*$/.test(out.replace(/[,.!?]+$/u, ''));
  }
  const bare = out.toLowerCase().replace(/[^a-z]/g, '');
  if (ENGLISH_GLOSSES.has(bare) && bare.length <= 12) {
    return false;
  }
  const latin = out.replace(/[^A-Za-z]/g, '');
  return latin.length >= Math.min(2, original.length);
}

/**
 * Keep timings; rewrite each caption token into romanized spoken language
 * (Hinglish etc.), never English translation.
 */
async function recoverSpokenRomanCaptions(input: {
  captionWords: CaptionWord[];
  words: WordToken[];
  transcript: string;
  detectedLanguage: string;
  languageCode?: string;
}): Promise<CaptionWord[]> {
  const preferred = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(preferred)}:generateContent` +
    `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const payload = input.captionWords.slice(0, 280).map((word, index) => ({
    i: index,
    t: word.text,
  }));

  const prompt =
    `Speech language hint: ${input.detectedLanguage || input.languageCode || 'unknown'}.\n` +
    `Full ASR transcript (may be wrongly translated to English):\n${input.transcript.slice(0, 3500)}\n\n` +
    `Task: Rewrite EACH caption token into ROMANIZED spoken wording (Hinglish / romanji).\n` +
    `Rules:\n` +
    `- Keep the SAME language the speaker used. Hindi words stay Hindi, written in English letters.\n` +
    `- Do NOT translate into English meaning. "दोस्तों"/spoken doston → "doston" (NOT "friends").\n` +
    `- If a token was already English because the speaker said English, keep that English word.\n` +
    `- If ASR translated a Hindi word into English, restore the likely romanized Hindi word.\n` +
    `- Examples: friends→doston, people→log, because→kyunki, today→aaj, video→video (loanword OK).\n` +
    `- Output Latin letters only. Keep punctuation attached.\n` +
    `- Return JSON: {"items":[{"i":0,"t":"romanized"}, ...]}\n\n` +
    JSON.stringify(payload);

  const body = await requestJson<GeminiResponse>(url, {
    method: 'POST',
    label: 'Gemini hinglish captions',
    failureCode: 'broll_failed',
    timeoutMs: 45_000,
    retries: 1,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      contents: [{role: 'user', parts: [{text: prompt}]}],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    }),
  });

  const text = body.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? '')
    .join('')
    .trim();
  if (!text) {
    return input.captionWords;
  }

  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '')) as {
    items?: Array<{i?: number; t?: string}>;
  };
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  if (items.length === 0) {
    return input.captionWords;
  }

  const byIndex = new Map<number, string>();
  for (const item of items) {
    const index = Number(item.i);
    const token = String(item.t ?? '').trim();
    if (!Number.isFinite(index) || !token) {
      continue;
    }
    const original = input.captionWords[index]?.text ?? '';
    if (isValidRomanization(original, token) || /^[A-Za-z0-9'’.,!?-]+$/.test(token)) {
      // Extra guard: do not keep English gloss when original was non-Latin.
      if (hasNonLatinScript(original) && ENGLISH_GLOSSES.has(token.toLowerCase().replace(/[^a-z]/g, ''))) {
        continue;
      }
      byIndex.set(index, token);
    }
  }

  if (byIndex.size < Math.max(3, Math.floor(input.captionWords.length * 0.35))) {
    log.warn({mapped: byIndex.size, total: input.captionWords.length}, 'hinglish recovery sparse');
    return input.captionWords;
  }

  log.info({mapped: byIndex.size}, 'caption words hinglish-recovered');
  return input.captionWords.map((word, index) => {
    const mapped = byIndex.get(index);
    if (!mapped) {
      return {...word, text: roughAscii(word.text) || word.text};
    }
    return {...word, text: mapped};
  });
}

async function fetchRomanizationMap(
  words: string[],
  detectedLanguage: string,
  languageCode: string,
): Promise<Map<string, string>> {
  const preferred = env.GEMINI_MODEL || 'gemini-3.6-flash';
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(preferred)}:generateContent` +
    `?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const prompt =
    `Detected speech language: ${detectedLanguage || languageCode || 'unknown'}.\n` +
    `Task: ROMANIZE only (transliterate pronunciation into Latin letters).\n` +
    `Keep the SAME language wording. Do NOT translate into English.\n` +
    `This is Hinglish / romanji style: Hindi (or other) words written with English alphabets.\n` +
    `Examples:\n` +
    `- नमस्ते → namaste (NOT hello)\n` +
    `- धन्यवाद → dhanyavaad (NOT thank you)\n` +
    `- दोस्तों → doston (NOT friends)\n` +
    `- पानी → paani (NOT water)\n` +
    `- நீங்கள் → neengal (NOT you)\n` +
    `If a token is already Latin letters and is NOT an English translation gloss, return it unchanged.\n` +
    `Keep punctuation attached to the token.\n` +
    `Return JSON object mapping original→romanized only.\n\n` +
    JSON.stringify(words);

  const body = await requestJson<GeminiResponse>(url, {
    method: 'POST',
    label: 'Gemini romanize captions',
    failureCode: 'broll_failed',
    timeoutMs: 35_000,
    retries: 1,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      contents: [{role: 'user', parts: [{text: prompt}]}],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
    }),
  });

  const text = body.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? '')
    .join('')
    .trim();
  if (!text) {
    return new Map();
  }
  const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '')) as Record<
    string,
    unknown
  >;
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.trim() && isValidRomanization(key, value)) {
      map.set(key, value.trim());
    }
  }
  log.info({words: map.size}, 'caption words romanized');
  return map;
}

function roughAscii(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .trim();
}
