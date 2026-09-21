import {resolveWordRange} from '../../stages/directorV2/perception.ts';
import {LAYER_Z, TOOL_MANIFESTS} from './manifests.ts';
import {isFrozenToolKind, type MediaContext, type Plan, type ScheduledElement, type Timeline} from './types.ts';

export function schedule(plan: Plan, ctx: MediaContext): Timeline {
  const elements: ScheduledElement[] = [];
  for (const element of plan.elements) {
    const range = resolveWordRange(
      ctx.words.map(word => ({
        id: word.id,
        text: word.text,
        start: word.start,
        end: word.end,
        sentenceId: 's0',
      })),
      element.anchor.startWord,
      element.anchor.endWord,
      Number(element.params.preRollMs ?? 0) || 0,
      Number(element.params.postRollMs ?? 0) || 0,
    );
    if (!range) {
      continue;
    }
    const layer = isFrozenToolKind(element.kind)
      ? LAYER_Z[TOOL_MANIFESTS[element.kind].layer]
      : 0;
    elements.push({
      ...element,
      resolved: {
        start: range.start,
        end: Math.min(ctx.durationSec, range.end),
        layer,
      },
    });
  }
  return {elements};
}
