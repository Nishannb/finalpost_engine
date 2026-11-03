/**
 * Live repair check for the motion worker: the first "generation" is a saved
 * graphic with deliberately injected faults (a type error, a banned API and a
 * hard-coded SVG id); every later call goes to Claude through the real repair
 * prompt. Proves the bounded repair loop end to end.
 *
 *   node --experimental-strip-types src/scripts/mgRepairDemo.ts <briefs.json> <graphicId>
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {anthropicGenerator, generateMotionGraphic, type MotionGraphicGenerator} from '../motionWorker/worker.ts';
import {remotionRoot} from './mgShared.ts';

const [briefsArg, graphicId] = process.argv.slice(2);
if (!briefsArg || !graphicId) {
  throw new Error('usage: mgRepairDemo.ts <briefs.json> <graphicId>');
}
const spec = JSON.parse(await fs.readFile(path.resolve(briefsArg), 'utf8')) as {
  name: string;
  graphics: Array<{start: number; end: number; brief: {id: string; durationSeconds?: number}}>;
};
const item = spec.graphics.find(graphic => graphic.brief.id === graphicId)!;
const brief = {...item.brief, durationSeconds: item.brief.durationSeconds ?? item.end - item.start};
const genDir = path.join(remotionRoot, 'mg-fixtures/generated', spec.name);
const good = await fs.readFile(path.join(genDir, `${graphicId}.tsx`), 'utf8');

// Faults: a misspelt toolkit prop (type error), Math.random, and a literal SVG id.
const broken = good
  .replace(/<Counter\b/, '<Counter frm={0}')
  .replace(/export default function/, 'const jitter = Math.random();\n\nexport default function')
  .replace(/<\/>\s*\);\s*}\s*$/, '  <svg width={1} height={1}><defs><linearGradient id="glow" /></defs></svg>\n    </>\n  );\n}\n');

const claude = anthropicGenerator();
let calls = 0;
const generator: MotionGraphicGenerator = async request => {
  calls += 1;
  if (calls === 1) {
    return {text: `\`\`\`tsx\n${broken}\`\`\``, stopReason: 'end_turn', model: 'injected-fault', usage: {inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0}};
  }
  return claude(request);
};

const result = await generateMotionGraphic({...brief, id: `${graphicId}_repaired`}, {generator});
await fs.writeFile(path.join(genDir, `${graphicId}.injected.tsx`), broken);
await fs.writeFile(path.join(genDir, `${graphicId}_repaired.tsx`), result.source);
await fs.writeFile(
  path.join(genDir, `${graphicId}_repaired.report.json`),
  JSON.stringify({module: result.module, usage: result.usage, attempts: result.attempts}, null, 2),
);
for (const attempt of result.attempts) {
  console.log(`attempt ${attempt.attempt} (${attempt.kind}): ${attempt.ok ? 'ok' : 'failed'} in ${attempt.ms} ms`);
  for (const line of [...attempt.report.typecheck, ...attempt.report.safety, ...attempt.report.compile]) {
    console.log(`  - ${line}`);
  }
}
console.log(`→ ${result.module.url}`);
