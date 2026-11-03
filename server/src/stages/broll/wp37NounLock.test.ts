/**
 * WP37: NOUN-LOCK / STOCK RELEVANCE. Offline: injected fake libraries, no network, no render.
 *   1. profile + queries: the head noun / number leads ("six billion" -> dollar bills, never a table), drifting scene queries drop, abstract-only speech locks nothing
 *   2. judge: a candidate is accepted / rejected from its alt / tags / slug (a food table is never "six billion"), unknown without metadata
 *   3. resolve loop: a rejected candidate is excluded and the library asked again, bounded
 *   4. facelessDocLane + editorialStillMontage: adversarial fake libraries that answer with food first never put a food still on a money shot; misses are reported
 *   5. explainer claim queries
 *   6. wiring pins + proof fixture; Skill A / B behaviour with no lock is unchanged
 */
import {existsSync, readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

import {editorialStillQueries, finalizeEditorialQuery, planEditorialStillMontage, EDITORIAL_FALLBACK_SCENES, type EditorialPhotoResolver} from './editorialStillMontage.ts';
import {detectClaims, claimBeatQueries, planClaimVisuals} from './explainerClaims.ts';
import {planExplainerPacing} from './explainerPacing.ts';
import {planFacelessDocLane} from './facelessDocLane.ts';
import {wordsInWindow, type CaptionWordLike} from './klipyContextQuery.ts';
import {
  NOUN_LOCK_MAX_REJECTS_PER_QUERY,
  buildNounLockProfile,
  candidateTokens,
  judgeCandidate,
  nounLockFallbacks,
  nounLockQueries,
  nounLockWarnings,
  queryDrifts,
  resolveNounLocked,
  spokenAmounts,
  type NounLockedPhoto,
} from './nounLock.ts';
import {ctaWindowsOf, moneyWindowsOf, planVoCutGrammar, type VoWord} from './voCutGrammar.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FOOD = /\b(food|dinner|dining|meal|restaurant|pizza|plate|cake|breakfast|lunch|kitchen|cook|coffee|cafe|table ?setting|tableware)\b/i;

describe('WP37 1) the profile and the noun-locked queries', () => {
  it('"six billion" locks on money: dollar bills lead, nothing drifts to a table / food', () => {
    const profile = buildNounLockProfile('and then they raised six billion');
    expect(profile.locked).toBe(true);
    expect(profile.domains[0]).toBe('money');
    expect(profile.headNoun).toBe('dollar bills');
    expect(profile.numbers).toContain('six billion');
    expect(profile.queries[0]).toMatch(/dollar bills/);
    for (const query of profile.queries) expect(query).not.toMatch(FOOD);
    // the existing scene rule alone would have offered 'bank notes table'
    expect(editorialStillQueries('and then they raised six billion')).toContain('bank notes table');
    const locked = nounLockQueries(profile, editorialStillQueries('and then they raised six billion'));
    expect(locked).not.toContain('bank notes table');
    expect(locked.every(query => !queryDrifts(profile, query))).toBe(true);
    expect(locked[0]).toMatch(/dollar bills/);
  });

  it('a bare "six billion" (no counted noun) is money; "six billion people" is a crowd, never cash', () => {
    expect(buildNounLockProfile('six billion').domains).toEqual(['money']);
    const people = buildNounLockProfile('there are six billion people on earth');
    expect(people.domains).toEqual(['people_count']);
    expect(people.headNoun).toBe('crowd');
    expect(people.queries.join(' ')).not.toMatch(/cash|dollar|bank|stock/);
    expect(people.queries[0]).toMatch(/crowd/);
    const users = buildNounLockProfile('over 200 million users');
    expect(users.domains).toEqual(['people_count']);
    expect(users.queries[0]).toMatch(/phone/);
    // explicit currency beside a count keeps both
    expect(buildNounLockProfile('raised $6 billion from 200 customers').domains).toEqual(['money', 'people_count']);
  });

  it('"editing audio" is DAW / headphones / timeline-ish; video editing is a timeline', () => {
    for (const text of ['I spend hours editing audio every week', 'when you are editing the audio and mixing the podcast']) {
      const profile = buildNounLockProfile(text);
      expect(profile.domains).toContain('audio_edit');
      expect(profile.queries.join(' ')).toMatch(/headphones|timeline|waveform|mixer/);
      for (const query of profile.queries) expect(query).not.toMatch(FOOD);
    }
    const video = buildNounLockProfile('editing the video on a timeline');
    expect(video.domains).toContain('video_edit');
    expect(video.queries[0]).toMatch(/editing timeline/);
  });

  it('"server room" stays tech (and "trading floor" stays markets)', () => {
    const server = buildNounLockProfile('inside the server room the racks hum');
    expect(server.domains[0]).toBe('server_tech');
    expect(server.queries[0]).toBe('server room lights');
    expect(server.queries.join(' ')).toMatch(/data center|server racks/);
    const markets = buildNounLockProfile('the traders on the stock market floor panicked');
    expect(markets.domains[0]).toBe('markets');
    expect(markets.queries[0]).toBe('trading floor traders');
  });

  it('abstract-only / noun-less speech locks nothing and leaves the base queries untouched', () => {
    for (const text of ['success motivation mindset hustle journey', 'we loved it and it was amazing', 'then he walked down the street', '']) {
      const profile = buildNounLockProfile(text);
      expect(profile.locked).toBe(false);
      expect(nounLockQueries(profile, ['city street crowd'])).toEqual(['city street crowd']);
      expect(nounLockFallbacks(profile, EDITORIAL_FALLBACK_SCENES)).toEqual([...EDITORIAL_FALLBACK_SCENES]);
    }
  });

  it('food is allowed when the speech says food (the ban lifts); a spoken "table" lifts the table-query ban only', () => {
    const dinner = buildNounLockProfile('they spent six billion on the restaurant dinner');
    expect(dinner.foodSpoken).toBe(true);
    expect(dinner.banned.size).toBe(0);
    expect(judgeCandidate({alt: 'Dining table with food'}, dinner).verdict).not.toBe('reject');
    // a food word in the neighbouring words also lifts it
    expect(buildNounLockProfile('six billion', {context: 'over dinner at the restaurant six billion'}).foodSpoken).toBe(true);
    const table = buildNounLockProfile('counted money on the table all night');
    expect(table.bannedQuery.has('table')).toBe(false);
    expect(table.bannedQuery.has('kitchen')).toBe(true);
    expect(queryDrifts(table, 'bank notes table')).toBe(false);
    expect(queryDrifts(buildNounLockProfile('six billion'), 'bank notes table')).toBe(true);
  });

  it('every noun-locked query is a safe 2-4 word visible scene (the WP30 gate would not change it)', () => {
    const speeches = ['six billion', 'six billion people', 'editing audio', 'editing the video', 'server room', 'stock market', 'two million users', '200 customers', '50 workers'];
    for (const text of speeches) {
      const profile = buildNounLockProfile(text);
      expect(profile.locked, text).toBe(true);
      for (const query of profile.queries) expect(finalizeEditorialQuery(query), `${text}: ${query}`).toBe(query);
    }
  });

  it('spokenAmounts finds amounts and magnitudes, not lone small number words', () => {
    expect(spokenAmounts('six billion')).toEqual(['six billion']);
    expect(spokenAmounts('he made $6 billion in 2024')).toEqual(expect.arrayContaining(['$6 billion']));
    expect(spokenAmounts('she had a million followers')).toEqual(expect.arrayContaining(['a million']));
    expect(spokenAmounts('one of the two of them')).toEqual([]);
  });
});

describe('WP37 2) the candidate judge', () => {
  const money = buildNounLockProfile('six billion');

  it('a food table is rejected for "six billion"; cash / finance photos are accepted', () => {
    const food = judgeCandidate({alt: 'Dining table with delicious food and wine glasses'}, money, {query: 'dollar bills cash stack'});
    expect(food.verdict).toBe('reject');
    expect(food.reason).toMatch(/^banned:/);
    expect(judgeCandidate({alt: 'Person holding us dollar bills'}, money, {query: 'dollar bills cash stack'}).verdict).toBe('accept');
    expect(judgeCandidate({tags: 'money, cash, finance, wealth'}, money).verdict).toBe('accept');
    expect(judgeCandidate({pageUrl: 'https://www.pexels.com/photo/stack-of-dollar-bills-4386321/'}, money).verdict).toBe('accept');
    expect(judgeCandidate({pageUrl: 'https://www.pexels.com/photo/restaurant-dining-table-with-meal-1234567/'}, money).verdict).toBe('reject');
  });

  it('a candidate about nothing the noun names is rejected; one stray token or no metadata is unknown (accepted as before)', () => {
    expect(judgeCandidate({alt: 'Woman standing on a mountain trail at sunrise'}, money).verdict).toBe('reject');
    expect(judgeCandidate({alt: 'Sunrise'}, money).verdict).toBe('unknown');
    expect(judgeCandidate({}, money).verdict).toBe('unknown');
    expect(judgeCandidate({alt: 'Dining table with food'}, buildNounLockProfile('then he walked down the street')).verdict).toBe('unknown'); // not locked: untouched
  });

  it('food outweighs a stray finance word; a finance photo with a single food word still passes', () => {
    expect(judgeCandidate({alt: 'Restaurant dinner bill with cash on the table'}, money).verdict).toBe('reject'); // 2 banned (restaurant, dinner) vs cash + bill
    expect(judgeCandidate({alt: 'Hand paying a dollar bill cash note at a restaurant'}, money).verdict).toBe('accept');
  });

  it('the query\'s own words count as depicting; the fallback check only enforces the ban', () => {
    const server = buildNounLockProfile('the server room');
    expect(judgeCandidate({alt: 'Blue lights in a long corridor'}, server, {query: 'server room lights'}).verdict).toBe('accept'); // "light" is in the query and the photo
    expect(judgeCandidate({alt: 'Sunset beach with palm trees'}, server, {bannedOnly: true}).verdict).toBe('accept');
    expect(judgeCandidate({alt: 'Pizza and food on a dinner plate'}, server, {bannedOnly: true}).verdict).toBe('reject');
  });

  it('audio editing: a mixing desk is accepted, a dinner plate is not', () => {
    const audio = buildNounLockProfile('editing audio');
    expect(judgeCandidate({alt: 'Headphones on a studio mixing console'}, audio).verdict).toBe('accept');
    expect(judgeCandidate({alt: 'Plate of food on a restaurant table'}, audio).verdict).toBe('reject');
  });

  it('candidateTokens: alt + tags + title + page slug, stemmed, stop-worded, ids dropped', () => {
    const tokens = candidateTokens({alt: 'Stacks of Dollar Bills', tags: ['money', 'cash'], pageUrl: 'https://www.pexels.com/photo/us-dollar-banknotes-4386321/', assetUrl: 'https://images.pexels.com/photos/4386321/pexels-photo-4386321.jpeg'});
    expect(tokens).toEqual(expect.arrayContaining(['stack', 'dollar', 'bill', 'money', 'cash', 'banknote']));
    expect(tokens.some(token => /\d|pexels|jpeg/.test(token))).toBe(false);
  });
});

const photo = (id: number, alt?: string): NounLockedPhoto => ({assetUrl: `https://images.example.com/${id}.jpg`, provider: 'pexels', providerId: id, ...(alt ? {alt} : {})});

describe('WP37 3) the resolve loop', () => {
  it('a rejected candidate is excluded and the library is asked again; the first relevant photo wins', async () => {
    const queue = [photo(1, 'Dining table with food'), photo(2, 'Another restaurant dinner meal'), photo(3, 'Stack of dollar bills')];
    const excludeKeys = new Set<string>();
    const asked: string[] = [];
    const out = await resolveNounLocked({
      resolver: async (query, o) => {
        asked.push(query);
        return queue.find(item => !o.excludeKeys.has(`${item.provider}:${item.providerId}`)) ?? null;
      },
      query: 'dollar bills cash stack',
      excludeKeys,
      profile: buildNounLockProfile('six billion'),
    });
    expect(out.photo?.providerId).toBe(3);
    expect(out.rejected).toBe(2);
    expect(out.lookups).toBe(3);
    expect(excludeKeys.has('pexels:1') && excludeKeys.has('pexels:2')).toBe(true);
    expect(NOUN_LOCK_MAX_REJECTS_PER_QUERY).toBe(2);
  });

  it('is bounded: more rejects than the budget returns no photo (the planner then tries its next query)', async () => {
    let id = 0;
    const out = await resolveNounLocked({resolver: async () => photo((id += 1), 'Dining table with food'), query: 'counting cash hands', excludeKeys: new Set(), profile: buildNounLockProfile('six billion')});
    expect(out.photo).toBeNull();
    expect(out.rejected).toBe(NOUN_LOCK_MAX_REJECTS_PER_QUERY + 1);
    expect(out.lookups).toBe(NOUN_LOCK_MAX_REJECTS_PER_QUERY + 1);
  });

  it('an unlocked profile (or none) is a single plain call; a throwing resolver is a miss; the lookup cap vetoes', async () => {
    let calls = 0;
    const plain = await resolveNounLocked({resolver: async () => { calls += 1; return photo(9, 'Dining table with food'); }, query: 'city street crowd', excludeKeys: new Set(), profile: buildNounLockProfile('then he walked')});
    expect(plain.photo?.providerId).toBe(9);
    expect(calls).toBe(1);
    expect((await resolveNounLocked({resolver: async () => { throw new Error('quota'); }, query: 'x y', excludeKeys: new Set(), profile: null})).photo).toBeNull();
    expect((await resolveNounLocked({resolver: async () => photo(1), query: 'x y', excludeKeys: new Set(), profile: null, canLookup: () => false})).lookups).toBe(0);
  });

  it('warnings', () => {
    expect(nounLockWarnings({locked: 0, rejected: 0, misses: 0})).toEqual([]);
    expect(nounLockWarnings({locked: 4, rejected: 3, misses: 2})).toEqual(['polish_assets:noun_lock:4', 'polish_assets:noun_lock_rejected:3', 'polish_assets:noun_lock_miss:2']);
  });
});

/** An adversarial library: every photo is a unique https still. A money query is answered with a dinner-table decoy first (a loose match), then with the real cash photo; with `moneyNeverCash` only ever the decoy. Other queries get a street. */
function adversarialLibrary(log: Array<{query: string; alt: string}> = [], options: {moneyNeverCash?: boolean} = {}): EditorialPhotoResolver {
  let next = 5000;
  const asked = new Map<string, number>();
  return async (query, {excludeKeys}) => {
    const moneyQuery = /cash|dollar|stock|money|calculator|trading/.test(query);
    for (;;) {
      next += 1;
      if (!excludeKeys.has(`pexels:${next}`)) break;
    }
    const count = asked.get(query) ?? 0;
    asked.set(query, count + 1);
    const alt = moneyQuery ? (options.moneyNeverCash || count === 0 ? 'Elegant dining table with food and wine' : 'Close up of us dollar bills cash') : 'City street at dusk';
    log.push({query, alt});
    return {assetUrl: `https://images.pexels.com/photos/${next}/pexels-photo-${next}.jpeg?w=1200`, provider: 'pexels', providerId: next, alt};
  };
}

const speak = (sentences: string[], startAt = 0.2): CaptionWordLike[] => {
  const out: CaptionWordLike[] = [];
  let at = startAt;
  for (const sentence of sentences) {
    for (const text of sentence.split(/\s+/)) {
      out.push({text, start: Math.round(at * 1000) / 1000, end: Math.round((at + 0.3) * 1000) / 1000});
      at += 0.35;
    }
    at += 0.7;
  }
  return out;
};

describe('WP37 4a) editorialStillMontage is noun-locked', () => {
  const words = speak([
    'He raised six billion for the startup',
    'then he raised six billion again and again',
    'the whole city street watched him',
    'six billion was the number that everyone saw',
    'they counted six billion in the office',
    'and the city street was loud all night',
  ]);

  it('never schedules a food still on a "six billion" item, and the photos it keeps depict the money', async () => {
    const answered = new Map<string, string>(); // src -> alt
    const base = adversarialLibrary();
    const spy: EditorialPhotoResolver = async (query, o) => {
      const result = await base(query, o);
      if (result) answered.set(result.assetUrl, result.alt ?? '');
      return result;
    };
    const montage = await planEditorialStillMontage({words, outputDurationSec: 30, resolver: spy});
    expect(montage.runs.length).toBeGreaterThan(0);
    expect(montage.nounLocked).toBeGreaterThan(0);
    expect(montage.nounLockRejected).toBeGreaterThan(0);
    for (const item of montage.items) expect(answered.get(item.src) ?? '', `${item.query}`).not.toMatch(FOOD);
    expect(montage.items.some(item => /dollar bills|counting cash/.test(item.query))).toBe(true);
    expect(montage.warnings.some(warning => /^polish_assets:noun_lock:\d+$/.test(warning))).toBe(true);
    expect(montage.warnings.some(warning => /^polish_assets:noun_lock_rejected:\d+$/.test(warning))).toBe(true);
  });

  it('drops the drifting scene query: "bank notes table" is never searched for a money line', async () => {
    const log: Array<{query: string; alt: string}> = [];
    await planEditorialStillMontage({words, outputDurationSec: 30, resolver: adversarialLibrary(log)});
    expect(log.map(entry => entry.query)).not.toContain('bank notes table');
    expect(log.some(entry => /dollar bills/.test(entry.query))).toBe(true);
  });

  it('a library that only ever answers food for money reports noun_lock_miss and falls back to neutral b-roll (never food)', async () => {
    const log: Array<{query: string; alt: string}> = [];
    const montage = await planEditorialStillMontage({words, outputDurationSec: 30, resolver: adversarialLibrary(log, {moneyNeverCash: true})});
    expect(montage.nounLockMisses).toBeGreaterThan(0);
    expect(montage.warnings.some(warning => /^polish_assets:noun_lock_miss:\d+$/.test(warning))).toBe(true);
    // no still whose query is a money query was kept (the food decoys were refused)
    for (const item of montage.items) expect(item.query).not.toMatch(/dollar bills|counting cash|calculator money/);
    // and no fallback scene drifted into the banned domain
    for (const item of montage.items.filter(entry => entry.fallbackScene)) expect(item.query).not.toMatch(/coffee|cafe|restaurant|kitchen/);
  });

  it('nounLock:false restores the previous behaviour exactly (the decoy is kept, no noun-lock warnings)', async () => {
    const montage = await planEditorialStillMontage({words, outputDurationSec: 30, resolver: adversarialLibrary(), nounLock: false});
    expect(montage.nounLocked).toBe(0);
    expect(montage.nounLockRejected).toBe(0);
    expect(montage.warnings.some(warning => warning.includes('noun_lock'))).toBe(false);
  });

  it('a photo with no metadata is accepted exactly as before (Skill A / B fixtures carry none)', async () => {
    const bare: EditorialPhotoResolver = async (query, {excludeKeys}) => {
      let id = 100 + query.length;
      while (excludeKeys.has(`pexels:${id}`)) id += 1;
      return {assetUrl: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg`, provider: 'pexels', providerId: id};
    };
    const on = await planEditorialStillMontage({words, outputDurationSec: 30, resolver: bare});
    const off = await planEditorialStillMontage({words, outputDurationSec: 30, resolver: bare, nounLock: false});
    expect(on.nounLockRejected).toBe(0);
    expect(on.items.length).toBe(off.items.length);
  });
});

const fixture = JSON.parse(read('./fixtures/wp36-vo-words.json')) as {durationSec: number; words: VoWord[]};
const plan = planVoCutGrammar({words: fixture.words, durationSec: fixture.durationSec, flags: {moneyWindows: moneyWindowsOf(fixture.words), ctaWindows: ctaWindowsOf(fixture.words, fixture.durationSec)}});
const cardRanges = plan.chapterCards.map(card => ({start: card.at, end: Math.round((card.at + card.duration) * 1000) / 1000}));
const bareResolver = (): EditorialPhotoResolver => {
  let n = 0;
  return async (query, {excludeKeys}) => {
    for (;;) {
      n += 1;
      if (!excludeKeys.has(`pexels:${n}`)) break;
    }
    return {assetUrl: `https://images.example.com/${query.replace(/\s+/g, '-')}-${n}.jpg`, provider: 'pexels', providerId: n};
  };
};

describe('WP37 4b) facelessDocLane is noun-locked', () => {
  it('the money shot ("six billion") gets a picture of the money even when the library answers food first', async () => {
    const log: Array<{query: string; alt: string}> = [];
    const lane = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver: adversarialLibrary(log), blockedRanges: cardRanges});
    const money = lane.shots.find(shot => /billion/i.test(shot.spoken));
    expect(money).toBeTruthy();
    expect(money!.fallbackScene).toBe(false);
    expect(money!.query).toMatch(/dollar|cash|stock|bank|calculator/);
    expect(lane.stats.nounLocked).toBeGreaterThan(0);
    expect(lane.stats.nounLockRejected).toBeGreaterThan(0);
    expect(lane.warnings.some(warning => /^polish_assets:noun_lock_rejected:\d+$/.test(warning))).toBe(true);
    expect(log.map(entry => entry.query)).not.toContain('bank notes table');
    // no shot kept a photo that a food-decoy produced: replay the library and check the kept photo ids
    expect(lane.unfilled).toEqual([]);
  });

  it('the kept photo of every locked money shot is the cash photo, never the decoy', async () => {
    const answered = new Map<string, string>(); // src -> alt
    const base = adversarialLibrary();
    const spy: EditorialPhotoResolver = async (query, o) => {
      const result = await base(query, o);
      if (result) answered.set(result.assetUrl, result.alt ?? '');
      return result;
    };
    const lane = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver: spy, blockedRanges: cardRanges});
    for (const shot of lane.shots) {
      if (shot.reused) continue;
      expect(answered.get(shot.src) ?? '', `shot ${shot.start} "${shot.spoken}" (${shot.query})`).not.toMatch(FOOD);
    }
  });

  it('a library that only answers food for money: reported as noun_lock_miss, neutral fallback, no food still', async () => {
    const answered = new Map<string, string>();
    const base = adversarialLibrary([], {moneyNeverCash: true});
    const spy: EditorialPhotoResolver = async (query, o) => {
      const result = await base(query, o);
      if (result) answered.set(result.assetUrl, result.alt ?? '');
      return result;
    };
    const lane = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver: spy, blockedRanges: cardRanges});
    expect(lane.stats.nounLockMisses).toBeGreaterThan(0);
    expect(lane.warnings.some(warning => /^polish_assets:noun_lock_miss:\d+$/.test(warning))).toBe(true);
    for (const shot of lane.shots) expect(answered.get(shot.src) ?? '').not.toMatch(FOOD);
    for (const shot of lane.shots.filter(item => item.fallbackScene && !item.reused)) expect(shot.query).not.toMatch(/coffee|cafe|restaurant|kitchen/);
  });

  it('Skill A is unchanged where nothing locks: same coverage, framing, motion and queries as nounLock:false for photos with no metadata', async () => {
    const on = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver: bareResolver(), blockedRanges: cardRanges});
    const off = await planFacelessDocLane({plan, words: fixture.words, durationSec: fixture.durationSec, resolver: bareResolver(), blockedRanges: cardRanges, nounLock: false});
    expect(on.stats.nounLockRejected).toBe(0);
    expect(on.stats.photoCoverage).toBe(off.stats.photoCoverage);
    expect(on.stats.framedShots).toBe(off.stats.framedShots);
    expect(on.stats.motionSpeeds).toEqual(off.stats.motionSpeeds);
    expect(on.shots.length).toBe(off.shots.length);
    expect(on.shots.map(shot => [shot.start, shot.end, shot.framed, shot.motionSpeed])).toEqual(off.shots.map(shot => [shot.start, shot.end, shot.framed, shot.motionSpeed]));
    // a shot whose words (and the words around it) lock nothing keeps exactly its old query; a locked one only ever changes to a query its own profile offers
    off.shots.forEach((shot, index) => {
      const around = buildNounLockProfile(wordsInWindow(fixture.words, shot.start - 1.2, shot.end + 1.2).map(word => word.text).join(' '));
      const own = buildNounLockProfile(shot.spoken);
      const changed = on.shots[index]!.query !== shot.query;
      if (!own.locked && !around.locked) expect(changed, `shot ${shot.start} "${shot.spoken}"`).toBe(false);
      else if (changed) expect([...own.queries, ...around.queries], `shot ${shot.start} "${shot.spoken}"`).toContain(on.shots[index]!.query);
    });
  });
});

describe('WP37 5) explainer claim visuals are noun-locked', () => {
  const words = speak(['Stripe just raised six billion dollars', 'Their server room runs the whole network', 'There are six billion people online']);

  it('claimBeatQueries: "six billion" -> money, "six billion people" -> crowd, "server room" -> tech', () => {
    const pacing = planExplainerPacing({durationSec: 14, words});
    const claimPlan = planClaimVisuals({segments: pacing.segments, words});
    const {items, warnings} = claimBeatQueries(claimPlan, words);
    expect(items.length).toBe(claimPlan.claims.length);
    const money = items.find(item => /six billion/i.test(item.claim.text) && /dollars/.test(item.spoken));
    expect(money?.profile.domains[0]).toBe('money');
    expect(money?.queries[0]).toMatch(/dollar bills/);
    const crowd = items.find(item => /people online/.test(item.spoken) && /billion/i.test(item.claim.text));
    expect(crowd?.profile.domains).toEqual(['people_count']);
    expect(crowd?.queries.join(' ')).not.toMatch(/cash|dollar|bank/);
    for (const item of items) for (const query of item.queries) expect(query, item.claim.text).not.toMatch(FOOD);
    expect(warnings[0]).toMatch(/^polish_claim:noun_lock:\d+:\d+$/);
    expect(claimPlan.claims).toEqual(detectClaims(words)); // the WP41 claim detector is untouched
  });
});

describe('WP37 6) wiring + proof', () => {
  const analyze = strip(read('../../pipeline/analyzeVideo.ts'));
  const lane = strip(read('./facelessDocLane.ts'));
  const montage = strip(read('./editorialStillMontage.ts'));

  it('both planners use the noun-lock module and both production resolvers pass the photo metadata through', () => {
    for (const code of [lane, montage]) {
      expect(code).toContain("from './nounLock.ts'");
      expect(code).toContain('resolveNounLocked(');
      expect(code).toContain('buildNounLockProfile(');
      expect(code).toContain('nounLockQueries(');
    }
    expect((analyze.match(/alt: asset\.alt, tags: asset\.tags, pageUrl: asset\.pageUrl/g) ?? []).length).toBe(2);
    expect(analyze).toContain('claimBeatQueries(');
  });

  it('the stock clients expose alt / tags / page slug; the module is pure (no env / logger / network)', () => {
    expect(read('./pexelsClient.ts')).toMatch(/alt\?: string/);
    expect(read('./pixabayClient.ts')).toMatch(/tags\?: string/);
    expect(read('./stockTypes.ts')).toMatch(/pageUrl\?: string/);
    const pure = strip(read('./nounLock.ts'));
    expect(pure).not.toMatch(/process\.env|config\/env|logger|fetch\(|requestJson/);
  });

  it('the old-vs-new proof fixture exists and every adversarial row shows a noun-locked first query', () => {
    const path = new URL('../../../../remotion/out/phase36-readiness/wp37-noun-lock.json', import.meta.url);
    expect(existsSync(path)).toBe(true);
    const proof = JSON.parse(readFileSync(path, 'utf8')) as {rows: Array<{spoken: string; old: string[]; locked: boolean; new: string[]; headNoun: string | null}>};
    expect(proof.rows.length).toBeGreaterThanOrEqual(8);
    for (const row of proof.rows) {
      expect(row.locked).toBe(true);
      expect(row.new.length).toBeGreaterThan(0);
      expect(row.headNoun).toBeTruthy();
    }
    const six = proof.rows.find(row => row.spoken === 'six billion');
    expect(six?.old).toContain('bank notes table');
    expect(six?.new).not.toContain('bank notes table');
    expect(six?.new[0]).toMatch(/dollar bills/);
  });
});
