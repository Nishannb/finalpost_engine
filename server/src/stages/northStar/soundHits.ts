/**
 * Resolve SFX hits onto the output timeline. Uses the director's word-id
 * cues when present, then adds whooshes on split enters and hits on counters.
 */

import type {
  AudioDesign,
  CaptionWord,
  MotionGraphic,
  SemanticEmphasis,
  VisualOverlay,
  WordToken,
} from '../../types/blueprint.ts';

export type SoundHit = {
  at: number;
  kind: 'whoosh' | 'hit' | 'pop';
  volume?: number;
  reason?: string;
};

const KIND_MAP: Record<string, SoundHit['kind']> = {
  whoosh: 'whoosh',
  hit: 'hit',
  pop: 'pop',
  click: 'pop',
  swell: 'whoosh',
  riser: 'whoosh',
};

export function resolveSoundHits(input: {
  audio?: AudioDesign;
  words?: Array<CaptionWord | WordToken>;
  overlays: VisualOverlay[];
  motionGraphics: MotionGraphic[];
  semanticEmphasis: SemanticEmphasis[];
}): SoundHit[] {
  const hits: SoundHit[] = [];
  const byId = new Map<string, number>(
    (input.words ?? []).map((word, index) => [`w${index}`, word.start]),
  );

  for (const cue of input.audio?.sfx ?? []) {
    const kind = KIND_MAP[cue.kind] || (cue.kind === 'none' ? undefined : 'pop');
    const at = byId.get(cue.atWordId);
    // A real sound designer must be able to name why the hit exists.
    if (!kind || at == null || cue.intent.trim().length < 12) {
      continue;
    }
    hits.push({
      at,
      kind,
      volume: kind === 'whoosh' ? 0.1 : 0.14,
      reason: cue.intent,
    });
  }

  // Never attach sound merely because text appeared. The only deterministic
  // exception is a large number landing, where the audiovisual event is clear.
  for (const item of input.semanticEmphasis) {
    if (item.treatment === 'count') {
      hits.push({
        at: item.start + Math.min(0.35, (item.end - item.start) * 0.4),
        kind: 'hit',
        volume: 0.12,
        reason: 'large number lands',
      });
    }
  }

  return dedupe(hits, 4.5).slice(0, 5);
}

function dedupe(hits: SoundHit[], minGapSec: number): SoundHit[] {
  const sorted = [...hits].sort((a, b) => a.at - b.at);
  const out: SoundHit[] = [];
  for (const hit of sorted) {
    const previous = out.at(-1);
    if (previous && Math.abs(previous.at - hit.at) < minGapSec) {
      continue;
    }
    out.push(hit);
  }
  return out;
}
