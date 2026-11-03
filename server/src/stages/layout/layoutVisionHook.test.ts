/**
 * Phase 20A (A2): the layout vision critique's request when the hook title is absent. The HTTP layer is mocked, so the REAL
 * critiqueAndPatchLayout builds the request and handles a (canned) reply; nothing is sent anywhere and no model is called.
 */
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {env} from '../../config/env.ts';
import {critiqueAndPatchLayout, type LayoutPlan} from './layoutCritique.ts';
import {occupancyFromSpeaker} from './occupancy.ts';

const captured = vi.hoisted(() => ({bodies: [] as Array<Record<string, any>>, reply: ''}));
vi.mock('../../lib/http.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/http.ts')>()),
  requestJson: async (_url: string, options: {body?: string}) => {
    captured.bodies.push(JSON.parse(options.body ?? '{}'));
    return {candidates: [{content: {parts: [{text: captured.reply}]}}], usageMetadata: {promptTokenCount: 1, candidatesTokenCount: 1}};
  },
}));

const e = env as unknown as {GEMINI_API_KEY: string};
const originalKey = e.GEMINI_API_KEY;
let dir: string;
let still: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'layout-vision-'));
  still = join(dir, 'frame.jpg');
  writeFileSync(still, Buffer.from('not-a-real-jpeg-the-request-only-base64-encodes-it'));
});
afterAll(() => rmSync(dir, {recursive: true, force: true}));
afterEach(() => {
  e.GEMINI_API_KEY = originalKey;
  captured.bodies.length = 0;
  captured.reply = '';
});

// The speaker occupies the top-right, so an anchor of top_right would collide if a hook were drawn there.
const occupancy = occupancyFromSpeaker({x: 0.5, y: 0.0, w: 0.5, h: 0.4}, 'vision');
const plan = (hookTitle?: string): LayoutPlan => ({...(hookTitle === undefined ? {} : {hookTitle}), hookAnchor: 'top_right', hookDurationSec: 3, caption: {} as never, motionGraphics: [], overlays: [], mediaContainers: [], semanticEmphasis: []});
const planText = () => {
  const text: string = captured.bodies[0]!.contents[0].parts[1].text;
  return {text, summary: JSON.parse(text.slice(text.indexOf('PLAN:\n') + 6)) as Record<string, any>};
};

describe('vision-critique request (a key is configured, HTTP mocked)', () => {
  it('a drawn hook: the summary carries hook_anchor and the geometric collision is reported to the critic', async () => {
    e.GEMINI_API_KEY = 'test-key-offline';
    captured.reply = '{"notes":""}';
    await critiqueAndPatchLayout({stillPath: still, occupancy, plan: plan('Silence Speaks')});
    expect(captured.bodies).toHaveLength(1);
    const {summary} = planText();
    // the geometric pass first moves the colliding top_right anchor away from the speaker; the critic then sees the moved anchor
    expect(summary.hook_anchor).toBe('top_left');
    expect(summary.geometric_issues).toEqual([]);
  });

  it.each([['empty', ''], ['whitespace', '   '], ['newline/tab', '\n\t ']])('an absent hook (%s title): no hook_anchor in the summary, and no hook collision is reported to the critic', async (_name, title) => {
    e.GEMINI_API_KEY = 'test-key-offline';
    captured.reply = '{"notes":""}';
    const result = await critiqueAndPatchLayout({stillPath: still, occupancy, plan: plan(title)});
    const {summary, text} = planText();
    expect('hook_anchor' in summary).toBe(false);
    expect(JSON.stringify(summary.geometric_issues)).not.toContain('hook_covers_speaker');
    expect(result.issues.map(issue => issue.kind)).not.toContain('hook_covers_speaker');
    // the instructions to the critic are identical whether or not a hook exists (only the PLAN differs)
    expect(text.slice(0, text.indexOf('PLAN:'))).toContain('Return ONLY JSON patches');
  });

  it('the prompt text outside PLAN is byte-identical for drawn and absent hooks; so are the generation settings', async () => {
    e.GEMINI_API_KEY = 'test-key-offline';
    captured.reply = '{"notes":""}';
    await critiqueAndPatchLayout({stillPath: still, occupancy, plan: plan('Silence Speaks')});
    await critiqueAndPatchLayout({stillPath: still, occupancy, plan: plan('')});
    const [drawn, absent] = captured.bodies as [Record<string, any>, Record<string, any>];
    const head = (body: Record<string, any>) => (body.contents[0].parts[1].text as string).slice(0, (body.contents[0].parts[1].text as string).indexOf('PLAN:'));
    expect(head(drawn)).toBe(head(absent));
    expect(drawn.generationConfig).toEqual(absent.generationConfig);
    expect(drawn.contents[0].parts[0]).toEqual(absent.contents[0].parts[0]);
  });

  it('legacy callers that do not pass hookTitle keep the old behaviour (hook_anchor sent, collision reported)', async () => {
    e.GEMINI_API_KEY = 'test-key-offline';
    captured.reply = '{"notes":""}';
    const result = await critiqueAndPatchLayout({stillPath: still, occupancy, plan: plan()});
    expect('hook_anchor' in planText().summary).toBe(true);
    expect(result.plan.hookTitle).toBeUndefined();
  });

  it('a (canned) critic reply that moves the hook anchor cannot create a title: the plan keeps hookTitle "" and no hook is drawn', async () => {
    e.GEMINI_API_KEY = 'test-key-offline';
    captured.reply = '{"hook_anchor":"top_left","notes":"move hook"}';
    const result = await critiqueAndPatchLayout({stillPath: still, occupancy, plan: plan('')});
    expect(result.plan.hookTitle).toBe('');
    expect(result.source).toBe('geometric+vision');
    // Recorded behaviour: applyGeometricPatches still repositions the anchor of a hook that has no title (position data only).
    // The anchor field may change (it is only a position), but nothing downstream draws a hook for an empty title:
    expect(result.issues.map(issue => issue.kind)).not.toContain('hook_covers_speaker');
  });
});

describe('no key configured: the vision critique is skipped and nothing is requested', () => {
  it('geometric only; no request is made', async () => {
    e.GEMINI_API_KEY = '';
    const result = await critiqueAndPatchLayout({stillPath: still, occupancy, plan: plan('')});
    expect(captured.bodies).toHaveLength(0);
    expect(result.source).toBe('geometric');
  });
});
