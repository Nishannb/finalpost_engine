/** Specification tests for the PROPOSED hook-title policies (unwired) and the inert layout guard. Production behaviour is pinned too. */
import {describe, expect, it} from 'vitest';

import {occupancyFromSpeaker} from '../layout/occupancy.ts';
import {findLayoutIssues, hookIsDrawn, type LayoutPlan} from '../layout/layoutCritique.ts';
import {parseVisualDirectorJson} from './geminiDirector.ts';
import {resolveHookTitle, type HookTitlePolicy} from './hookTitlePolicy.ts';

const TRANSCRIPT = 'Have you ever noticed how the quietest moments speak the loudest? Today we explore silence.';
const record = (hook: unknown) => JSON.stringify({topic: 't', ...(hook === undefined ? {} : {hook_title: hook}), moments: [{timestamp: 8, search_keyword: 'sunset', media: 'video', layout: 'cutaway'}], caption: {}});
const MISSING = [undefined, null, '', '   ', '\n\t '] as const;

describe('production behaviour (pinned, unchanged): the v1 parser', () => {
  it.each(MISSING)('hook_title=%j becomes "WATCH THIS"', hook => {
    expect(parseVisualDirectorJson(record(hook), 40, TRANSCRIPT).hookTitle).toBe('WATCH THIS');
  });
  it('a present title is cleaned, capped at 6 words', () => {
    expect(parseVisualDirectorJson(record('The Quietest Moments Speak Loudest Today Friend'), 40, TRANSCRIPT).hookTitle).toBe('The Quietest Moments Speak Loudest Today');
  });
});

describe('policy "placeholder" reproduces today exactly', () => {
  it.each([...MISSING, 'The Quietest Moments Speak Loudest', 'x'])('%j', hook => {
    const parsed = parseVisualDirectorJson(record(hook), 40, TRANSCRIPT).hookTitle;
    expect(resolveHookTitle(hook, 'placeholder', TRANSCRIPT).title).toBe(parsed);
  });
});

describe('proposed policy A "none": a missing title is no hook element', () => {
  it.each(MISSING)('%j → empty, origin none', hook => {
    expect(resolveHookTitle(hook, 'none', TRANSCRIPT)).toEqual({title: '', origin: 'none'});
  });
  it('a present title is unchanged', () => {
    expect(resolveHookTitle('Silence Speaks', 'none')).toEqual({title: 'Silence Speaks', origin: 'director'});
  });
});

describe('proposed policy B "transcript_fallback": a missing title is a transcript snippet', () => {
  it.each(MISSING)('%j → first <=6 words of the first sentence', hook => {
    expect(resolveHookTitle(hook, 'transcript_fallback', TRANSCRIPT)).toEqual({title: 'Have you ever noticed how the', origin: 'transcript'});
  });
  it('with no usable transcript there is nothing to show (never the placeholder)', () => {
    expect(resolveHookTitle('', 'transcript_fallback', '')).toEqual({title: '', origin: 'none'});
    expect(resolveHookTitle(null, 'transcript_fallback', '   ')).toEqual({title: '', origin: 'none'});
  });
  it('shows the failure modes the proposal warns about: a mid-phrase cut, a filler opening, a call-to-action opening', () => {
    const snippet = (t: string) => resolveHookTitle(undefined, 'transcript_fallback', t).title;
    expect(snippet(TRANSCRIPT)).toBe('Have you ever noticed how the');
    expect(snippet("So, um, yeah. Let's start.")).toBe('So, um, yeah');
    expect(snippet('Click the link in my bio to buy now.')).toBe('Click the link in my bio');
  });
});

describe('a present title is identical under every policy', () => {
  it.each(['placeholder', 'none', 'transcript_fallback'] as HookTitlePolicy[])('%s', policy => {
    expect(resolveHookTitle('  Silence   Speaks  ', policy, TRANSCRIPT)).toEqual({title: 'Silence Speaks', origin: 'director'});
  });
});

describe('layout critique does not evaluate a hook anchor when the plan says there is no hook', () => {
  const occupancy = occupancyFromSpeaker({x: 0.5, y: 0.0, w: 0.5, h: 0.4}, 'vision');
  const plan = (hookTitle?: string): LayoutPlan => ({...(hookTitle === undefined ? {} : {hookTitle}), hookAnchor: 'top_right', hookDurationSec: 3, caption: {} as never, motionGraphics: [], overlays: [], mediaContainers: [], semanticEmphasis: []});

  it('an anchor on the speaker is reported when a title exists, and when the caller does not say (legacy)', () => {
    expect(findLayoutIssues(occupancy, plan('Silence Speaks')).map(issue => issue.kind)).toContain('hook_covers_speaker');
    expect(findLayoutIssues(occupancy, plan()).map(issue => issue.kind)).toContain('hook_covers_speaker');
  });

  it('is not reported for an explicitly empty or whitespace-only title (nothing is drawn)', () => {
    expect(findLayoutIssues(occupancy, plan('')).map(issue => issue.kind)).not.toContain('hook_covers_speaker');
    expect(findLayoutIssues(occupancy, plan('   ')).map(issue => issue.kind)).not.toContain('hook_covers_speaker');
  });

  it('hookIsDrawn', () => {
    expect([hookIsDrawn({}), hookIsDrawn({hookTitle: 'x'}), hookIsDrawn({hookTitle: ''}), hookIsDrawn({hookTitle: ' \n'})]).toEqual([true, true, false, false]);
  });
});
