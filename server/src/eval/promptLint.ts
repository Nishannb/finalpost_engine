/**
 * Prompt lint (invariant M10). Finds quota-driven or unconditional-effect wording in the Director prompts.
 * Phase 13 does not edit prompts, so the harness PINS the current findings (golden/prompt-lint.json) as known open
 * items; it fails when a NEW banned phrase appears, and again when the pinned list changes so it can be re-approved.
 */
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverSrc = join(here, '..');
const repoRoot = join(serverSrc, '..', '..');

export const PROMPT_FILES = [
  'server/src/stages/broll/geminiDirector.ts',
  'server/src/lib/editToolkits.ts',
  'server/src/stages/directorV2/promptLoader.ts',
  'prompts/stage2_creative_director.v1.md',
  'prompts/stage2_creative_director.user.v1.md',
  'prompts/stage1_story_analyst.v1.md',
] as const;

export const BANNED: Array<{id: string; pattern: RegExp}> = [
  {id: 'always_on', pattern: /\balways on\b/i},
  {id: 'fixed_count_of_effects', pattern: /\b(?:place|use|add|emit)\s+\d\s*[–-]\s*\d\s+(?:punch-in\s+)?(?:zooms?|moments?|graphics?|counters?)/i},
  {id: 'zoom_count_range', pattern: /\bzooms?\s*:\s*\d\s*[–-]\s*\d/i},
  {id: 'use_often', pattern: /\buse often\b/i},
  {id: 'must_place_toolkit', pattern: /\bMUST place\b/i},
  {id: 'failed_edit_without_effects', pattern: /\bcaptions only is a failed edit\b|\bstill dump on the speaker is a failed edit\b/i},
  {id: 'propose_up_to_n_moments', pattern: /propose up to \$\{/i},
  {id: 'lean_on_effects', pattern: /\blean on kinetic_text\b/i},
  {id: 'never_leave_static', pattern: /\bnever let a static talking head\b/i},
];

export type LintFinding = {file: string; line: number; id: string; text: string};

export function lintPrompts(): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const file of PROMPT_FILES) {
    const lines = readFileSync(join(repoRoot, file), 'utf8').split('\n');
    lines.forEach((text, index) => {
      for (const {id, pattern} of BANNED) {
        if (pattern.test(text)) {
          findings.push({file, line: index + 1, id, text: text.trim().slice(0, 140)});
        }
      }
    });
  }
  return findings;
}
