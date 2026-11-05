/**
 * WP7D source-text tests: on the cuts profile analyzeVideo still skips the Director / B-roll / graphics / delivery shaping and still forces the trim, the transcript retakes and the denoise.
 * analyzeVideo imports the logger, so it is read, not imported. The inventory report is read too. No FFmpeg, no network.
 */
import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {describe, expect, it} from 'vitest';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const analyze = readFileSync(resolve(REPO, 'server/src/pipeline/analyzeVideo.ts'), 'utf8');
const REPORT = resolve(REPO, 'remotion/out/phase36-readiness/WP7D_CUTS_PATH_INVENTORY.md');

/** The text between two anchors (both must exist, in order). */
function between(start: string, end: string): string {
  const a = analyze.indexOf(start);
  const b = analyze.indexOf(end, a + start.length);
  expect(a, start).toBeGreaterThan(-1);
  expect(b, end).toBeGreaterThan(a);
  return analyze.slice(a, b);
}

describe('cuts path: what must not run', () => {
  it('visual edits, motion graphics and delivery shaping are switched off by cutsPath', () => {
    expect(analyze).toContain("const cutsOnlyVisualsOff = input.editProfile === 'cuts';");
    expect(analyze).toContain('const visualEditsOn = !cutsOnlyVisualsOff && visualToolkitsRequested(requestedEdits);');
    expect(analyze).toContain('const motionGraphicsRequested = !cutsOnlyVisualsOff && (input.generatedGraphicsEnabled ?? flags.motionGraphics);');
    expect(analyze).toContain('const deliveryDenied = input.forceDeliveryShaping === false || cutsOnlyVisualsOff;');
    expect(analyze).toContain("warnings.push('delivery_shaping_skipped:cuts_profile');");
    expect(analyze).toContain('const captionsOnly = !visualEditsOn;');
  });
  it('delivery shaping stages are only reachable through deliveryAllowed (which the cuts profile denies)', () => {
    const block = between('if (deliveryAllowed && (deliveryExplicit || (env.DELIVERY_SHAPING_AUTO && !polishPath))) {', 'if (speechCutsOn && env.CUTS_DENOISE_ENABLED) {');
    for (const call of ['analyzeDeliveryAcoustics(', 'directDeliveryShaping(', 'planDeliveryShaping(', 'renderDeliveryShaping(']) expect(block).toContain(call);
    expect(analyze).toMatch(/const deliveryAllowed =\s*!deliveryDenied &&/);
  });
  it('B-roll, Director, occupancy, cutout and layout calls all live in the else of the captions-only branch', () => {
    const elseBlock = between('} else {\n      const userBrollAssets = await describeUserBrollAssets(', '// --- Stage C2: generated motion graphics (opt-in)');
    for (const call of ['describeUserBrollAssets(', 'measureOccupancy(', 'detectSpeakerCutout(', 'planBRoll(', 'composeBeautifulLayout(', 'resolveDirectedZooms(']) expect(elseBlock).toContain(call);
    for (const call of ['describeUserBrollAssets(', 'measureOccupancy(', 'detectSpeakerCutout(', 'planBRoll(', 'composeBeautifulLayout(', 'resolveDirectedZooms(']) expect(analyze.split(call).length - 1, call).toBeGreaterThanOrEqual(1);
    // the captions-only branch itself uses only the pure caption plan
    const captionsBranch = between('    if (captionsOnly) {', '} else {\n      const userBrollAssets = await describeUserBrollAssets(');
    for (const call of ['planBRoll(', 'measureOccupancy(', 'describeUserBrollAssets(', 'classifyContent(', 'runMotionGraphicsStage(']) expect(captionsBranch).not.toContain(call);
    expect(captionsBranch).toContain('captionsOnlyVisualPlan(');
  });
  it('the content profile, the Director video proxy and the motion stage need a visual or graphics switch that cuts turns off', () => {
    expect(analyze).toContain('if (env.CONTENT_PROFILE_ENABLED && (visualEditsOn || motionGraphicsOn)) {');
    expect(analyze).toContain('if (input.directorVideoInput && (visualEditsOn || motionGraphicsOn)) {');
    expect(analyze).toContain('if (motionGraphicsOn) {');
  });
  it('the mvp-only legibility block does not run for cuts', () => {
    expect(analyze).toContain("if (mvpLike && !captionsOnly) {");
  });
  it('the captions-only plan is pure: no hook, no zooms, no model call', () => {
    const planner = readFileSync(resolve(REPO, 'server/src/stages/broll/brollPlanner.ts'), 'utf8');
    const body = planner.slice(planner.indexOf('export function captionsOnlyVisualPlan'), planner.indexOf('export function captionsOnlyVisualPlan') + 900);
    for (const part of ["hookTitle: ''", 'zooms: []', 'clips: []', 'motionGraphics: []', "'pipeline:captions_only'", 'estimatedCostUsd: 0']) expect(body).toContain(part);
    for (const word of ['requestJson', 'fetch(', 'gemini', 'await ']) expect(body.toLowerCase()).not.toContain(word.toLowerCase());
  });
});

describe('cuts path: what must run', () => {
  it('the denoise runs on cuts only, before the trim decision, and never throws', () => {
    const block = between('if (speechCutsOn && env.CUTS_DENOISE_ENABLED) {', 'const captionsOnly = !visualEditsOn;');
    for (const part of ['denoiseTalkingHeadAudio(', 'buildDenoiseFilter(', 'uploadSourceVideo(', 'DENOISE_APPLIED_WARNING', 'DENOISE_FAILED_WARNING']) expect(block).toContain(part);
    expect(block).not.toContain('throw');
    expect(analyze.indexOf('if (speechCutsOn && env.CUTS_DENOISE_ENABLED) {')).toBeLessThan(analyze.indexOf('const skipSilenceTrim ='));
  });
  it('the trim is forced on: neither the captions-only nor the template switch can skip it on cuts', () => {
    const block = between('const skipSilenceTrim =', 'let trim: {');
    expect(block).toContain('(captionsOnly && !teleprompterClean && !speechCutsOn) ||');
    expect(block).toContain('!teleprompterClean && !speechCutsOn);');
    expect(block).toContain('Boolean(deliveryShaping) ||');
  });
  it('silence, fillers, non-speech and transcript retakes all run in the trim branch, with fillers on and no script required', () => {
    const block = between('const silence = autoTrimSilence(', 'const merged = mergeTimeRanges(exclusions);');
    expect(block).toContain('removeFillers: true,');
    expect(block).toContain('nonSpeechExclusions(');
    expect(block).toContain("if ((input.editProfile === 'mvp' && !captionsOnly) || teleprompterClean || speechCutsOn) {");
    expect(block).toContain('transcriptRetakeExclusions(');
    expect(block).toContain('transcript_retakes_dropped:');
    const gated = block.slice(block.indexOf('if ((input.editProfile'), block.indexOf('if (silence.skipped'));
    expect(gated).not.toContain('scriptText');
  });
  it('the cut timeline feeds the captions', () => {
    expect(analyze).toContain('const timeline = buildTimeline(trim.keepSegments);');
    expect(analyze).toContain('buildCaptionWords(activeWords, timeline, trim.trimExclusions)');
  });
});

describe('the inventory report', () => {
  it('exists and cites the cut steps, the skipped visual steps and the honest gaps', () => {
    expect(existsSync(REPORT)).toBe(true);
    const text = readFileSync(REPORT, 'utf8');
    for (const part of ['analyzeVideoUnguarded', 'autoTrimSilence', 'transcriptRetakeExclusions', 'denoiseTalkingHeadAudio', 'planBRoll', 'runMotionGraphicsStage', 'planDeliveryShaping', 'Whisper-omitted', 'Unnecessary information', 'Music, other voices', 'Untuned thresholds', 'NOT met yet', 'not authorization']) expect(text).toContain(part);
  });
});
