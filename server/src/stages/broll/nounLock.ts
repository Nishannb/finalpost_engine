/**
 * WP37: NOUN-LOCK / STOCK RELEVANCE. Stock search matches tokens, not meaning, so a loose query ("bank notes table") or a loose candidate ("six billion" -> a food table) breaks the literal-visual rule shared by Skill A
 * (faceless documentary) and Skill B (explainer claim visuals). This module makes the visual depict the SPOKEN NOUN:
 *
 *   1. profile   `buildNounLockProfile(spoken, {context})`: what the shot is about (money / markets / a count of people / audio or video editing / server tech), the head noun, the numbers, the ordered 2-4 word queries
 *                that carry the head noun ("dollar bills cash stack", "trading floor traders", "server room lights"), and the words a still must NOT be about (food / dining unless the speech says food)
 *   2. queries   `nounLockQueries(profile, baseQueries)`: noun-locked queries first, then the caller's existing scene queries minus any that drift into a banned domain ("bank notes table" under money)
 *   3. judge     `judgeCandidate(meta, profile, {query})`: PURE relevance of one stock candidate from its alt text / tags / title / page-url slug / the query tokens. accept (it depicts the noun), reject (it is about a
 *                banned domain, or its metadata depicts none of the noun), unknown (no usable metadata: the search query is all we have, the candidate is accepted as before)
 *   4. resolve   `resolveNounLocked(...)`: calls the injected resolver, judges the photo, and on a reject excludes it and asks again (bounded) before the planner tries its next query
 *
 * PURE + ASYNC-INJECTED: no env, no logger, no network. Nothing here changes cut grammar, caption modes or the WP39 motion dial; a profile that finds nothing to lock (`locked: false`) leaves every planner exactly
 * as it was.
 */
/** What a candidate photo exposes. Pexels gives `alt` + a page url with a slug, Pixabay gives `tags` + a page url with a slug; a fake in a test can give any of them. */
export type StockCandidateMeta = {
  alt?: string;
  tags?: string | readonly string[];
  title?: string;
  pageUrl?: string;
  assetUrl?: string;
};

export type NounDomainId = 'server_tech' | 'audio_edit' | 'video_edit' | 'markets' | 'money' | 'people_count';

export type NounLockProfile = {
  /** True when a head noun was found: only then do the queries / judge change anything. */
  locked: boolean;
  /** The matched domains, strongest first. */
  domains: NounDomainId[];
  /** The noun the picture must show ("dollar bills", "server room", "trading floor", "crowd", ...). */
  headNoun: string | null;
  /** Spoken amounts ("six billion", "$6 billion", "200 customers"). */
  numbers: string[];
  /** Noun-locked 2-4 word queries, head noun first. */
  queries: string[];
  /** Metadata tokens (stemmed) that depict the noun. */
  accept: ReadonlySet<string>;
  /** Metadata tokens (stemmed) a still must not be about. */
  banned: ReadonlySet<string>;
  /** Query tokens (raw) a query must not contain. */
  bannedQuery: ReadonlySet<string>;
  /** Base (scene-rule) queries that belong to another noun and must not follow the lock ("six billion PEOPLE" never falls back to the cash scenes). Null = nothing suppressed. */
  suppress: RegExp | null;
  /** Food / dining words were spoken (or sit next to the shot): the food ban is lifted. */
  foodSpoken: boolean;
};

const words = (text: string): string[] => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const stem = (token: string): string => (token.length > 4 && token.endsWith('ies') ? `${token.slice(0, -3)}y` : token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token);
const stems = (list: readonly string[]): Set<string> => new Set(list.map(stem));

/** Words that make a still about FOOD / dining: banned from a locked shot unless the speech says food. */
const FOOD_META = 'food foods meal meals dinner dinners lunch breakfast brunch restaurant restaurants cuisine dish dishes pizza burger burgers salad cake cakes dessert desserts fruit fruits vegetable vegetables cooking cook chef recipe snack snacks wine feast buffet bakery grocery groceries picnic dining tableware tablecloth cutlery plate plates bowl bowls delicious tasty eating'.split(' ');
/** Query tokens that drift into the same domain (a locked money query never asks for a table / kitchen / cafe). */
const FOOD_QUERY = 'food meal dinner lunch breakfast restaurant kitchen cafe coffee table family cooking chef plate dining'.split(' ');
/** Spoken words that make food literal. */
const FOOD_SPOKEN = /\b(food|foods|meal|meals|dinner|lunch|breakfast|brunch|restaurant|restaurants|kitchen|cook(?:ing|ed|s)?|chef|recipe|eat|eating|ate|pizza|burgers?|coffee|cafe|cake|dessert|snack|snacks|grocery|groceries|hungry|menu|table ?cloth)\b/i;

const NUMWORD = '(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)';
const AMOUNT = `(?:[$€£]\\s?)?(?:\\d[\\d.,]*|${NUMWORD})`;
const MAG = '(?:hundred|thousand|million|billion|trillion|k|bn)';
const AMOUNT_RE = new RegExp(`\\b${AMOUNT}(?:\\s+${MAG})?\\b(?:\\s+(?:dollars?|bucks|usd|euros?))?|[$€£]\\s?\\d[\\d.,]*(?:\\s+${MAG})?`, 'gi');
const BARE_MAGNITUDE = /\b(billions?|millions?|trillions?|grand)\b/i;
const CURRENCY = /[$€£]\s?\d|\b(dollars?|bucks?|usd|euros?|cash|money|revenue|profit|profits|valuation|valued|income|salary|paid|price|prices|funding|funded|raised|invest(?:or|ors|ment|ed|ing)?|worth|billionaire|millionaire|budget|earn(?:ed|ing|ings)?|sales|wealth|bank|loan|debt|rupees?)\b/i;
const COUNT_NOUN = '(?:people|humans?|persons|folks|citizens|residents|inhabitants|users|customers|viewers|subscribers|followers|downloads|views|workers|employees)';
const COUNT_RE = new RegExp(`\\b(?:${AMOUNT}\\s+)?${MAG}\\s+(?:of\\s+)?(${COUNT_NOUN})\\b|\\b\\d[\\d,]*\\s+(${COUNT_NOUN})\\b`, 'i');

type DomainDef = {
  id: NounDomainId;
  re: RegExp;
  headNoun: string;
  queries: readonly string[];
  accept: readonly string[];
};

const MONEY_ACCEPT = 'money cash dollar bill banknote note currency coin finance financial bank banking stock market trading trader chart graph investment investor investing wealth wealthy business calculator wallet economy economic profit accounting atm euro price savings budget payment pay income salary rich fund funding capital cryptocurrency bitcoin office desk'.split(' ');

const DOMAINS: readonly DomainDef[] = [
  {
    id: 'server_tech',
    re: /\b(servers?|server rooms?|server racks?|data ?cent(?:er|re)s?|datacenter|gpu clusters?|supercomputers?)\b/i,
    headNoun: 'server room',
    queries: ['server room lights', 'data center racks', 'server racks cables', 'network cables closeup'],
    accept: 'server rack data center datacenter network cable cables hardware computer technology tech cloud it room light lights blue digital storage mainframe gpu infrastructure'.split(' '),
  },
  {
    id: 'audio_edit',
    re: /\b(?:(?:edit(?:ing|ed|s)?|mix(?:ing|ed)?|master(?:ing|ed)?|record(?:ing|ed)?|cut(?:ting)?)\s+(?:the\s+|my\s+|your\s+|an?\s+)?(?:audio|sound|podcast|music|vocals?|tracks?|voice)|(?:audio|sound|podcast)\s+(?:edit(?:ing|or)|mix(?:ing)?|mastering)|daw|waveforms?)\b/i,
    headNoun: 'audio timeline',
    queries: ['audio waveform timeline', 'headphones mixing desk', 'sound mixer studio', 'studio headphones desk'],
    accept: 'audio sound waveform wave timeline headphone headphones mixer mixing console studio daw software editing editor monitor computer laptop desk music microphone recording production equalizer slider knob equipment'.split(' '),
  },
  {
    id: 'video_edit',
    re: /\b(?:edit(?:ing|ed|s)?\s+(?:the\s+|my\s+|your\s+|a\s+)?(?:video|videos|footage|clips?|reels?|film)|video\s+edit(?:ing|or)|editing\s+timelines?|premiere|capcut|davinci)\b/i,
    headNoun: 'editing timeline',
    queries: ['video editing timeline', 'editing software monitor', 'film editor desk', 'video editing laptop'],
    accept: 'video editing editor timeline software monitor computer laptop desk film footage clip camera screen production premiere post studio'.split(' '),
  },
  {
    id: 'markets',
    re: /\b(markets?|stocks?|trading|traders?|wall street|nasdaq)\b/i,
    headNoun: 'trading floor',
    queries: ['trading floor traders', 'stock market screen', 'financial charts monitor'],
    accept: 'stock market trading trader floor exchange chart graph finance financial screen monitor investment investor wall street candlestick ticker economy business'.split(' '),
  },
  {
    id: 'money',
    re: /(?!)/, // matched by `moneyHit` below (currency evidence, or a bare magnitude with no counted noun)
    headNoun: 'dollar bills',
    queries: ['dollar bills cash stack', 'counting cash hands', 'stock market screen', 'calculator money desk'],
    accept: MONEY_ACCEPT,
  },
  {
    id: 'people_count',
    re: /(?!)/, // matched by `COUNT_RE` below
    headNoun: 'crowd',
    queries: ['crowded city street', 'aerial crowd city', 'busy crosswalk crowd'],
    accept: 'crowd crowded people city street pedestrians population aerial busy crosswalk commuters audience urban public group rush hour station'.split(' '),
  },
];

/** A counted noun picks its own scenes ("six billion users" is phones, not cash). */
const COUNT_SCENES: Record<string, {headNoun: string; queries: readonly string[]; accept: readonly string[]}> = {
  users: {headNoun: 'phone screens', queries: ['hands scrolling phone', 'commuters looking phones', 'crowd using smartphones'], accept: 'phone phones smartphone mobile hand hands scrolling screen app user users people social media'.split(' ')},
  customers: {headNoun: 'shop customers', queries: ['customers shopping store', 'busy retail checkout', 'shoppers crowd mall'], accept: 'customer customers shop shopping store retail checkout shopper shoppers mall market people crowd'.split(' ')},
  viewers: {headNoun: 'audience', queries: ['crowd watching screen', 'audience applause hall', 'commuters looking phones'], accept: 'audience crowd viewer viewers watching screen people tv stadium hall phone'.split(' ')},
  workers: {headNoun: 'office workers', queries: ['office workers desks', 'busy open office', 'factory workers line'], accept: 'worker workers employee employees office desk desks team factory staff people busy line'.split(' ')},
};
for (const alias of ['subscribers', 'followers', 'downloads', 'views']) COUNT_SCENES[alias] = COUNT_SCENES.users!;
COUNT_SCENES.employees = COUNT_SCENES.workers!;

const EMPTY_SET: ReadonlySet<string> = new Set();
const emptyProfile = (foodSpoken: boolean): NounLockProfile => ({locked: false, domains: [], headNoun: null, numbers: [], queries: [], accept: EMPTY_SET, banned: EMPTY_SET, bannedQuery: EMPTY_SET, suppress: null, foodSpoken});

/** Spoken amounts in a span: "six billion", "$6 billion", "200 customers" (a bare number word like "a" is not an amount). */
export function spokenAmounts(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(AMOUNT_RE)) {
    const value = match[0].replace(/\s+/g, ' ').trim();
    if (/^(a|an|one|hundred)$/i.test(value)) continue;
    if (!/\d|\b(billion|million|trillion|thousand|hundred|k|bn)\b/i.test(value) && !/^(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)$/i.test(value)) continue;
    if (/^(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)$/i.test(value)) continue; // a lone small number word is not a claim
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * What the shot is about. `spoken` is the words of THIS shot; `context` (optional) is the neighbouring speech: it only lifts the food ban (a "dinner" next to the money line is literal) and never creates a lock.
 * Pure.
 */
export function buildNounLockProfile(spoken: string, options: {context?: string} = {}): NounLockProfile {
  const text = spoken.replace(/\s+/g, ' ').trim();
  const foodSpoken = FOOD_SPOKEN.test(`${text} ${options.context ?? ''}`);
  if (text.length < 3) return emptyProfile(foodSpoken);

  const count = COUNT_RE.exec(text);
  const countNoun = (count?.[1] ?? count?.[2] ?? '').toLowerCase();
  const countKey = countNoun ? (countNoun in COUNT_SCENES ? countNoun : null) : null;
  const explicitCurrency = CURRENCY.test(text);
  const moneyHit = explicitCurrency || (BARE_MAGNITUDE.test(text) && !count);

  const matched: Array<{id: NounDomainId; headNoun: string; queries: readonly string[]; accept: readonly string[]}> = [];
  for (const domain of DOMAINS) {
    if (domain.id === 'money') {
      if (moneyHit) matched.push(domain);
    } else if (domain.id === 'people_count') {
      if (count) {
        const scene = countKey ? COUNT_SCENES[countKey]! : domain;
        matched.push({id: 'people_count', headNoun: scene.headNoun, queries: scene.queries, accept: scene.accept});
      }
    } else if (domain.re.test(text)) {
      matched.push(domain);
    }
  }
  if (matched.length === 0) return emptyProfile(foodSpoken);

  const spokenTokens = stems(words(text));
  const bannedList = foodSpoken ? [] : FOOD_META;
  const bannedQueryList = foodSpoken ? [] : FOOD_QUERY;
  const queries: string[] = [];
  for (const domain of matched) for (const query of domain.queries) if (!queries.includes(query)) queries.push(query);
  return {
    locked: true,
    domains: matched.map(domain => domain.id),
    headNoun: matched[0]!.headNoun,
    numbers: spokenAmounts(text),
    queries: queries.filter(query => !words(query).some(token => bannedQueryList.includes(token) && !spokenTokens.has(stem(token)))),
    accept: stems([...matched.flatMap(domain => domain.accept), ...(foodSpoken ? FOOD_META : [])]), // food spoken: a food photo is on topic
    banned: new Set([...stems(bannedList)].filter(token => !spokenTokens.has(token))),
    bannedQuery: new Set(bannedQueryList.filter(token => !spokenTokens.has(stem(token)))),
    // a counted noun with no currency beside it ("six billion people") is not money: the base cash / market scene queries are dropped
    suppress: matched.some(domain => domain.id === 'money' || domain.id === 'markets') ? null : /\b(cash|bank|stock|dollar|dollars|money|trading|financial)\b/,
    foodSpoken,
  };
}

/** True when a query drifts into a banned domain for this profile (always false for an unlocked profile). */
export function queryDrifts(profile: NounLockProfile, query: string): boolean {
  return profile.locked && words(query).some(token => profile.bannedQuery.has(token));
}

/**
 * Ordered queries for a shot: the noun-locked queries (head noun first), then the caller's existing scene queries with every drifting one removed. An unlocked profile returns the base queries untouched.
 */
export function nounLockQueries(profile: NounLockProfile, base: readonly string[]): string[] {
  if (!profile.locked) return [...base];
  const out: string[] = [];
  for (const query of [...profile.queries, ...base]) {
    if (queryDrifts(profile, query) || out.includes(query)) continue;
    if (profile.suppress?.test(query) && !profile.queries.includes(query)) continue;
    out.push(query);
  }
  return out;
}

/** The neutral fallback scenes that stay clear of the profile's banned domain (a money shot never falls back to "coffee shop window"). */
export function nounLockFallbacks(profile: NounLockProfile, fallbacks: readonly string[]): string[] {
  if (!profile.locked) return [...fallbacks];
  const safe = fallbacks.filter(query => !queryDrifts(profile, query));
  return safe.length > 0 ? safe : [...fallbacks];
}

const META_STOP = new Set('the and with for from that this are was were has have into over under near behind front out off its their his her white black young old new big small high low top side view photo photos image images picture stock free pexels pixabay jpeg jpg png https http www com net page'.split(' '));

/** Content tokens (stemmed) of a candidate's metadata: alt + tags + title + the slug of its page url. */
export function candidateTokens(meta: StockCandidateMeta): string[] {
  const tags = Array.isArray(meta.tags) ? meta.tags.join(' ') : String(meta.tags ?? '');
  const slugOf = (url?: string) => {
    if (!url) return '';
    try {
      const path = decodeURIComponent(new URL(url).pathname);
      return (path.split('/').filter(Boolean).pop() ?? '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\d+/g, ' ');
    } catch {
      return '';
    }
  };
  const raw = [meta.alt ?? '', tags, meta.title ?? '', slugOf(meta.pageUrl), slugOf(meta.assetUrl)].join(' ');
  return [...new Set(words(raw).filter(token => token.length >= 3 && !META_STOP.has(token)).map(stem))];
}

export type CandidateVerdict = {verdict: 'accept' | 'reject' | 'unknown'; score: number; reason: string; hits: string[]; bannedHits: string[]};

/**
 * Is this candidate a picture of the noun? Pure.
 *  - not locked, or no usable metadata -> `unknown` (accepted: the search query is all we have; behaviour is unchanged)
 *  - a banned-domain token (food / dining) outweighs the depicting tokens -> `reject` ("six billion" never lands on a dinner table)
 *  - at least one depicting token (the domain lexicon + the query's own words) -> `accept`
 *  - 2+ metadata tokens and none depict the noun -> `reject` (not about the noun at all); a single stray token stays `unknown`
 * `bannedOnly` (a neutral fallback scene) skips the depicting check and only enforces the ban.
 */
export function judgeCandidate(meta: StockCandidateMeta, profile: NounLockProfile, options: {query?: string; bannedOnly?: boolean} = {}): CandidateVerdict {
  if (!profile.locked) return {verdict: 'unknown', score: 0, reason: 'not_locked', hits: [], bannedHits: []};
  const tokens = candidateTokens(meta);
  if (tokens.length === 0) return {verdict: 'unknown', score: 0, reason: 'no_metadata', hits: [], bannedHits: []};
  const queryTokens = stems(words(options.query ?? '').filter(token => token.length >= 3 && !META_STOP.has(token)));
  const bannedHits = tokens.filter(token => profile.banned.has(token));
  const hits = tokens.filter(token => profile.accept.has(token) || queryTokens.has(token));
  if (bannedHits.length > 0 && bannedHits.length >= hits.length) return {verdict: 'reject', score: -bannedHits.length, reason: `banned:${bannedHits.slice(0, 3).join('+')}`, hits, bannedHits};
  if (options.bannedOnly) return {verdict: 'accept', score: 0, reason: 'neutral', hits, bannedHits};
  if (hits.length > 0) return {verdict: 'accept', score: hits.length - bannedHits.length, reason: `depicts:${hits.slice(0, 3).join('+')}`, hits, bannedHits};
  if (tokens.length >= 2) return {verdict: 'reject', score: 0, reason: 'off_noun', hits, bannedHits};
  return {verdict: 'unknown', score: 0, reason: 'thin_metadata', hits, bannedHits};
}

/** Bounded rejects per attempted query (each costs a lookup) and per shot. */
export const NOUN_LOCK_MAX_REJECTS_PER_QUERY = 2;

export type NounLockedPhoto = StockCandidateMeta & {assetUrl: string; provider: string; providerId: number};
export type NounLockedResolver = (query: string, options: {excludeKeys: Set<string>}) => Promise<NounLockedPhoto | null>;

export type NounLockedResolution = {photo: NounLockedPhoto | null; lookups: number; rejected: number; verdict: CandidateVerdict | null};

/**
 * Ask the resolver for `query`; a candidate the judge rejects is excluded (so the library answers with the next one) and asked for again, up to `maxRejects` times. `canLookup` lets the planner's lookup cap veto
 * another call. An unlocked profile is a plain single call. A throwing resolver is a miss, never a crash.
 */
export async function resolveNounLocked(args: {
  resolver: NounLockedResolver;
  query: string;
  excludeKeys: Set<string>;
  profile: NounLockProfile | null;
  bannedOnly?: boolean;
  canLookup?: () => boolean;
  maxRejects?: number;
  accepts?: (photo: NounLockedPhoto) => boolean;
}): Promise<NounLockedResolution> {
  const maxRejects = args.maxRejects ?? NOUN_LOCK_MAX_REJECTS_PER_QUERY;
  let lookups = 0;
  let rejected = 0;
  for (let attempt = 0; attempt <= maxRejects; attempt += 1) {
    if (args.canLookup && !args.canLookup()) break;
    lookups += 1;
    let photo: NounLockedPhoto | null = null;
    try {
      photo = await args.resolver(args.query, {excludeKeys: args.excludeKeys});
    } catch {
      photo = null;
    }
    if (!photo) return {photo: null, lookups, rejected, verdict: null};
    if (args.accepts && !args.accepts(photo)) return {photo, lookups, rejected, verdict: null}; // the planner's own gates (https, no solid, no dup) handle it
    const verdict = args.profile?.locked ? judgeCandidate(photo, args.profile, {query: args.query, bannedOnly: args.bannedOnly}) : null;
    if (verdict?.verdict === 'reject') {
      rejected += 1;
      args.excludeKeys.add(`${photo.provider}:${photo.providerId}`);
      continue;
    }
    return {photo, lookups, rejected, verdict};
  }
  return {photo: null, lookups, rejected, verdict: null};
}

/** Warnings: `polish_assets:noun_lock:<locked shots>` (when any), `noun_lock_rejected:<n>`, `noun_lock_miss:<n>` (a locked shot fell back to neutral b-roll / re-used a photo / stayed empty). */
export function nounLockWarnings(stats: {locked: number; rejected: number; misses: number}): string[] {
  return [
    ...(stats.locked > 0 ? [`polish_assets:noun_lock:${stats.locked}`] : []),
    ...(stats.rejected > 0 ? [`polish_assets:noun_lock_rejected:${stats.rejected}`] : []),
    ...(stats.misses > 0 ? [`polish_assets:noun_lock_miss:${stats.misses}`] : []),
  ];
}

/**
 * WP52: a bare personal first name ("Adam") has no visual referent in stock: searching it returned a clock (homonym drift, test2 live). Such a query is never issued and a timepiece-class photo is
 * never accepted for it; the slot falls back to a text plate / host layout instead of a wrong photo. Deliberately a short curated list, not a name detector.
 */
const BARE_PERSON_NAMES = new Set(
  'adam alan alex alice amy andrew ben bob brian chris dan daniel dave david emma eric eve frank george greg henry ian jack jake james jane jason jeff jen jenny jim joe john jon josh julia kate ken kevin kyle larry laura leo lisa luke mark mary matt max mike nick noah paul pete peter rachel rob ryan sam sara sarah scott sean steve tom tim tony will'.split(' '),
);
const PERSON_QUERY_FILLER = new Set('photo photos image picture stock portrait'.split(' '));
export function isBarePersonNameQuery(query: string): boolean {
  const tokens = words(query).filter(token => !PERSON_QUERY_FILLER.has(token));
  return tokens.length === 1 && BARE_PERSON_NAMES.has(tokens[0]!);
}
const TIMEPIECE_TOKENS = new Set('clock clocks watch watches timepiece timepieces hourglass alarm wristwatch stopwatch'.split(' '));
/** True when a candidate photo is about a clock / watch (the homonym class a bare-name query drifts into). */
export function isTimepieceCandidate(meta: StockCandidateMeta): boolean {
  return candidateTokens(meta).some(token => TIMEPIECE_TOKENS.has(token) || TIMEPIECE_TOKENS.has(`${token}s`));
}
