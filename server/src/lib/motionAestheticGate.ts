/**
 * WP14E: the AESTHETIC GATE for generated motion graphics. PURE: a string in, `{ok, reasons}` out. The motion prompt tells Claude to build video motion design, not website UI; this is the machine check behind that
 * prompt, so a graphic that looks like a web page fails validation (and goes through the repair loop) instead of shipping as an explain plate.
 *
 * Two HARD rules, both on the graphic's own source with comments removed:
 *  1. NO AUTHORED BROWSER / OS CHROME. A graphic must not build a fake address bar, url bar, omnibox, tab strip, window traffic lights, window controls, iOS notification banner or status bar as layout (identifiers,
 *     strings or the three macOS traffic-light colours together). The approved toolkit hosts that carry intentional paper chrome (WikiCallout's slim tab strip, TweetCard's post card, NewspaperCallout) are
 *     IMPORTED, never authored, so importing them is fine and their names do not match.
 *  2. NO SOFT-CARD-ONLY ENTRANCE. A graphic whose only motion is `Reveal` with fade / slide-up style effects (the default), with no `MotionRecipe` and no other animation signal (hand-written interpolate /
 *     spring, KineticText, MaskReveal, CurvedText, Counter, charts, arrows ...), is a web card fading in. It fails; the repair prompt says to wrap the entrance in <MotionRecipe recipeId="...">.
 * Library host modules (a tiny `<Host props/>` wrapper) contain neither, so they pass; the toolkit compositions folder is not checked by this gate (it is for GENERATED source).
 */
export type AestheticVerdict = {ok: boolean; reasons: string[]};

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
/** `addressBar` / `address_bar` / `AddressBar` -> `address bar`, lower-cased, for matching identifiers and strings alike. */
const words = (code: string) => code.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();

const CHROME = /\b(address bar|url bar|omnibox|tab strip|tab bar|traffic lights?|window controls?|ios notification|notification (?:banner|toast|card)|status bar|browser (?:chrome|window|frame|toolbar))\b/;
const TRAFFIC_LIGHT_COLORS = ['#ff5f57', '#febc2e', '#28c840'];

/** Animation signals other than Reveal (calls and JSX uses only: an import line or a word in a string is not motion). */
const OTHER_MOTION_CALL = /\b(interpolate|spring|springIn|keyframes|drawStroke|pulse|useCurrentFrame)\s*\(/;
const OTHER_MOTION_JSX = /<(MotionRecipe|MaskReveal|ClipWindow|KineticText|CurvedText|Counter|BarChart|LineChart|Arrow|FocusRing|Progress|Stagger|Icon)\b/;
const SOFT_EFFECT = /^(?:fade|slide-up|slide-down|slide-left|slide-right|scale)$/;

/** True when every `<Reveal ...>` in the code has only soft effects (fade / slide / scale; the default when `effect` is absent) and none uses `pop`, a wipe, grow or a `progress` override. */
function revealsAreSoftOnly(code: string): boolean {
  const tags = [...code.matchAll(/<Reveal\b([^>]*)>/g)].map(match => match[1] ?? '');
  if (tags.length === 0) return false;
  return tags.every(attrs => {
    if (/\bprogress\s*=/.test(attrs)) return false;
    const effect = /\beffect\s*=\s*(\{[^}]*\}|"[^"]*"|'[^']*')/.exec(attrs)?.[1];
    if (!effect) return true; // default effect: fade + slide-up
    const names = [...effect.matchAll(/['"]([a-z-]+)['"]/g)].map(match => match[1]!);
    return names.length > 0 && names.every(name => SOFT_EFFECT.test(name));
  });
}

export function checkMotionAesthetic(source: string): AestheticVerdict {
  const code = stripComments(source).replace(/^\s*import\b[\s\S]*?;\s*$/gm, ' ');
  const reasons: string[] = [];
  const text = words(code);
  const chrome = CHROME.exec(text);
  if (chrome) reasons.push(`aesthetic: authored web / OS chrome ("${chrome[1]}"): this is a video edit, not a website; do not build browser, window or notification scaffolds (import an approved host such as WikiCallout / TweetCard instead)`);
  const lower = code.toLowerCase();
  if (TRAFFIC_LIGHT_COLORS.every(color => lower.includes(color))) reasons.push('aesthetic: authored window traffic-light dots (#FF5F57 / #FEBC2E / #28C840): do not build fake window chrome');
  if (/<Reveal\b/.test(code) && !OTHER_MOTION_CALL.test(code) && !OTHER_MOTION_JSX.test(code) && revealsAreSoftOnly(code)) {
    reasons.push('aesthetic: the only entrance is a soft fade / slide-up Reveal (a web card fading in); wrap the entrance in <MotionRecipe recipeId="..."> with an id from MOTION_RECIPE_IDS (elastic_type_snap, smear_blur_in, split_mask_reveal, ...)');
  }
  return {ok: reasons.length === 0, reasons};
}
