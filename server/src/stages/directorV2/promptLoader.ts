import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const STAGE1_PROMPT_VERSION = 'stage1_story_analyst.v1';
export const STAGE2_PROMPT_VERSION = 'stage2_creative_director.v1';

function engineRoot(): string {
  return path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
}

export function loadPromptFile(name: string): string {
  const file = path.join(engineRoot(), 'prompts', `${name}.md`);
  return readFileSync(file, 'utf8');
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_all, raw: string) => {
    const key = String(raw);
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key]! : `{{${key}}}`;
  });
}

export function hashPromptInput(system: string, userText: string, frameCount = 0): string {
  return createHash('sha256')
    .update(JSON.stringify({system, userText, frameCount}))
    .digest('hex');
}

export function rendererCapabilitiesText(): string {
  return [
    'Delivery Shaping pre-flight: delivery_shaping is audio/pacing only and runs BEFORE this visual plan. It may trim dead air/fillers, add deliberate pauses, use pitch-preserving tempo ramps, automate gain, normalize dynamics, and duck music without changing voice identity. All word IDs and times below are already remapped. Visual tools only consume that shaped timeline.',
    'Supported element kinds: hook_title, cutaway, split, cutout, card, bubble, lockup, kinetic_text, counter, emphasis, zoom, media_container, transition, slideshow, frame_inset, depth_overlay, inset_reveal.',
    'custom_scene is not implemented — do not emit it.',
    'Motion timing (renderer): kinetic_text enter 1.05s / exit 0.78s; split enter 1.45s then HOLD (min 4s still, or the full clip if the related half is video) then exit 1.35s; overlay fade 0.42s; hook_title enter 1.05s. Zoom-in ~0.35s; zoom-out ~1.0s smooth. depth_overlay enter 0.4s (0.2–0.8), easeOutCubic, upper-half plate. inset_reveal scale-in 0.4s / hold / scale-out 0.4s, easeInOutCubic (spring overshoots on the way back).',
    'Still time is the readable part. After entrance, keep the graphic parked long enough to read (~0.35s per word) before exit. Motion should match spoken pace, not rush past it.',
    'hook_title is required. Make it attention-catching but not extreme (boxed / stack / rail / underline). Time it to the opening speech.',
    'Overlay text and titles must use the spoken word range for that phrase — not a stock-search keyword.',
    'split needs a parked still after the slide-in (min ~4s, longer when speech is longer). Video on a split: play the clip only after enter hits 100%, then slide off only after the clip ends.',
    'Params by kind:',
    '- hook_title: text, slot_id, enter, accent_color, text_color',
    '- cutaway/split/cutout: asset.queries[2-3], speaker_side (split), user_asset_id. Split related half can be a video clip, a still, or a slideshow — not always slides.',
    '- depth_overlay: speaker STAYS on screen; asset sits BEHIND them in the upper half (not a cutaway). Requires SUBJECT_MASK available, a relevant user/stock asset, and a visible centered speaker. asset.user_asset_id preferred. params.direction (up|down), opacity (0.5-1, default 0.75), duration (0.2-0.8s enter), exit (bool). Hold 1.5–6s. Never overlap cutaway/split/cutout. Alternate direction. Not for text-heavy full-screen readability.',
    '- inset_reveal: the WHOLE talking-head shrinks into a rounded card (scale ~0.68, top-center) over a colored background, captions move into the space below, then it scales back to full frame. Audio never cuts. This is NOT B-roll (cutaway replaces the speaker) and NOT depth_overlay (that keeps the speaker full-frame with an asset behind them). Prefer for section changes, a key statistic or quotable phrase, a list/step being introduced, a pacing reset after a long unchanged stretch, or when captions themselves are the focus. variant=motion_graphic when there is a concrete stat, keyword, or list item to visualize (graphic.templateId: stat_callout | keyword_title plus text). variant=simple for a quiet emphasis or breathing moment. Do NOT use in the first 3s or last 2s, mid-sentence, when the face/gestures are the story, during cutaway/split/cutout/depth_overlay/frame_inset/media_container, or on a very short video. Hold 2–8s including transitions, ≥6s between uses, cap ~1 per 20s and 30% of runtime. Snap start/end to sentence/phrase boundaries. Prefer the project theme color for background. params: variant, inset_scale (0.55-0.85), background_type (solid|gradient|loop|template), background_value, graphic_template_id, graphic_text, captions (bool), shadow (bool), easing (ease_in_out|spring). intent is the reason.',
    '- card: treatment (card|scroll|suspense|focus|float|wipe|slideshow), focus_region, glow, corner_radius',
    '- slideshow: related stills cycling as a card overlay or on a split half. Use only when related images exist (user photos or stock stills).',
    '- bubble/lockup/kinetic_text: text, shape, font_scale, italic, slot_id, enter, exit, easing',
    '- counter: FAST count-up for a huge spoken number (k/m/b or 20+). Start ~70% of the spoken target (50B starts at 35), tick quickly, then a small scale punch when it lands. count_from, count_to, count_suffix, text. Never invent the target.',
    '- emphasis: treatment (scale|color|pop|underline|type_reveal)',
    '- zoom: zoom_scale (never during cutaway/split/cutout/depth_overlay/inset_reveal)',
    '- media_container: container_mode, canvas_color, corner_radius — only if canvas has real content',
    '- frame_inset: shrink the whole picture to reveal a thick margin (black / white / any color). params.scale (0.70–0.94) is how far to retract; margin_color; transition_sec. Restore with the same smooth motion. Use sometimes, not on every video. This wraps captions too — it is NOT inset_reveal.',
    '- inset_reveal: see params above. Background from the thesis/theme palette. graphic_template_id is stat_callout or keyword_title.',
    '- transition: transition_style',
  ].join('\n');
}
