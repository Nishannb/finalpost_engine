/**
 * D1: kinetic director client, beside the stage-2 Gemini director (stages/broll/geminiDirector.ts, untouched). It asks for a KineticPlan JSON (words, roles, preset NAMES, layering / anchor / region intent):
 * never pixels, frame numbers or font sizes. The answer is validated (zod + transcript fidelity + density) by plan.ts; any failure goes straight to the deterministic fallback and records why (there is no model retry).
 * Gemini is called only when the existing GEMINI_API_KEY is configured. `call` is injectable (tests / other providers).
 */
import {PRESETS, closestPreset, isKnownPreset} from './presets.ts';
import {resolvePlan, type ResolvedPlan} from './plan.ts';
import {PRESET_NAMES, type BrandConfig, type KineticShot, type KineticWord} from './schema.ts';
import type {ShotScene} from './scene.ts';

export type DirectorCall = (input: {system: string; user: string}) => Promise<string>;

export const KINETIC_DIRECTOR_SYSTEM = `You are the typography director for a vertical talking-head video. You only TAG: you choose the plan style and font pairing, which transcript words become text events, each word's ROLE, the zone, the ENTRY and EXIT of every lockup and the accent colour of every hero. A deterministic solver owns pixels, sizes, frames and easing.
Return ONLY JSON: {"version":"1","style":"cinematicClean"|"editorialLuxury"|"retroNeon","fontPair":"street"|"editorial"|"neon","events":[{id,shotId,wordRange:[startWordIdx,endWordIdx],lines:[{text,role:"hero"|"support"|"connector"|"punch",enter?:"IN-1"|"IN-3"}],preset,layering:"behind"|"front"|"auto",anchor:"auto",regionHint:"besideLeft"|"besideRight"|"upper"|"behindSignature"|"stackOverCutout"|"auto",enter?:"IN-1"|...|"IN-10",exit?:"OUT-1"|"OUT-2"|"OUT-3"|"OUT-4"|"OUT-5"|"OUT-7",accent?:"gold"|"magenta"|"cyan"|"crimson"|"white"|"lime"|"orange"|"violet"|"ice"|"#rrggbb",pose?:"flat"|"recede"|"isometric"|"trapezoid"|"slant",title?:boolean,persistAcrossCut?:boolean,needsCustomTreatment?:{description},matchCut?:{keyword,swapKeyword?,variant?:"memo"|"editorial"|"newsprint"}}]}.
STYLE (one per plan): this is a 3D kinetic typography / LED edit, not captioning. "retroNeon" for hype, tools, effects, viral, editor talk (accent colour + glow on the hero); "editorialLuxury" for softer brand / craft lines; "cinematicClean" only when the plate is already loud and white type reads best.
FONT PAIR (one per plan, stay consistent): "street" = heavy grotesk lead-ins + condensed display caps hero (loud, hype, creator, news); "editorial" = clean sans lead-ins + serif-italic hero (luxury, craft, brand, calm); "neon" = sans lead-ins + one script hero (playful, nightlife, aesthetic, creative). Choose by the PLATE and the topic, not by habit.
ACCENT (per hero, optional but expected): pick a colour that suits THIS plate. The SHOTS line gives the plate's mean colour and brightness: choose a hue that separates from it (a cyan / blue plate wants magenta, gold, crimson or white; a warm plate wants cyan, ice or white; a bright plate wants crimson, violet or a dark-ish hue). The storyboard sheet colours (yellow F2C14E, lime E6FF3B, teal 4FD8C9, pink FF4FA8, gradient) are NOT a default and must not be cycled; keep to ONE primary accent and at most one secondary for the whole video (a different colour on every hero reads as a rainbow, not a look). The solver checks contrast and only nudges brightness, it never replaces your hue.
ROLES (per word, one role per line; split a phrase into several lines when its words have different roles): connector = function words (a, the, i, my, to, of, and, you, we, it, is, are, was, be, for, in, on, that, this, like, just); hero = ONE emphasis word OR multi-word brand/tool name per headline block (exactly one hero line); support = a trailing or leading content word next to the hero; punch = a question or call to action, ONE lockup the eye reads in order (a CTA like "follow me for more valuable tips" is a single punch event, never several, and it is never split across the frame).
Do NOT emit "running" lines: every spoken word that is not part of a lockup is shown by a caption track in the gaps (and a word that is in a lockup is never captioned). Lockups must be FREQUENT: a ~40 s talking-head wants about 12-18 headline blocks (roughly one every 2-4 seconds), not 5-7. Tag a lockup on every punchy content phrase (hook, tools, numbers, action verbs, CTA), not only the single strongest word. In the leftover gaps the solver paints LARGE textual captions that fill the open screen (not tiny karaoke).
PHRASES that must stay ONE line: product / brand / tool names spoken as a unit ("After Effects", "Premiere Pro", "DaVinci Resolve", "Final Cut"). Put the whole spoken phrase in one line's text; wordRange covers every spoken token of that phrase.
PEER LISTS: when the speaker lists equivalent tools or products in one breath (After Effects, Premiere Pro, and DaVinci Resolve), they are ONE event of equal lines — every name is a hero-sized line of the SAME fill / glow. Do not pick the first name as the only hero and demote the rest. Emit lines like [{"text":"After Effects","role":"hero"},{"text":"Premiere Pro","role":"support"},{"text":"DaVinci Resolve","role":"support"}] in one event (the solver will size and colour them equally).
A headline block is at most 6 words and 4 lines: [leading connectors] + hero + [one support]. Default preset "type.words". ONE PHRASE = ONE READING BLOCK: the solver stacks / centres it in one column in the open zone; regionHint "flank" does not exist, never ask for words on both sides of the subject.
3D: use "hero.extruded3d.rise" or "hero.extrudedStack.front" for at least ONE real keyword of the video (the strongest single content word, e.g. viral, effects, hashtags, incentivized), as the only word of its event or with one short connector line. It renders at hero size, in YOUR accent colour (never grey, never a sheet swatch), with the side of the extrusion visible; do not use it on a function word.
POSE (optional "pose" on the event): this is how the lockup sits, separate from its colour. "recede" = type on a wall in one-point perspective, the far edge smaller (a stack beside the speaker); "isometric" = block letters tilted so the depth face shows; "trapezoid" = the baseline wider than the top; "slant" = a small skew; "flat" = square to camera. Put a non-flat pose on about half the FRONT lockups so the edit is not a pile of flat captions. Do not pose type that sits behind the head. Omit pose and the solver cycles these on front heroes.
BEHIND THE SPEAKER: when a matte exists (the SHOTS line says so) ask for at least ONE hero that sits behind the head ("behindSignature", layering behind) or ONE stack over the cutout ("stackOverCutout") on the strongest single hero: this is a talking-head video, so it is where the depth comes from. Still rare: at most one such event in eight seconds, never both on the same event, never on every line. Behind type must stay slightly readable (the first and last letters of the word cannot vanish inside the cap). The solver will shift it up / aside rather than swallow a letter.
STACK OVER THE CUTOUT (regionHint "stackOverCutout", preset "type.words", needs a matte): ONE phrase, one edit. Line 1 (connectors or a short lead word) sits in the open area just ABOVE the speaker's head, in front; the hero steps down over the head and shoulders and renders BEHIND the speaker. Give it lines [connector line, hero].
ENTRIES (tag each lockup with "enter" for its hero / punch line, and optionally "enter" on a lead-in line; never the same entry+exit pair on two lockups in a row): IN-1 focus-pull fade (lead-ins, secondary lines, luxury); IN-2 z-push from depth (dramatic hero); IN-3 horizontal whip (punchy mid-sentence lead-in); IN-4 3D Y-swing; IN-5 floor flip-up; IN-6 stamp slam (loud hero, CTA); IN-7 character cascade (long hero of 4-12 letters, not script); IN-8 neon write-on (script hero only, fontPair neon); IN-9 glitch pop (loud, techy); IN-10 gold rise + glint (luxury editorial hero). Loud heroes use IN-2 / IN-4 / IN-6 / IN-7 / IN-9; luxury editorial heroes use IN-1 or IN-10; lead-ins use IN-1 or IN-3.
EXITS ("exit" on the event): OUT-1 fly-away (loud hero); OUT-2 horizontal smear (loud hero; OUT-3 is the same gesture); OUT-4 defocus (luxury / emotional hero); OUT-5 hard cut with the shot (only when the shot ends within 6 frames); OUT-7 ghost dim (the very last CTA only). Loud heroes pair an IN-2/4/6/7/9 entry with OUT-1 or OUT-2; luxury editorial heroes pair IN-1 / IN-10 with OUT-4. Vary entries and exits across the video.
MATCH CUT (preset "type.matchCut", full-frame text match cut, ~1.8 s, it owns the frame): legal ONLY in these four moments, and at most ONE in the whole plan: (1) the OPENING HOOK: the lockup covers the first ~1 second and the pinned word is the topic of the open; (2) a SHOCKING STATISTIC or fact: a number, a percent, or a "secret / database / proof" claim; (3) a MAJOR NARRATIVE PIVOT: an explicit turn ("but here's", "the problem" -> "the solution", a sentence-initial "now"); (4) the FIRST UTTERANCE of the single core keyword of the whole video (one word of 4-12 letters, a content word that dominates the transcript). Naming or defining a concept is NOT a reason: "that was an example of a hook" is not a match cut. Emit {"preset":"type.matchCut","layering":"front","anchor":"auto","regionHint":"auto","wordRange":[first..last word of that phrase, >= 5 words],"lines":[{"text":"<the keyword>","role":"hero"}],"matchCut":{"keyword":"<same word as spoken>","swapKeyword":"<second spoken word, ONLY for problem -> solution>","variant":"newsprint"|"editorial"|"memo"}}. Variant: news / story -> newsprint; brand / design / art -> editorial; data / research / technology -> memo. No type.words event may overlap it. If none of the four moments is in the transcript, emit ZERO match cuts: never invent a keyword and never force one.
"title":true only for a lone short hero word in cinematicClean, at most once per 15 seconds.
Rules: use ONLY words from the transcript (every line's text comes from the words inside wordRange — wordRange MUST include every spoken token that appears in lines[].text, including multi-word brand names); NEVER invent words; NEVER output coordinates, pixels, frame numbers, seconds or font sizes; preset must be one of the catalog names; at most ONE hero event active at a time; hero words come from high-emphasis words; keep every event inside one shot unless persistAcrossCut; put needsCustomTreatment only when no preset can express the idea.`;

export function buildDirectorPrompt(input: {words: KineticWord[]; shots: KineticShot[]; scenes: Record<string, ShotScene>; brand: BrandConfig}): string {
  const catalog = PRESET_NAMES.map(n => `- ${n}: layering ${PRESETS[n].layering}, anchor ${PRESETS[n].anchor}, lines ${PRESETS[n].lines.join('-')}, ${PRESETS[n].hasHero ? 'hero' : 'caption-only'}`).join('\n');
  const words = input.words.map(w => `${w.idx}:${w.text}${w.emphasisScore >= 0.65 ? '*' : ''}`).join(' ');
  const shots = input.shots.map(s => {
    const sc = input.scenes[s.id];
    const plate = sc ? ` plate: brightness ${(sc.luminance ?? 0.45).toFixed(2)} (0 dark .. 1 bright)${sc.plateColor ? `, mean colour ${sc.plateColor}` : ''}` : '';
    const box = sc && !sc.noMatte ? `; speaker box x ${sc.subjectBox.x.toFixed(2)}-${(sc.subjectBox.x + sc.subjectBox.w).toFixed(2)}, y ${sc.subjectBox.y.toFixed(2)}-${(sc.subjectBox.y + sc.subjectBox.h).toFixed(2)}` : '';
    return `${s.id} (${sc?.noMatte ? 'no matte: behind-the-head and stack-over-cutout are refused, text will be in front' : 'matte available: behind-the-head and stack-over-cutout are legal'};${plate}${box}${(sc?.alphaAreaFrac ?? 0) > 0.55 ? '; subject fills the frame' : ''})`;
  }).join('\n');
  return `PRESET CATALOG:\n${catalog}\n\nSHOTS: ${shots}\nWORDS (idx:text, * = emphasis candidate):\n${words}\n\nReturn the KineticPlan JSON.`;
}

/** Unknown preset ids from a model become a custom-treatment request on the closest known preset (the schema itself stays strict). */
export function normalizeUnknownPresets(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as {events?: unknown}).events)) return raw;
  const r = raw as {events: unknown[]};
  return {
    ...r,
    events: r.events.map(e => {
      if (!e || typeof e !== 'object') return e;
      const ev = e as {preset?: unknown; needsCustomTreatment?: unknown};
      if (typeof ev.preset === 'string' && !isKnownPreset(ev.preset)) {
        return {...ev, preset: closestPreset(ev.preset), needsCustomTreatment: ev.needsCustomTreatment ?? {description: `unknown preset id "${ev.preset}"`}};
      }
      return e;
    }),
  };
}

export function parseDirectorText(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '');
  return JSON.parse(t);
}

/** The existing Gemini key / endpoint, no new secrets. Imported lazily so pure modules never load config. */
export async function geminiDirectorCall(): Promise<DirectorCall | null> {
  const {env} = await import('../../config/env.ts');
  if (!env.GEMINI_API_KEY) return null;
  const {requestJson} = await import('../../lib/http.ts');
  const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
  return async ({system, user}) => {
    const body = await requestJson<{candidates?: Array<{content?: {parts?: Array<{text?: string}>}}>}>(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      label: 'Gemini kinetic director',
      failureCode: 'broll_failed',
      timeoutMs: 45_000,
      retries: 0,
      headers: {'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY},
      body: JSON.stringify({systemInstruction: {parts: [{text: system}]}, contents: [{role: 'user', parts: [{text: user}]}], generationConfig: {temperature: 0.3, responseMimeType: 'application/json'}}),
    });
    return body.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
  };
}

export async function runKineticDirector(input: {words: KineticWord[]; shots: KineticShot[]; scenes: Record<string, ShotScene>; brand: BrandConfig; call?: DirectorCall | null; fps?: number}): Promise<ResolvedPlan> {
  const first = input.shots[0] ? input.scenes[input.shots[0].id] : undefined;
  const opts = {fps: input.fps ?? 30, plate: {...(first?.luminance !== undefined ? {luminance: first.luminance} : {}), ...(first?.plateColor ? {color: first.plateColor} : {})}};
  let call = input.call;
  if (call === undefined) {
    try { call = await geminiDirectorCall(); } catch { call = null; }
  }
  if (!call) return resolvePlan(undefined, input.words, input.shots, 'director_not_configured', opts);
  try {
    const text = await call({system: KINETIC_DIRECTOR_SYSTEM, user: buildDirectorPrompt(input)});
    return resolvePlan(normalizeUnknownPresets(parseDirectorText(text)), input.words, input.shots, undefined, opts);
  } catch (err) {
    return resolvePlan(undefined, input.words, input.shots, `director_failed: ${err instanceof Error ? err.message : String(err)}`, opts);
  }
}
