/**
 * Offline benchmark: drop 10–20 reference mp4s into this folder, then:
 *
 *   npm run eval:template-designer -- ./template-designer-bench/clips
 *
 * Scores are filled by a human after watching Reference vs Remotion recreation.
 */

import {readdir} from 'node:fs/promises';
import path from 'node:path';

import {preprocessReferenceVideo} from '../stages/templateDesigner/preprocess.ts';
import {runTemplateDesigner} from '../stages/templateDesigner/designer.ts';
import {editSpecToCaptionStyleGuide} from '../stages/templateDesigner/applyEditSpec.ts';
import {withWorkspace} from '../lib/tempFiles.ts';

const VIDEO = /\.(mp4|mov|m4v)$/i;

async function main() {
  const dir = path.resolve(process.argv[2] || 'template-designer-bench/clips');
  const names = (await readdir(dir)).filter(name => VIDEO.test(name)).sort();
  if (!names.length) {
    console.error(`No videos in ${dir}`);
    process.exit(1);
  }
  console.log(`# Template Designer benchmark (${names.length} clips)\n`);
  console.log(
    '| clip | template | grouping | animation | confidence | warnings | costUsd |',
  );
  console.log('|---|---|---|---|---|---|---|');
  for (const name of names) {
    const filePath = path.join(dir, name);
    const row = await withWorkspace('td-eval', async workspace => {
      const preprocess = await preprocessReferenceVideo({
        sourcePath: filePath,
        stillPath: n => workspace.file(n),
      });
      const designed = await runTemplateDesigner({preprocess});
      const guide = editSpecToCaptionStyleGuide(designed.spec);
      return {
        template: guide.template,
        grouping: designed.spec.caption.grouping,
        animation: designed.spec.caption.animation,
        confidence: designed.spec.confidence,
        warnings: designed.warnings.length,
        cost: designed.estimatedCostUsd,
      };
    });
    console.log(
      `| ${name} | ${row.template} | ${row.grouping} | ${row.animation} | ${row.confidence.toFixed(2)} | ${row.warnings} | ${row.cost.toFixed(4)} |`,
    );
  }
  console.log('\nHuman scores (fill after watching recreation):');
  console.log(
    'position / grouping / type / animation / timing / camera / overall / reusable (1-5)',
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
