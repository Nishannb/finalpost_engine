/**
 * A/B harness for GROQ_PRECOMPACT (docs/integration-audit/GROQ_PRECOMPACT_VALIDATION.md). Runs ONLY Stage A (speech extraction + transcription) plus the local, deterministic
 * silence-trim step, so the two arms differ only in the audio Groq hears. No Gemini, no Claude, no render.
 *
 *   dry      <video> --out <dir>                    free: extract + compact locally, print the saving. No network.
 *   arm      <video> --out <dir> --arm original     PAID (one Groq call). Must run with GROQ_PRECOMPACT=0.
 *   arm      <video> --out <dir> --arm compacted    PAID (one Groq call). Must run with GROQ_PRECOMPACT=1.
 *   compare  <dir> [--truth truth.json]             free: reads original.json + compacted.json, writes comparison.md + comparison.json.
 *
 * Each arm uses its own fresh transcript cache (<dir>/asr-cache-<arm>, wiped first), so neither arm can reuse the other's result or an older one; the run aborts if the
 * cache reports a hit. The compacted arm aborts if compaction was skipped (the A/B would compare the original against itself).
 */

import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';

import {env} from '../config/env.ts';
import {withObserver, type RunEvent} from '../lib/runObserver.ts';
import {extractSpeechAudio, probeMedia} from '../media/ffmpeg.ts';
import {prepareSpeechCuts} from '../stages/audio/speechVad.ts';
import {autoTrimSilence} from '../stages/filters/autoTrim.ts';
import {fileSha256, type TranscriptionResult} from '../stages/transcribe/groqTranscribe.ts';
import {compactSpeechAudio, precompactCacheVariant, transcribeWithPrecompact, type TimeMap} from '../stages/transcribe/precompact.ts';
import type {KeepSegment, LanguageCode, WordToken} from '../types/blueprint.ts';

type Arm = 'original' | 'compacted';

type ArmFile = {
  arm: Arm;
  createdAt: string;
  videoSha256: string;
  speechOggSha256: string;
  model: string;
  language: string;
  groqPrecompactFlag: boolean;
  cacheVariant: string | null;
  cacheHit: boolean;
  precompact: Record<string, unknown> | null;
  sourceDurationSec: number;
  billedAudioSec: number;
  estimatedCostUsd: number;
  detectedLanguage: string;
  transcript: string;
  words: WordToken[];
  /** Compacted arm only: the time map (re-derived deterministically; its file hash must equal the uploaded one). */
  timeMap: TimeMap | null;
  /** Local, deterministic downstream: the same VAD + silence trim analyzeVideo runs (default profile). */
  trim: {keepSegments: KeepSegment[]; removedSec: number; skipped?: string; vadWarning?: string};
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

class AbortAB extends Error {}

/** Stop with exit code 2. Throws instead of process.exit() so the logger can flush. */
function die(msg: string): never {
  throw new AbortAB(msg);
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

async function sha256File(p: string): Promise<string> {
  return fileSha256(p);
}

async function localTrim(audioPath: string, words: WordToken[], durationSec: number): Promise<ArmFile['trim']> {
  const vad = env.VAD_ENABLED ? await prepareSpeechCuts({audioPath, words, durationSec}) : null;
  const res = autoTrimSilence(vad ? vad.words : words, {
    thresholdSec: env.SILENCE_THRESHOLD_SEC,
    paddingSec: env.SILENCE_PADDING_SEC,
    sourceDurationSec: durationSec,
    removeFillers: true,
    aggressiveBackchannel: false,
    ...(vad ? {speechRegions: vad.speechRegions, pausePolicy: vad.pausePolicy} : {}),
  });
  return {keepSegments: res.keepSegments, removedSec: r3(res.removedSec), ...(res.skipped ? {skipped: res.skipped} : {}), ...(vad?.warning ? {vadWarning: vad.warning} : {})};
}

async function prepare(video: string, work: string): Promise<{speech: {path: string; bytes: number}; durationSec: number; videoSha: string}> {
  if (!existsSync(video)) die(`video not found: ${video}`);
  mkdirSync(work, {recursive: true});
  const probe = await probeMedia(video);
  if (!probe.hasAudio) die('the video has no audio track');
  const speech = await extractSpeechAudio(video, path.join(work, 'speech.ogg'));
  return {speech, durationSec: probe.durationSec, videoSha: await sha256File(video)};
}

async function dry(video: string, out: string): Promise<void> {
  const work = path.join(out, 'dry-work');
  const {speech, durationSec} = await prepare(video, work);
  const res = await compactSpeechAudio({audioPath: speech.path, outputPath: path.join(work, 'speech.groq.ogg')});
  const summary = {
    applied: res.applied,
    reason: res.applied ? null : res.reason,
    probeDurationSec: r3(durationSec),
    ...(res.stats ?? {}),
    groqUsdOriginal: (((res.stats?.originalSec ?? durationSec) / 3600) * 0.04).toFixed(6),
    groqUsdCompacted: res.applied ? ((res.stats.compactSec / 3600) * 0.04).toFixed(6) : null,
  };
  writeFileSync(path.join(out, 'dry.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${path.join(out, 'dry.json')}. No network call was made.`);
}

async function runArm(video: string, out: string, arm: Arm): Promise<void> {
  const want = arm === 'compacted';
  if (env.GROQ_PRECOMPACT !== want) {
    die(`--arm ${arm} needs GROQ_PRECOMPACT=${want ? 1 : 0}, but the effective value is ${env.GROQ_PRECOMPACT ? 1 : 0} (a .env file overrides the shell; see the guide).`);
  }
  if (!env.GROQ_API_KEY) die('GROQ_API_KEY is not set; the arm needs a real Groq call.');
  const language = (arg('lang') ?? 'auto') as LanguageCode | 'auto';
  const work = path.join(out, `${arm}-work`);
  rmSync(work, {recursive: true, force: true});
  const cacheDir = path.join(out, `asr-cache-${arm}`);
  rmSync(cacheDir, {recursive: true, force: true});

  const {speech, durationSec, videoSha} = await prepare(video, work);
  const speechSha = await sha256File(speech.path);
  const events: RunEvent[] = [];
  const result: TranscriptionResult = await withObserver(
    event => events.push(event),
    () =>
      transcribeWithPrecompact({
        audioPath: speech.path,
        audioBytes: speech.bytes,
        languageCode: language,
        durationSec,
        cacheDir,
        compactPath: path.join(work, 'speech.groq.ogg'),
      }),
  );
  const cacheEvent = events.find(e => e.type === 'transcription_cache');
  const preEvent = events.find(e => e.type === 'transcription_precompact') ?? null;
  if (!cacheEvent) die('no transcription_cache event was observed; the transcription path did not run as expected.');
  if (cacheEvent.hit) die('the transcript cache reported a HIT in a freshly wiped cache dir; the result is not a real transcription.');
  if (want && !preEvent?.applied) die(`compaction was skipped (${String(preEvent?.reason)}); this clip cannot be A/B tested. Pick a clip with pauses longer than 0.8 s.`);
  if (await sha256File(speech.path) !== speechSha) die('speech.ogg changed during the run (must never happen).');

  let timeMap: TimeMap | null = null;
  if (want) {
    const again = await compactSpeechAudio({audioPath: speech.path, outputPath: path.join(work, 'map-check.groq.ogg')});
    if (!again.applied) die('re-deriving the time map failed.');
    if ((await sha256File(again.path)) !== (await sha256File(path.join(work, 'speech.groq.ogg')))) die('compaction is not deterministic on this host; the stored map may not match the upload.');
    timeMap = again.map;
  }

  const billedAudioSec = want ? Number(preEvent?.compactSec ?? 0) : r3(durationSec);
  const file: ArmFile = {
    arm,
    createdAt: new Date().toISOString(),
    videoSha256: videoSha,
    speechOggSha256: speechSha,
    model: env.GROQ_MODEL,
    language: String(language),
    groqPrecompactFlag: env.GROQ_PRECOMPACT,
    cacheVariant: want ? precompactCacheVariant() : null,
    cacheHit: Boolean(cacheEvent.hit),
    precompact: preEvent ? {...preEvent} : null,
    sourceDurationSec: r3(durationSec),
    billedAudioSec,
    estimatedCostUsd: result.estimatedCostUsd,
    detectedLanguage: result.detectedLanguage,
    transcript: result.transcript,
    words: result.words,
    timeMap,
    trim: await localTrim(speech.path, result.words, durationSec),
  };
  writeFileSync(path.join(out, `${arm}.json`), `${JSON.stringify(file, null, 2)}\n`);
  console.log(`\n${arm}: ${result.words.length} words, billed ${billedAudioSec}s, cache hit ${file.cacheHit}. Wrote ${path.join(out, `${arm}.json`)}`);
}

// ---------------------------------------------------------------- compare (offline)

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');
const punct = (t: string) => (t.match(/[.,!?;:…-]+$/)?.[0] ?? '');

type Op = {kind: 'match' | 'missing' | 'extra'; a?: number; b?: number};

/** Word-level edit alignment (LCS on normalised tokens). a = reference side, b = hypothesis side. */
function align(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({length: n + 1}, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push({kind: 'match', a: i++, b: j++});
    else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) ops.push({kind: 'extra', b: j++});
    else ops.push({kind: 'missing', a: i++});
  }
  return ops;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p))]!;
}

function removedRanges(map: TimeMap | null): Array<[number, number]> {
  if (!map) return [];
  const sr = map.sampleRate;
  const out: Array<[number, number]> = [];
  let prev = 0;
  for (const s of map.segments) {
    if (s.srcStart > prev) out.push([prev / sr, s.srcStart / sr]);
    prev = s.srcEnd;
  }
  if (map.sourceSamples > prev) out.push([prev / sr, map.sourceSamples / sr]);
  return out;
}

/** Word error rate (Levenshtein on normalised tokens) against a reference, plus deletions / insertions from the alignment. */
function wer(ref: string[], hyp: string[]): {wer: number; del: number; ins: number} {
  const n = ref.length;
  const m = hyp.length;
  let prev = Array.from({length: m + 1}, (_, j) => j);
  for (let i = 1; i <= n; i += 1) {
    const cur = [i];
    for (let j = 1; j <= m; j += 1) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    prev = cur;
  }
  const ops = align(ref, hyp);
  const del = ops.filter(o => o.kind === 'missing').length;
  const ins = ops.filter(o => o.kind === 'extra').length;
  const dist = prev[m]!;
  return {wer: n ? dist / n : 0, del, ins};
}

function compare(dir: string): void {
  const read = (f: string): ArmFile => {
    const p = path.join(dir, f);
    if (!existsSync(p)) die(`missing ${p}; run both arms first.`);
    return JSON.parse(readFileSync(p, 'utf8')) as ArmFile;
  };
  const A = read('original.json');
  const B = read('compacted.json');
  const checks: string[] = [];
  const same = (label: string, ok: boolean) => checks.push(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  same('same source video (sha256)', A.videoSha256 === B.videoSha256);
  same('same speech.ogg (sha256)', A.speechOggSha256 === B.speechOggSha256);
  same('same model', A.model === B.model);
  same('same language setting', A.language === B.language);
  same('arm A ran with GROQ_PRECOMPACT=0', A.groqPrecompactFlag === false);
  same('arm B ran with GROQ_PRECOMPACT=1 and compaction applied', B.groqPrecompactFlag === true && B.precompact?.applied === true);
  same('neither arm was a cache hit', !A.cacheHit && !B.cacheHit);

  const dur = A.sourceDurationSec;
  const removed = removedRanges(B.timeMap);
  const inRemoved = (t: number) => removed.some(([s, e]) => t > s + 1e-6 && t < e - 1e-6);
  const nearSeam = (t: number) => removed.some(([s, e]) => Math.abs(t - s) <= 0.5 || Math.abs(t - e) <= 0.5);

  // Timeline safety (compacted-arm words must be on the source clock).
  const bad = B.words.filter((w, i) => w.start < 0 || w.end > dur + 1e-6 || w.end < w.start || (i > 0 && w.start < B.words[i - 1]!.start));
  same('compacted words: within [0, source duration], end >= start, starts non-decreasing', bad.length === 0);
  const spanning = B.words.filter(w => removed.some(([s, e]) => w.start < s && w.end > e));
  same('no compacted word spans a removed range', spanning.length === 0);
  const startsInRemoved = B.words.filter(w => inRemoved(w.start));
  same('no compacted word starts inside removed audio', startsInRemoved.length === 0);

  const aTok = A.words.map(w => norm(w.text));
  const bTok = B.words.map(w => norm(w.text));
  const ops = align(aTok, bTok);
  const matched = ops.filter(o => o.kind === 'match');
  const missing = ops.filter(o => o.kind === 'missing').map(o => A.words[o.a!]!);
  const extra = ops.filter(o => o.kind === 'extra').map(o => B.words[o.b!]!);
  const dStart = matched.map(o => Math.abs(A.words[o.a!]!.start - B.words[o.b!]!.start)).sort((x, y) => x - y);
  const dEnd = matched.map(o => Math.abs(A.words[o.a!]!.end - B.words[o.b!]!.end)).sort((x, y) => x - y);
  const punctDiff = matched.filter(o => punct(A.words[o.a!]!.text) !== punct(B.words[o.b!]!.text));
  const seamWords = matched.filter(o => nearSeam(A.words[o.a!]!.start));
  const dSeam = seamWords.map(o => Math.abs(A.words[o.a!]!.start - B.words[o.b!]!.start)).sort((x, y) => x - y);
  const missingNearSeam = missing.filter(w => nearSeam(w.start));
  const missingInRemoved = missing.filter(w => inRemoved(w.start) || inRemoved((w.start + w.end) / 2));
  const sentenceEnds = (ws: WordToken[]) => ws.filter(w => /[.!?]$/.test(w.text)).length;
  const caption200 = matched.filter(o => Math.abs(A.words[o.a!]!.start - B.words[o.b!]!.start) > 0.2);

  // Downstream (deterministic): keep segments of the silence trim on each arm.
  const keptA = A.trim.keepSegments.reduce((s, k) => s + (k.sourceEnd - k.sourceStart), 0);
  const keptB = B.trim.keepSegments.reduce((s, k) => s + (k.sourceEnd - k.sourceStart), 0);
  const boundaryDiff = (() => {
    const ea = A.trim.keepSegments.flatMap(k => [k.sourceStart, k.sourceEnd]);
    const eb = B.trim.keepSegments.flatMap(k => [k.sourceStart, k.sourceEnd]);
    return ea.map(x => Math.min(...eb.map(y => Math.abs(x - y)))).sort((x, y) => x - y);
  })();
  const keepBad = B.trim.keepSegments.filter(k => k.sourceStart < 0 || k.sourceEnd > dur + 1e-6);
  same('compacted-arm keep segments are on the source clock', keepBad.length === 0);

  let truthRows = '';
  const truthPath = arg('truth');
  if (truthPath) {
    const raw = JSON.parse(readFileSync(truthPath, 'utf8')) as unknown;
    const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((w: {text?: string; word?: string}) => w.text ?? w.word ?? '').join(' ') : String((raw as {text?: string}).text ?? '');
    const ref = text.split(/\s+/).map(norm).filter(Boolean);
    const wa = wer(ref, aTok.filter(Boolean));
    const wb = wer(ref, bTok.filter(Boolean));
    truthRows = `| WER vs human truth | ${(wa.wer * 100).toFixed(2)}% (del ${wa.del}, ins ${wa.ins}) | ${(wb.wer * 100).toFixed(2)}% (del ${wb.del}, ins ${wb.ins}) |\n`;
  }

  const ms = (v: number) => `${Math.round(v * 1000)} ms`;
  const fmtWords = (ws: WordToken[]) => (ws.length ? ws.slice(0, 40).map(w => `\`${w.text}\`@${w.start.toFixed(2)}`).join(', ') + (ws.length > 40 ? ` … (+${ws.length - 40})` : '') : 'none');
  const table = `| Metric | Original (A) | Compacted (B) |
|---|---|---|
| Audio duration sent to Groq | ${A.billedAudioSec.toFixed(2)} s | ${B.billedAudioSec.toFixed(2)} s |
| Reduction | — | ${(((A.billedAudioSec - B.billedAudioSec) / A.billedAudioSec) * 100).toFixed(1)}% (${(A.billedAudioSec - B.billedAudioSec).toFixed(2)} s) |
| Estimated Groq cost | $${A.estimatedCostUsd.toFixed(6)} | $${B.estimatedCostUsd.toFixed(6)} |
| Transcribed word count | ${A.words.length} | ${B.words.length} |
| Missing words (in A, not in B) | — | ${missing.length} (${missingNearSeam.length} within 0.5 s of a cut, ${missingInRemoved.length} inside removed audio) |
| Additional words (in B, not in A) | — | ${extra.length} |
| Word start Δ on matched words (median / p95 / max) | — | ${ms(pct(dStart, 0.5))} / ${ms(pct(dStart, 0.95))} / ${ms(pct(dStart, 1))} |
| Word end Δ on matched words (median / p95 / max) | — | ${ms(pct(dEnd, 0.5))} / ${ms(pct(dEnd, 0.95))} / ${ms(pct(dEnd, 1))} |
| Start Δ for words within 0.5 s of a cut (n=${seamWords.length}; median / max) | — | ${ms(pct(dSeam, 0.5))} / ${ms(pct(dSeam, 1))} |
| Phrase/punctuation differences (matched words with different trailing punctuation) | — | ${punctDiff.length} |
| Sentence ends (. ! ?) | ${sentenceEnds(A.words)} | ${sentenceEnds(B.words)} |
| Caption alignment (matched words whose start moved > 200 ms) | — | ${caption200.length} |
| Silence trim: kept source seconds | ${keptA.toFixed(2)} s | ${keptB.toFixed(2)} s |
| Silence trim: keep-segment edges (count / max edge Δ) | ${A.trim.keepSegments.length * 2} | ${B.trim.keepSegments.length * 2} / ${ms(pct(boundaryDiff, 1))} |
${truthRows}`;

  const md = `# GROQ_PRECOMPACT A/B comparison

Generated ${new Date().toISOString()} from \`${dir}\`.

## Setup checks

\`\`\`
${checks.join('\n')}
\`\`\`

## Metrics

${table}
## Details

- Removed ranges (source clock): ${removed.length} — ${removed.slice(0, 30).map(([s, e]) => `${s.toFixed(2)}–${e.toFixed(2)}`).join(', ')}${removed.length > 30 ? ' …' : ''}
- Missing words: ${fmtWords(missing)}
- Additional words: ${fmtWords(extra)}
- Punctuation changes: ${punctDiff.slice(0, 40).map(o => `\`${A.words[o.a!]!.text}\`→\`${B.words[o.b!]!.text}\`@${A.words[o.a!]!.start.toFixed(2)}`).join(', ') || 'none'}
- Words that moved > 200 ms: ${caption200.slice(0, 40).map(o => `\`${A.words[o.a!]!.text}\` ${A.words[o.a!]!.start.toFixed(2)}→${B.words[o.b!]!.start.toFixed(2)}`).join(', ') || 'none'}
- Compacted words starting inside removed audio: ${fmtWords(startsInRemoved)}
- Compacted words spanning a removed range: ${fmtWords(spanning)}
- Transcript A: ${A.transcript.length} chars; transcript B: ${B.transcript.length} chars.
`;
  writeFileSync(path.join(dir, 'comparison.md'), md);
  writeFileSync(
    path.join(dir, 'comparison.json'),
    `${JSON.stringify({checks, missing, extra, punctDiff: punctDiff.length, dStart: {p50: pct(dStart, 0.5), p95: pct(dStart, 0.95), max: pct(dStart, 1)}, seam: {n: seamWords.length, max: pct(dSeam, 1)}, caption200: caption200.length, trim: {keptA, keptB, maxEdgeDelta: pct(boundaryDiff, 1)}}, null, 2)}\n`,
  );
  console.log(md);
  console.log(`Wrote ${path.join(dir, 'comparison.md')} and comparison.json. No network call was made.`);
}

async function main(): Promise<void> {
  const [mode, target] = process.argv.slice(2);
  const out = arg('out');
  if (mode === 'compare') return compare(target ?? die('usage: compare <dir> [--truth truth.json]'));
  if (!target || !out || (mode !== 'dry' && mode !== 'arm')) {
    die('usage:\n  dry <video> --out <dir>\n  arm <video> --out <dir> --arm original|compacted [--lang auto]\n  compare <dir> [--truth truth.json]');
  }
  mkdirSync(out, {recursive: true});
  if (mode === 'dry') return dry(target, out);
  const arm = arg('arm');
  if (arm !== 'original' && arm !== 'compacted') die('--arm must be original or compacted');
  return runArm(target, out, arm);
}

try {
  await main();
} catch (error) {
  if (!(error instanceof AbortAB)) throw error;
  console.error(`\nprecompactAB: ${error.message}\n`);
  process.exitCode = 2;
}
