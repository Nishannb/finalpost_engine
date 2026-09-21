import {ASSET_ID_MAX_LENGTH, parseLegalAssetId} from '../../lib/assembler/assetId.ts';
import {
  CAPTION_ANIMATIONS,
  CAPTION_POSITIONS,
  CAPTION_TEMPLATES,
  MEDIA_CONTAINER_MODES,
  MOTION_SHAPES,
  OVERLAY_TREATMENTS,
} from '../../types/blueprint.ts';

export const CONTENT_TYPES = [
  'educational_tips',
  'story',
  'sales_pitch',
  'opinion',
  'tutorial',
  'announcement',
  'testimonial',
  'comedy',
  'other',
] as const;

export const BEAT_ROLES = [
  'hook',
  'setup',
  'claim',
  'proof',
  'list_item',
  'story',
  'turn',
  'objection',
  'cta',
  'payoff',
  'transition',
] as const;

export const SPEAKER_PRESENCE = ['required', 'preferred', 'optional'] as const;
export const VISUAL_POTENTIAL = ['none', 'light', 'strong'] as const;
export const CTA_ACTIONS = ['comment', 'follow', 'dm', 'link', 'buy', 'share', 'other'] as const;
export const PACING_TARGETS = ['fast', 'medium', 'slow'] as const;

/** Renderer-backed kinds only. custom_scene is omitted until an interpreter exists. */
export const ELEMENT_KINDS = [
  'hook_title',
  'cutaway',
  'split',
  'cutout',
  'card',
  'bubble',
  'lockup',
  'kinetic_text',
  'counter',
  'emphasis',
  'zoom',
  'media_container',
  'transition',
  'slideshow',
  'frame_inset',
  'depth_overlay',
  'inset_reveal',
] as const;

export const ENTER_ANIMS = [
  'spring_up',
  'slide_left',
  'slide_right',
  'scale_pop',
  'fade_blur',
  'type_stagger',
  'mask_wipe',
  'highlight_type',
  'slide_from_edge',
  'cut',
] as const;

export const EXIT_ANIMS = ['fade', 'spring_out', 'slide_away', 'cut'] as const;
export const EASINGS = ['linear', 'ease_in', 'ease_out', 'ease_in_out', 'spring', 'overshoot'] as const;
export const SFX_TYPES = ['whoosh', 'hit', 'pop', 'riser', 'click', 'swell', 'none'] as const;

/** Preflight Director decision. It runs before visual planning because it changes time. */
export const DELIVERY_SHAPING_DECISION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    style: {type: 'STRING', enum: ['delivery_shaping']},
    intensity: {
      type: 'STRING',
      enum: ['subtle', 'balanced', 'energetic'],
    },
    presets: {
      type: 'OBJECT',
      properties: {
        dynamics: {type: 'STRING', enum: ['natural', 'punchy', 'podcast']},
        target_lufs: {type: 'NUMBER'},
      },
    },
    ops: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          op: {
            type: 'STRING',
            enum: [
              'trim_silence',
              'trim_filler',
              'insert_pause',
              'speed_ramp',
              'gain_automation',
              'dynamics_chain',
              'music_ducking',
            ],
          },
          start: {type: 'NUMBER'},
          end: {type: 'NUMBER'},
          params: {
            type: 'OBJECT',
            properties: {
              minSilenceMs: {type: 'NUMBER'},
              keepMs: {type: 'NUMBER'},
              silenceThresholdDb: {type: 'NUMBER'},
              maxRemovalsPerMinute: {type: 'NUMBER'},
              position: {
                type: 'STRING',
                enum: ['before_word', 'after_word', 'sentence_end'],
              },
              durationMs: {type: 'NUMBER'},
              fill: {type: 'STRING', enum: ['room_tone', 'silence']},
              rate: {type: 'NUMBER'},
              rampInMs: {type: 'NUMBER'},
              rampOutMs: {type: 'NUMBER'},
              gainDb: {type: 'NUMBER'},
              attackMs: {type: 'NUMBER'},
              releaseMs: {type: 'NUMBER'},
              preset: {
                type: 'STRING',
                enum: ['natural', 'punchy', 'podcast'],
              },
              targetLufs: {type: 'NUMBER'},
              duckDb: {type: 'NUMBER'},
            },
          },
          reason: {type: 'STRING'},
        },
        required: ['op', 'start', 'end', 'reason'],
      },
    },
    useLlmEmphasis: {type: 'BOOLEAN'},
    reason: {type: 'STRING'},
  },
  required: ['style', 'intensity', 'reason'],
} as const;

const string = {type: 'STRING' as const};
const integer = {type: 'INTEGER' as const};
const number = {type: 'NUMBER' as const};
const boolean = {type: 'BOOLEAN' as const};
const stringEnum = (values: readonly string[]) => ({type: 'STRING' as const, enum: [...values]});

export const STAGE1_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    content_type: stringEnum(CONTENT_TYPES),
    audience: string,
    promise: string,
    tone: string,
    emotional_arc: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          phase: string,
          start_word_id: string,
          end_word_id: string,
          feeling: string,
        },
        required: ['phase', 'start_word_id', 'end_word_id', 'feeling'],
      },
    },
    hook: {
      type: 'OBJECT',
      properties: {
        start_word_id: string,
        end_word_id: string,
        stopping_power: integer,
        weakness: string,
        cold_open: {
          type: 'OBJECT',
          properties: {
            recommended: boolean,
            start_word_id: string,
            end_word_id: string,
            reason: string,
          },
          required: ['recommended', 'start_word_id', 'end_word_id', 'reason'],
        },
      },
      required: ['start_word_id', 'end_word_id', 'stopping_power', 'weakness', 'cold_open'],
    },
    core_message: string,
    beats: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: string,
          start_word_id: string,
          end_word_id: string,
          role: stringEnum(BEAT_ROLES),
          importance: integer,
          energy: integer,
          what_is_on_screen: string,
          viewer_need: string,
          speaker_presence: stringEnum(SPEAKER_PRESENCE),
          visual_potential: stringEnum(VISUAL_POTENTIAL),
        },
        required: [
          'id',
          'start_word_id',
          'end_word_id',
          'role',
          'importance',
          'energy',
          'what_is_on_screen',
          'viewer_need',
          'speaker_presence',
          'visual_potential',
        ],
      },
    },
    existing_cta: {
      type: 'OBJECT',
      properties: {
        present: boolean,
        start_word_id: string,
        end_word_id: string,
        action: stringEnum(CTA_ACTIONS),
        keyword: string,
        suggested: boolean,
        suggested_beat_id: string,
        suggested_spoken_line: string,
      },
      required: ['present', 'suggested'],
    },
    pacing: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          beat_ids: {type: 'ARRAY', items: string},
          target: stringEnum(PACING_TARGETS),
          why: string,
        },
        required: ['beat_ids', 'target', 'why'],
      },
    },
    risks: {type: 'ARRAY', items: string},
  },
  required: [
    'content_type',
    'audience',
    'promise',
    'tone',
    'emotional_arc',
    'hook',
    'core_message',
    'beats',
    'existing_cta',
    'pacing',
    'risks',
  ],
};

const captionPosition = stringEnum(CAPTION_POSITIONS);

export const STAGE2_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    edit_thesis: {
      type: 'OBJECT',
      properties: {
        look: string,
        rhythm: string,
        motion_language: string,
        color_story: string,
        why: string,
      },
      required: ['look', 'rhythm', 'motion_language', 'color_story', 'why'],
    },
    cold_open: {
      type: 'OBJECT',
      properties: {
        use: boolean,
        source_start_word_id: string,
        source_end_word_id: string,
        how_it_returns: string,
      },
      required: ['use'],
    },
    caption_style: {
      type: 'OBJECT',
      properties: {
        template: stringEnum(CAPTION_TEMPLATES),
        position: captionPosition,
        text_color: string,
        highlight_color: string,
        box_color: string,
        animation: stringEnum(CAPTION_ANIMATIONS),
        font_scale: number,
        uppercase: boolean,
        emphasis_word_ids: {type: 'ARRAY', items: string},
        window_overrides: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              start_word_id: string,
              end_word_id: string,
              position: captionPosition,
              reason: string,
            },
            required: ['start_word_id', 'end_word_id', 'position', 'reason'],
          },
        },
      },
      required: ['template', 'position'],
    },
    lut: {
      type: 'OBJECT',
      properties: {
        preferred_id: string,
        suggested_ids: {type: 'ARRAY', items: string},
      },
    },
    elements: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: string,
          beat_id: string,
          intent: string,
          kind: stringEnum(ELEMENT_KINDS),
          start_word_id: string,
          end_word_id: string,
          pre_roll_ms: integer,
          post_roll_ms: integer,
          slot_id: string,
          z_index: integer,
          enter: stringEnum(ENTER_ANIMS),
          exit: stringEnum(EXIT_ANIMS),
          easing: stringEnum(EASINGS),
          text: string,
          accent_color: string,
          text_color: string,
          asset: {
            type: 'OBJECT',
            properties: {
              user_asset_id: {type: 'STRING' as const, maxLength: ASSET_ID_MAX_LENGTH},
              queries: {type: 'ARRAY', items: string},
            },
          },
          params: {
            type: 'OBJECT',
            properties: {
              treatment: stringEnum(OVERLAY_TREATMENTS),
              shape: stringEnum(MOTION_SHAPES),
              font_scale: number,
              italic: boolean,
              count_from: number,
              count_to: number,
              count_suffix: string,
              zoom_scale: number,
              container_mode: stringEnum(MEDIA_CONTAINER_MODES),
              canvas_color: string,
              margin_color: string,
              corner_radius: number,
              transition_style: string,
              transition_sec: number,
              scale: number,
              speaker_side: stringEnum(['top', 'bottom']),
              glow: boolean,
              direction: stringEnum(['up', 'down']),
              opacity: number,
              duration: number,
              exit: boolean,
              fit: stringEnum(['fit', 'fill']),
              feather: number,
              variant: stringEnum(['simple', 'motion_graphic']),
              inset_scale: number,
              background_type: stringEnum(['solid', 'gradient', 'loop', 'template']),
              background_value: string,
              graphic_template_id: string,
              graphic_text: string,
              enter_offset: number,
              exit_offset: number,
              captions: boolean,
              shadow: boolean,
            },
          },
        },
        required: ['id', 'beat_id', 'intent', 'kind', 'start_word_id', 'end_word_id'],
      },
    },
    sound: {
      type: 'OBJECT',
      properties: {
        music: {
          type: 'OBJECT',
          properties: {
            mood: string,
            energy_curve: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  at_word_id: string,
                  level: integer,
                },
                required: ['at_word_id', 'level'],
              },
            },
            duck_under_speech_db: number,
          },
        },
        sfx: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: string,
              at_word_id: string,
              type: stringEnum(SFX_TYPES),
              intent: string,
            },
            required: ['id', 'at_word_id', 'type', 'intent'],
          },
        },
      },
    },
    cta: {
      type: 'OBJECT',
      properties: {
        start_word_id: string,
        end_word_id: string,
        keyword: string,
        on_screen_prompt_element_id: string,
        dm_reply_draft: string,
        follow_up_draft: string,
        suggested: boolean,
        suggested_spoken_line: string,
      },
      required: ['start_word_id', 'end_word_id', 'keyword', 'suggested'],
    },
    self_review: {
      type: 'OBJECT',
      properties: {
        strongest_choice: string,
        riskiest_choice: string,
        what_i_would_cut_if_too_busy: {type: 'ARRAY', items: string},
      },
    },
  },
  required: ['edit_thesis', 'cold_open', 'caption_style', 'elements', 'cta'],
};

export function stage2SchemaForAssetIds(assetIds: string[]) {
  const schema = structuredClone(STAGE2_RESPONSE_SCHEMA);
  const legal = [...new Set(assetIds.filter(id => parseLegalAssetId(id).status === 'legal'))];
  const field: {type: 'STRING'; maxLength: number; enum?: string[]} =
    legal.length > 0
      ? {type: 'STRING', maxLength: ASSET_ID_MAX_LENGTH, enum: legal}
      : {type: 'STRING', maxLength: ASSET_ID_MAX_LENGTH};
  schema.properties.elements.items.properties.asset.properties.user_asset_id =
    field as typeof schema.properties.elements.items.properties.asset.properties.user_asset_id;
  return schema;
}
