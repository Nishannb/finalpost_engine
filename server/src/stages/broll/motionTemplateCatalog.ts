/**
 * Layer 2 — Motion-template primitives catalog (CLIP_01..26 native toolkit + WP53 CLIP_27..34 visual-backend rows).
 * Grammar: remotion/out/phase36-readiness/motion-template-primitives.yaml
 * NOT a new skill lane. Skills (A/B/C/D) declare allowlists; the planner picks sparse beats.
 * Remotion comps publish via library (WP45: 01–04 · WP46: 05–08 · WP47: 09–12 · WP48: 13–16 · WP50: 17–21 · WP51 Batch B: 22–26).
 */

export const MOTION_TEMPLATE_PRIMITIVES = [
  // WP45 batch
  'tile_wipe_grow',
  'tile_merge_expand',
  'color_flood_swap',
  'window_reveal',
  'slot_carousel_advance',
  'panel_accordion_expand',
  'camera_creep',
  'camera_jump_cut',
  'camera_ease_zoom',
  'card_stack_advance',
  // WP46 batch
  'hard_cut_on_grid',
  'mask_morph',
  'sticker_pop',
  'blur_carousel',
  'nested_rect_wipe',
  'typewriter_reveal',
  // WP47 batch (Part 2 ACME)
  'letter_swap',
  'color_field_cut',
  'font_morph',
  'vertical_stretch',
  'slide_carousel',
  'inset_to_fullbleed',
  'line_mask_reveal',
  'microtext_frame',
  // WP48 batch (layout C1–C4)
  'hard_cut_fullbleed',
  'scale_thumb_expand',
  'corner_marker_converge',
  'text_marquee_y',
  'blank_beat_white',
  'glass_card_morph',
  'vertical_push',
  'text_behind_subject',
  // WP50 batch (Part 4 capture clips 13–17 → engine CLIP_17–21)
  'stack_collapse_y',
  'mask_reveal_y',
  'slide_apart_x',
  'black_frame_reset',
  'slit_reveal',
  'typewriter_with_caret',
  'tone_on_tone_3d',
  // WP51 batch (Batch B screen-recording templates → engine CLIP_22–26)
  'typing_indicator',
  'word_rise_reveal',
  'letter_typing_tracking',
  'word_wheel',
  'hard_color_cut',
  'masked_slide_up',
  'blur_rotate_in',
  'icon_dock',
  'glass_pill',
  // WP54 batch (kinetic type / brand / product / ambient)
  'word_stagger_reveal',
  'line_mask_rise',
  'char_stagger_fade',
  'weight_axis_morph',
  'logo_mask_open',
  'mesh_field_drift',
  'device_frame_rise',
  'cursor_glide_click',
  'strike_and_count',
  'still_push_in',
  'stroke_draw_on',
  // WP55 batch (KINETIC_TYPE_STORYTELLING, overlay on footage)
  'environmental_type_behind_subject',
  'impact_number_pop',
  'directional_word_stagger',
  'split_scale_color_headline',
  'word_pop_beside_subject',
  'layered_line_stack',
  'floating_depth_icons',
  'logo_chip_reveal',
  'kinetic_cta_stack',
  'drawn_accent_emphasis',
  'text_match_cut',
] as const;

export type MotionTemplatePrimitiveId = (typeof MOTION_TEMPLATE_PRIMITIVES)[number];

export const MOTION_TEMPLATE_IDS = [
  'clip_01_grid_morph',
  'clip_02_slit_carousel',
  'clip_03_bento_camera',
  'clip_04_stacked_cards',
  'clip_05_config_brand_loop',
  'clip_06_blur_word_carousel',
  'clip_07_ios_notification',
  'clip_08_nested_rect_title',
  'clip_09_acme_fruit_swap',
  'clip_10_morph_stretch',
  'clip_11_menu_slide',
  'clip_12_editorial_inset',
  'clip_13_heritage_poster',
  'clip_14_silk_legacy',
  'clip_15_glass_testimonial',
  'clip_16_portrait_push',
  'clip_17_photo_stack_collapse',
  'clip_18_photo_stack_reveal',
  'clip_19_two_up_stack',
  'clip_20_never_done_slit',
  'clip_21_typewriter',
  'clip_22_chat_conversation',
  'clip_23_sale_promo',
  'clip_24_color_word_wheel',
  'clip_25_tracking_collapse',
  'clip_26_spatial_blur_tilt',
  // WP53 visual-backend rows (HOW, not WHY): flag-gated, planned by planVisualBackendBeats only
  'clip_27_riso_number',
  'clip_28_riso_versus',
  'clip_29_riso_compare',
  'clip_30_riso_converge',
  'clip_31_riso_quote',
  'clip_32_riso_chapter',
  'clip_33_collage_assemble',
  'clip_34_doodle_explain',
  // WP54 native rows (planned by planCraftTemplateBeats only; flag POLISH_MOTION_TEMPLATES)
  'clip_35_type_word_reveal',
  'clip_36_type_line_mask',
  'clip_37_type_char_stagger',
  'clip_38_type_weight_morph',
  'clip_39_logo_reveal',
  'clip_40_mesh_gradient_ground',
  'clip_41_product_device_frame',
  'clip_42_product_cursor_click',
  'clip_43_promo_price_drop',
  'clip_44_photo_ken_burns',
  // WP55 KINETIC_TYPE_STORYTELLING family (toolkit kinetic_text; overlays, never mute captions; planned by planCraftTemplateBeats)
  'clip_45_type_environmental_hero',
  'clip_46_type_impact_number',
  'clip_47_type_staggered_phrase',
  'clip_48_type_split_color_headline',
  'clip_49_type_kinetic_word_pop',
  'clip_50_type_stacked_statement',
  'clip_51_type_floating_social_proof',
  'clip_52_type_logo_reveal',
  'clip_53_type_kinetic_cta',
  'clip_54_type_illustrated_emphasis',
  // Text match cut (kinetic_text; full-frame hard-cut montage around ONE persistent keyword box)
  'clip_55_type_text_match_cut',
] as const;

export type MotionTemplateId = (typeof MOTION_TEMPLATE_IDS)[number];

export type MotionTemplateSkill = 'faceless' | 'explainer' | 'textual_mg' | 'newsroom_mg' | 'default';

export type MotionTemplateCompositionId =
  | 'GridMosaicMorph'
  | 'SlitPanelCarousel'
  | 'BentoCardWall'
  | 'StackedCardDeck'
  | 'ConfigBrandLoop'
  | 'BlurWordCarousel'
  | 'IosNotificationMock'
  | 'NestedRectTitleWipe'
  | 'AcmeFruitLetterSwap'
  | 'MorphFontStretch'
  | 'MenuSlidePoster'
  | 'EditorialInsetPoster'
  | 'HeritageDevotionPoster'
  | 'SilkLegacyCover'
  | 'GlassTestimonialMorph'
  | 'PortraitPushCarousel'
  | 'PhotoStackCollapse'
  | 'PhotoStackReveal'
  | 'TwoUpStackHold'
  | 'NeverDoneSlitPoster'
  | 'TypewriterPoster'
  | 'ChatConversationBubbles'
  | 'SalePromoCountdown'
  | 'ColorWordWheel'
  | 'TrackingCollapseHeadline'
  | 'SpatialBlurTiltReveal'
  // WP53: backend "compositions" (no Remotion comp; the render is an external mp4 or a native fallback)
  | 'RisoBackend'
  | 'CollageGbroBackend'
  | 'AnidoodleBackend'
  // WP54 native comps
  | 'WordRevealType'
  | 'LineMaskReveal'
  | 'CharStaggerType'
  | 'WeightMorphType'
  | 'LogoReveal'
  | 'MeshGradientGround'
  | 'ProductDeviceFrame'
  | 'ProductCursorClick'
  | 'PromoPriceDrop'
  | 'PhotoKenBurns'
  // WP55 native comps
  | 'TypeEnvironmentalHero'
  | 'TypeImpactNumber'
  | 'TypeStaggeredPhrase'
  | 'TypeSplitColorHeadline'
  | 'TypeKineticWordPop'
  | 'TypeStackedStatement'
  | 'TypeFloatingSocialProof'
  | 'TypeLogoReveal'
  | 'TypeKineticCta'
  | 'TypeIllustratedEmphasis'
  | 'TypeTextMatchCut';

export type MotionTemplateIntent =
  | 'hook'
  | 'evidence'
  | 'brand_lockup'
  | 'list'
  | 'media'
  | 'payoff'
  | 'product'
  | 'diagram_beat'
  | 'logo_grid'
  | 'claim_visual'
  | 'chapter_card'
  | 'document_wall'
  | 'gallery_beat'
  | 'product_lockup_behind_type'
  | 'brand_loop'
  | 'kinetic_list'
  | 'ui_notification'
  | 'title_reveal'
  | 'letter_lockup'
  | 'type_morph'
  | 'menu_board'
  | 'editorial_poster'
  | 'heritage_poster'
  | 'magazine_cover'
  | 'glass_testimonial'
  | 'portrait_push'
  | 'photo_stack'
  | 'statement_slit'
  | 'event_typewriter'
  | 'chat_conversation'
  | 'sale_promo'
  | 'color_wheel'
  | 'tracking_headline'
  | 'spatial_reveal'
  // WP53 visual-backend intents
  | 'stat'
  | 'big_number'
  | 'myth_fact'
  | 'before_after'
  | 'many_to_few'
  | 'speaker_conclusion'
  | 'chapter'
  | 'visual_metaphor'
  | 'illustrated_explain'
  // WP54 intents
  | 'emphatic_type'
  | 'line_type'
  | 'char_type'
  | 'weight_type'
  | 'logo_reveal'
  | 'ambient_ground'
  | 'product_device'
  | 'product_click'
  | 'promo_price'
  | 'photo_motion'
  // WP55 intents
  | 'environmental_hero'
  | 'impact_number'
  | 'staggered_phrase'
  | 'split_headline'
  | 'word_pop'
  | 'stacked_statement'
  | 'social_proof'
  | 'logo_title'
  | 'kinetic_cta'
  | 'illustrated_emphasis'
  | 'text_match_cut';

export type MotionTemplateSpec = {
  id: MotionTemplateId;
  compositionId: MotionTemplateCompositionId;
  primitives: readonly MotionTemplatePrimitiveId[];
  intents: readonly MotionTemplateIntent[];
  durationSec: number;
  aspect: '4:5' | '9:16' | '4:3' | '1:1' | '16:9' | '16:10';
  loop?: boolean;
  /** Opaque full-bleed → mute captions while on screen. Overlay mocks (notification) = false. */
  ownsFrame: boolean;
  /** Library placement: full_screen (default) or overlay for UI mocks. */
  placement?: 'full_screen' | 'overlay';
  /** WP53: visual backend that renders this row (absent = native Remotion comp). Such rows are never picked by planMotionTemplateBeats. */
  backend?: 'riso' | 'collage_gbro' | 'anidoodle';
  /** WP53: the EXISTING edit toolkit the beat belongs to (WHY). Never a new toolkit id. */
  toolkit?: 'cutaway' | 'counter' | 'kinetic_text' | 'card' | 'emphasis' | 'zoom' | 'lockup';
  /** WP54: native row planned only by planCraftTemplateBeats (never by planMotionTemplateBeats / planVisualBackendBeats). */
  lane?: 'wp54' | 'wp55' | 'match_cut';
  /** WP54: row is gated (planner returns 0 beats unless its gate passes). WP55: `brand` = needs a creator logo or brand name, `social_assets` = needs creator-provided stills / a grounded figure. */
  gated?: 'product' | 'logo' | 'brand' | 'social_assets';
};

export const MOTION_TEMPLATE_CATALOG: readonly MotionTemplateSpec[] = [
  {
    id: 'clip_01_grid_morph',
    compositionId: 'GridMosaicMorph',
    primitives: ['tile_wipe_grow', 'tile_merge_expand', 'color_flood_swap', 'window_reveal'],
    intents: ['hook', 'evidence', 'brand_lockup', 'chapter_card', 'claim_visual'],
    durationSec: 4.9,
    aspect: '4:5',
    ownsFrame: true,
  },
  {
    id: 'clip_02_slit_carousel',
    compositionId: 'SlitPanelCarousel',
    primitives: ['slot_carousel_advance', 'panel_accordion_expand', 'window_reveal'],
    intents: ['evidence', 'list', 'media', 'gallery_beat', 'diagram_beat', 'logo_grid'],
    durationSec: 6.97,
    aspect: '4:3',
    loop: true,
    ownsFrame: true,
  },
  {
    id: 'clip_03_bento_camera',
    compositionId: 'BentoCardWall',
    primitives: ['camera_creep', 'camera_jump_cut', 'camera_ease_zoom'],
    intents: ['evidence', 'payoff', 'media', 'document_wall', 'diagram_beat'],
    durationSec: 5.87,
    aspect: '4:3',
    ownsFrame: true,
  },
  {
    id: 'clip_04_stacked_cards',
    compositionId: 'StackedCardDeck',
    primitives: ['card_stack_advance'],
    intents: ['media', 'product', 'list', 'product_lockup_behind_type', 'logo_grid'],
    durationSec: 2.32,
    aspect: '1:1',
    ownsFrame: true,
  },
  {
    id: 'clip_05_config_brand_loop',
    compositionId: 'ConfigBrandLoop',
    primitives: ['hard_cut_on_grid', 'mask_morph', 'sticker_pop'],
    intents: ['brand_loop', 'brand_lockup', 'hook', 'media', 'chapter_card'],
    durationSec: 7.63,
    aspect: '4:5',
    loop: true,
    ownsFrame: true,
  },
  {
    id: 'clip_06_blur_word_carousel',
    compositionId: 'BlurWordCarousel',
    primitives: ['blur_carousel'],
    intents: ['kinetic_list', 'list', 'hook', 'payoff'],
    durationSec: 3.67,
    aspect: '16:9',
    ownsFrame: true,
  },
  {
    id: 'clip_07_ios_notification',
    compositionId: 'IosNotificationMock',
    primitives: [],
    intents: ['ui_notification', 'claim_visual'],
    durationSec: 2.02,
    aspect: '16:9',
    ownsFrame: false,
    placement: 'overlay',
  },
  {
    id: 'clip_08_nested_rect_title',
    compositionId: 'NestedRectTitleWipe',
    primitives: ['nested_rect_wipe', 'typewriter_reveal'],
    intents: ['title_reveal', 'payoff', 'hook', 'brand_lockup', 'chapter_card'],
    durationSec: 6.15,
    aspect: '16:9',
    ownsFrame: true,
  },
  {
    id: 'clip_09_acme_fruit_swap',
    compositionId: 'AcmeFruitLetterSwap',
    primitives: ['letter_swap', 'color_field_cut'],
    intents: ['letter_lockup', 'brand_lockup', 'hook', 'brand_loop'],
    durationSec: 3.83,
    aspect: '4:5',
    loop: true,
    ownsFrame: true,
  },
  {
    id: 'clip_10_morph_stretch',
    compositionId: 'MorphFontStretch',
    primitives: ['font_morph', 'vertical_stretch'],
    intents: ['type_morph', 'kinetic_list', 'hook', 'payoff'],
    durationSec: 2.3,
    aspect: '16:10',
    loop: true,
    ownsFrame: true,
  },
  {
    id: 'clip_11_menu_slide',
    compositionId: 'MenuSlidePoster',
    primitives: ['slide_carousel', 'microtext_frame'],
    intents: ['menu_board', 'product', 'media', 'gallery_beat'],
    durationSec: 6.8,
    aspect: '1:1',
    loop: true,
    ownsFrame: true,
  },
  {
    id: 'clip_12_editorial_inset',
    compositionId: 'EditorialInsetPoster',
    primitives: ['inset_to_fullbleed', 'line_mask_reveal', 'microtext_frame'],
    intents: ['editorial_poster', 'product', 'title_reveal', 'payoff', 'brand_lockup'],
    durationSec: 5.3,
    aspect: '4:5',
    loop: true,
    ownsFrame: true,
  },
  {
    id: 'clip_13_heritage_poster',
    compositionId: 'HeritageDevotionPoster',
    primitives: ['hard_cut_fullbleed', 'scale_thumb_expand', 'line_mask_reveal', 'corner_marker_converge', 'text_marquee_y', 'microtext_frame'],
    intents: ['heritage_poster', 'editorial_poster', 'title_reveal', 'payoff', 'brand_lockup'],
    durationSec: 6.9,
    aspect: '4:5',
    loop: true,
    ownsFrame: true,
  },
  {
    id: 'clip_14_silk_legacy',
    compositionId: 'SilkLegacyCover',
    primitives: ['scale_thumb_expand', 'hard_cut_fullbleed', 'blank_beat_white', 'line_mask_reveal', 'text_behind_subject', 'microtext_frame'],
    intents: ['magazine_cover', 'editorial_poster', 'title_reveal', 'brand_lockup', 'payoff'],
    durationSec: 3.05,
    aspect: '4:5',
    loop: true,
    ownsFrame: true,
  },
  {
    id: 'clip_15_glass_testimonial',
    compositionId: 'GlassTestimonialMorph',
    primitives: ['glass_card_morph'],
    intents: ['glass_testimonial', 'claim_visual', 'product', 'evidence'],
    durationSec: 3.93,
    aspect: '16:10',
    loop: true,
    ownsFrame: true,
  },
  {
    id: 'clip_16_portrait_push',
    compositionId: 'PortraitPushCarousel',
    primitives: ['vertical_push'],
    intents: ['portrait_push', 'gallery_beat', 'media', 'evidence'],
    durationSec: 4.35,
    aspect: '4:5',
    loop: true,
    ownsFrame: true,
  },
  // WP50 — Part 4 capture clips 13–17 (engine ids CLIP_17–21; do not confuse with WP48 CLIP_13–16)
  {
    id: 'clip_17_photo_stack_collapse',
    compositionId: 'PhotoStackCollapse',
    primitives: ['stack_collapse_y'],
    intents: ['photo_stack', 'gallery_beat', 'product', 'media'],
    durationSec: 1.37,
    aspect: '9:16',
    loop: true,
    ownsFrame: true,
  },
  {
    id: 'clip_18_photo_stack_reveal',
    compositionId: 'PhotoStackReveal',
    primitives: ['blank_beat_white', 'mask_reveal_y'],
    intents: ['photo_stack', 'gallery_beat', 'evidence', 'media'],
    durationSec: 2.42,
    aspect: '9:16',
    loop: false,
    ownsFrame: true,
  },
  {
    id: 'clip_19_two_up_stack',
    compositionId: 'TwoUpStackHold',
    primitives: ['slide_apart_x'],
    intents: ['photo_stack', 'product', 'gallery_beat', 'media'],
    // Capture was 0.48 s static; catalog hold is 2.0 s so polish beats are usable.
    durationSec: 2.0,
    aspect: '9:16',
    loop: false,
    ownsFrame: true,
  },
  {
    id: 'clip_20_never_done_slit',
    compositionId: 'NeverDoneSlitPoster',
    primitives: ['black_frame_reset', 'line_mask_reveal', 'slit_reveal'],
    intents: ['statement_slit', 'title_reveal', 'brand_lockup', 'payoff'],
    durationSec: 2.38,
    aspect: '4:5',
    loop: false,
    ownsFrame: true,
  },
  {
    id: 'clip_21_typewriter',
    compositionId: 'TypewriterPoster',
    primitives: ['typewriter_with_caret', 'tone_on_tone_3d'],
    intents: ['event_typewriter', 'title_reveal', 'brand_loop', 'hook'],
    durationSec: 5.03,
    aspect: '9:16',
    loop: false,
    ownsFrame: true,
  },
  // WP51 — Batch B capture templates (engine CLIP_22–26)
  {
    id: 'clip_22_chat_conversation',
    compositionId: 'ChatConversationBubbles',
    primitives: ['typing_indicator', 'word_rise_reveal'],
    intents: ['chat_conversation', 'ui_notification', 'list', 'hook'],
    durationSec: 10.25,
    aspect: '9:16',
    loop: true,
    ownsFrame: true,
  },
  {
    id: 'clip_23_sale_promo',
    compositionId: 'SalePromoCountdown',
    primitives: ['icon_dock', 'masked_slide_up', 'glass_pill'],
    intents: ['sale_promo', 'hook', 'payoff', 'product'],
    durationSec: 2.87,
    aspect: '4:5',
    loop: false,
    ownsFrame: true,
  },
  {
    id: 'clip_24_color_word_wheel',
    compositionId: 'ColorWordWheel',
    primitives: ['word_wheel', 'hard_color_cut'],
    intents: ['color_wheel', 'kinetic_list', 'brand_loop', 'product'],
    durationSec: 4.38,
    aspect: '1:1',
    loop: true,
    ownsFrame: true,
  },
  {
    id: 'clip_25_tracking_collapse',
    compositionId: 'TrackingCollapseHeadline',
    primitives: ['letter_typing_tracking'],
    intents: ['tracking_headline', 'title_reveal', 'hook', 'letter_lockup'],
    durationSec: 1.21,
    aspect: '1:1',
    loop: false,
    ownsFrame: true,
  },
  {
    id: 'clip_26_spatial_blur_tilt',
    compositionId: 'SpatialBlurTiltReveal',
    primitives: ['blur_rotate_in'],
    intents: ['spatial_reveal', 'title_reveal', 'hook', 'payoff'],
    durationSec: 1.61,
    aspect: '16:10',
    loop: false,
    ownsFrame: true,
  },
  {
    id: 'clip_27_riso_number',
    compositionId: 'RisoBackend',
    primitives: [],
    intents: ['stat', 'big_number'],
    durationSec: 5,
    aspect: '9:16',
    ownsFrame: true,
    backend: 'riso',
    toolkit: 'counter',
  },
  {
    id: 'clip_28_riso_versus',
    compositionId: 'RisoBackend',
    primitives: [],
    intents: ['myth_fact'],
    durationSec: 5,
    aspect: '9:16',
    ownsFrame: true,
    backend: 'riso',
    toolkit: 'emphasis',
  },
  {
    id: 'clip_29_riso_compare',
    compositionId: 'RisoBackend',
    primitives: [],
    intents: ['before_after'],
    durationSec: 5,
    aspect: '9:16',
    ownsFrame: true,
    backend: 'riso',
    toolkit: 'counter',
  },
  {
    id: 'clip_30_riso_converge',
    compositionId: 'RisoBackend',
    primitives: [],
    intents: ['many_to_few'],
    durationSec: 5,
    aspect: '9:16',
    ownsFrame: true,
    backend: 'riso',
    toolkit: 'kinetic_text',
  },
  {
    id: 'clip_31_riso_quote',
    compositionId: 'RisoBackend',
    primitives: [],
    intents: ['speaker_conclusion'],
    durationSec: 5,
    aspect: '9:16',
    ownsFrame: true,
    backend: 'riso',
    toolkit: 'kinetic_text',
  },
  {
    id: 'clip_32_riso_chapter',
    compositionId: 'RisoBackend',
    primitives: [],
    intents: ['chapter'],
    durationSec: 3,
    aspect: '9:16',
    ownsFrame: true,
    backend: 'riso',
    toolkit: 'kinetic_text',
  },
  {
    id: 'clip_33_collage_assemble',
    compositionId: 'CollageGbroBackend',
    primitives: [],
    intents: ['visual_metaphor'],
    durationSec: 5,
    aspect: '9:16',
    ownsFrame: true,
    backend: 'collage_gbro',
    toolkit: 'cutaway',
  },
  {
    id: 'clip_34_doodle_explain',
    compositionId: 'AnidoodleBackend',
    primitives: [],
    intents: ['illustrated_explain'],
    durationSec: 5,
    aspect: '9:16',
    ownsFrame: true,
    backend: 'anidoodle',
    toolkit: 'cutaway',
  },
  // WP54 native rows (clip_35..44): kinetic type / brand / ambient / gated ecommerce
  {id: 'clip_35_type_word_reveal', compositionId: 'WordRevealType', primitives: ['word_stagger_reveal'], intents: ['emphatic_type'], durationSec: 2.4, aspect: '9:16', ownsFrame: true, toolkit: 'kinetic_text', lane: 'wp54'},
  {id: 'clip_36_type_line_mask', compositionId: 'LineMaskReveal', primitives: ['line_mask_rise'], intents: ['line_type'], durationSec: 2.2, aspect: '9:16', ownsFrame: true, toolkit: 'kinetic_text', lane: 'wp54'},
  {id: 'clip_37_type_char_stagger', compositionId: 'CharStaggerType', primitives: ['char_stagger_fade'], intents: ['char_type'], durationSec: 2.0, aspect: '9:16', ownsFrame: true, toolkit: 'kinetic_text', lane: 'wp54'},
  {id: 'clip_38_type_weight_morph', compositionId: 'WeightMorphType', primitives: ['weight_axis_morph'], intents: ['weight_type'], durationSec: 2.4, aspect: '9:16', ownsFrame: true, toolkit: 'kinetic_text', lane: 'wp54'},
  {id: 'clip_39_logo_reveal', compositionId: 'LogoReveal', primitives: ['logo_mask_open'], intents: ['logo_reveal'], durationSec: 2.4, aspect: '9:16', ownsFrame: true, toolkit: 'lockup', lane: 'wp54', gated: 'logo'},
  {id: 'clip_40_mesh_gradient_ground', compositionId: 'MeshGradientGround', primitives: ['mesh_field_drift'], intents: ['ambient_ground'], durationSec: 4.0, aspect: '9:16', ownsFrame: false, placement: 'overlay', toolkit: 'card', lane: 'wp54'},
  {id: 'clip_41_product_device_frame', compositionId: 'ProductDeviceFrame', primitives: ['device_frame_rise'], intents: ['product_device'], durationSec: 3.4, aspect: '9:16', ownsFrame: true, toolkit: 'cutaway', lane: 'wp54', gated: 'product'},
  {id: 'clip_42_product_cursor_click', compositionId: 'ProductCursorClick', primitives: ['cursor_glide_click'], intents: ['product_click'], durationSec: 3.0, aspect: '9:16', ownsFrame: true, toolkit: 'cutaway', lane: 'wp54', gated: 'product'},
  {id: 'clip_43_promo_price_drop', compositionId: 'PromoPriceDrop', primitives: ['strike_and_count'], intents: ['promo_price'], durationSec: 3.0, aspect: '9:16', ownsFrame: true, toolkit: 'counter', lane: 'wp54', gated: 'product'},
  {id: 'clip_44_photo_ken_burns', compositionId: 'PhotoKenBurns', primitives: ['still_push_in'], intents: ['photo_motion'], durationSec: 3.2, aspect: '9:16', ownsFrame: true, toolkit: 'zoom', lane: 'wp54', gated: 'product'},
  // WP55 KINETIC_TYPE_STORYTELLING (clip_45..54): overlays on footage. ownsFrame:false => captions are NEVER muted; the planner keeps the type out of the caption band instead.
  {id: 'clip_45_type_environmental_hero', compositionId: 'TypeEnvironmentalHero', primitives: ['environmental_type_behind_subject'], intents: ['environmental_hero'], durationSec: 2.6, aspect: '9:16', ownsFrame: false, placement: 'overlay', toolkit: 'kinetic_text', lane: 'wp55'},
  {id: 'clip_46_type_impact_number', compositionId: 'TypeImpactNumber', primitives: ['impact_number_pop'], intents: ['impact_number'], durationSec: 2.6, aspect: '9:16', ownsFrame: false, placement: 'overlay', toolkit: 'kinetic_text', lane: 'wp55'},
  {id: 'clip_47_type_staggered_phrase', compositionId: 'TypeStaggeredPhrase', primitives: ['directional_word_stagger'], intents: ['staggered_phrase'], durationSec: 2.6, aspect: '9:16', ownsFrame: false, placement: 'overlay', toolkit: 'kinetic_text', lane: 'wp55'},
  {id: 'clip_48_type_split_color_headline', compositionId: 'TypeSplitColorHeadline', primitives: ['split_scale_color_headline'], intents: ['split_headline'], durationSec: 2.6, aspect: '9:16', ownsFrame: false, placement: 'overlay', toolkit: 'kinetic_text', lane: 'wp55'},
  {id: 'clip_49_type_kinetic_word_pop', compositionId: 'TypeKineticWordPop', primitives: ['word_pop_beside_subject'], intents: ['word_pop'], durationSec: 1.2, aspect: '9:16', ownsFrame: false, placement: 'overlay', toolkit: 'kinetic_text', lane: 'wp55'},
  {id: 'clip_50_type_stacked_statement', compositionId: 'TypeStackedStatement', primitives: ['layered_line_stack'], intents: ['stacked_statement'], durationSec: 3.2, aspect: '9:16', ownsFrame: false, placement: 'overlay', toolkit: 'kinetic_text', lane: 'wp55'},
  {id: 'clip_51_type_floating_social_proof', compositionId: 'TypeFloatingSocialProof', primitives: ['floating_depth_icons'], intents: ['social_proof'], durationSec: 3.6, aspect: '9:16', ownsFrame: false, placement: 'overlay', toolkit: 'kinetic_text', lane: 'wp55', gated: 'social_assets'},
  {id: 'clip_52_type_logo_reveal', compositionId: 'TypeLogoReveal', primitives: ['logo_chip_reveal'], intents: ['logo_title'], durationSec: 2.6, aspect: '9:16', ownsFrame: false, placement: 'overlay', toolkit: 'kinetic_text', lane: 'wp55', gated: 'brand'},
  {id: 'clip_53_type_kinetic_cta', compositionId: 'TypeKineticCta', primitives: ['kinetic_cta_stack'], intents: ['kinetic_cta'], durationSec: 3.0, aspect: '9:16', ownsFrame: false, placement: 'overlay', toolkit: 'kinetic_text', lane: 'wp55'},
  {id: 'clip_54_type_illustrated_emphasis', compositionId: 'TypeIllustratedEmphasis', primitives: ['drawn_accent_emphasis'], intents: ['illustrated_emphasis'], durationSec: 2.6, aspect: '9:16', ownsFrame: false, placement: 'overlay', toolkit: 'kinetic_text', lane: 'wp55'},
  // TEXT MATCH CUT (clip_55): opaque full-frame montage of hard cuts (0.16-0.23 s each); ONE spoken keyword stays pinned in a highlight box. Owns the frame, so captions are muted for its ~1.4 s.
  {id: 'clip_55_type_text_match_cut', compositionId: 'TypeTextMatchCut', primitives: ['text_match_cut'], intents: ['text_match_cut'], durationSec: 1.6, aspect: '9:16', ownsFrame: true, toolkit: 'kinetic_text', lane: 'match_cut'},
];

/** Which templates each skill may use (Layer 1 → Layer 2 gate). */
export const SKILL_MOTION_TEMPLATE_ALLOWLIST: Readonly<Record<MotionTemplateSkill, readonly MotionTemplateId[]>> = {
  faceless: [
    'clip_01_grid_morph',
    'clip_04_stacked_cards',
    'clip_03_bento_camera',
    'clip_05_config_brand_loop',
    'clip_08_nested_rect_title',
    'clip_09_acme_fruit_swap',
    'clip_12_editorial_inset',
    'clip_13_heritage_poster',
    'clip_14_silk_legacy',
    'clip_16_portrait_push',
    'clip_17_photo_stack_collapse',
    'clip_18_photo_stack_reveal',
    'clip_19_two_up_stack',
    'clip_20_never_done_slit',
    'clip_23_sale_promo',
    'clip_32_riso_chapter',
    'clip_33_collage_assemble',
    'clip_44_photo_ken_burns',
    'clip_46_type_impact_number',
    'clip_47_type_staggered_phrase',
    'clip_48_type_split_color_headline',
    'clip_50_type_stacked_statement',
    'clip_52_type_logo_reveal',
    'clip_53_type_kinetic_cta',
    'clip_54_type_illustrated_emphasis',
    'clip_55_type_text_match_cut',
  ],
  explainer: [
    'clip_02_slit_carousel',
    'clip_03_bento_camera',
    'clip_01_grid_morph',
    'clip_06_blur_word_carousel',
    'clip_07_ios_notification',
    'clip_08_nested_rect_title',
    'clip_10_morph_stretch',
    'clip_11_menu_slide',
    'clip_12_editorial_inset',
    'clip_13_heritage_poster',
    'clip_15_glass_testimonial',
    'clip_16_portrait_push',
    'clip_18_photo_stack_reveal',
    'clip_19_two_up_stack',
    'clip_20_never_done_slit',
    'clip_21_typewriter',
    'clip_22_chat_conversation',
    'clip_23_sale_promo',
    'clip_24_color_word_wheel',
    'clip_25_tracking_collapse',
    'clip_26_spatial_blur_tilt',
    'clip_27_riso_number',
    'clip_28_riso_versus',
    'clip_29_riso_compare',
    'clip_30_riso_converge',
    'clip_31_riso_quote',
    'clip_32_riso_chapter',
    'clip_33_collage_assemble',
    'clip_34_doodle_explain',
    'clip_35_type_word_reveal',
    'clip_36_type_line_mask',
    'clip_37_type_char_stagger',
    'clip_38_type_weight_morph',
    'clip_39_logo_reveal',
    'clip_40_mesh_gradient_ground',
    'clip_41_product_device_frame',
    'clip_42_product_cursor_click',
    'clip_43_promo_price_drop',
    'clip_44_photo_ken_burns',
    'clip_45_type_environmental_hero',
    'clip_46_type_impact_number',
    'clip_47_type_staggered_phrase',
    'clip_48_type_split_color_headline',
    'clip_49_type_kinetic_word_pop',
    'clip_50_type_stacked_statement',
    'clip_51_type_floating_social_proof',
    'clip_52_type_logo_reveal',
    'clip_53_type_kinetic_cta',
    'clip_54_type_illustrated_emphasis',
    'clip_55_type_text_match_cut',
  ],
  textual_mg: [
    'clip_04_stacked_cards',
    'clip_06_blur_word_carousel',
    'clip_09_acme_fruit_swap',
    'clip_10_morph_stretch',
    'clip_13_heritage_poster',
    'clip_14_silk_legacy',
    'clip_20_never_done_slit',
    'clip_21_typewriter',
    'clip_22_chat_conversation',
    'clip_24_color_word_wheel',
    'clip_25_tracking_collapse',
    'clip_26_spatial_blur_tilt',
    'clip_35_type_word_reveal',
    'clip_36_type_line_mask',
    'clip_37_type_char_stagger',
    'clip_38_type_weight_morph',
    'clip_40_mesh_gradient_ground',
  ],
  newsroom_mg: [
    'clip_03_bento_camera',
    'clip_04_stacked_cards',
    'clip_01_grid_morph',
    'clip_05_config_brand_loop',
    'clip_06_blur_word_carousel',
    'clip_07_ios_notification',
    'clip_08_nested_rect_title',
    'clip_09_acme_fruit_swap',
    'clip_10_morph_stretch',
    'clip_11_menu_slide',
    'clip_12_editorial_inset',
    'clip_14_silk_legacy',
    'clip_15_glass_testimonial',
    'clip_16_portrait_push',
    'clip_17_photo_stack_collapse',
    'clip_18_photo_stack_reveal',
    'clip_20_never_done_slit',
    'clip_23_sale_promo',
    'clip_25_tracking_collapse',
    'clip_27_riso_number',
    'clip_28_riso_versus',
    'clip_29_riso_compare',
    'clip_35_type_word_reveal',
    'clip_36_type_line_mask',
    'clip_46_type_impact_number',
    'clip_47_type_staggered_phrase',
    'clip_48_type_split_color_headline',
    'clip_50_type_stacked_statement',
    'clip_52_type_logo_reveal',
    'clip_54_type_illustrated_emphasis',
  ],
  default: [
    'clip_02_slit_carousel',
    'clip_04_stacked_cards',
    'clip_05_config_brand_loop',
    'clip_06_blur_word_carousel',
    'clip_07_ios_notification',
    'clip_08_nested_rect_title',
    'clip_09_acme_fruit_swap',
    'clip_10_morph_stretch',
    'clip_11_menu_slide',
    'clip_12_editorial_inset',
    'clip_13_heritage_poster',
    'clip_15_glass_testimonial',
    'clip_16_portrait_push',
    'clip_18_photo_stack_reveal',
    'clip_19_two_up_stack',
    'clip_20_never_done_slit',
    'clip_21_typewriter',
    'clip_22_chat_conversation',
    'clip_23_sale_promo',
    'clip_24_color_word_wheel',
    'clip_25_tracking_collapse',
    'clip_26_spatial_blur_tilt',
    'clip_27_riso_number',
    'clip_28_riso_versus',
    'clip_29_riso_compare',
    'clip_30_riso_converge',
    'clip_31_riso_quote',
    'clip_32_riso_chapter',
    'clip_33_collage_assemble',
    'clip_34_doodle_explain',
    'clip_35_type_word_reveal',
    'clip_36_type_line_mask',
    'clip_37_type_char_stagger',
    'clip_38_type_weight_morph',
    'clip_39_logo_reveal',
    'clip_40_mesh_gradient_ground',
    'clip_41_product_device_frame',
    'clip_42_product_cursor_click',
    'clip_43_promo_price_drop',
    'clip_44_photo_ken_burns',
    'clip_45_type_environmental_hero',
    'clip_46_type_impact_number',
    'clip_47_type_staggered_phrase',
    'clip_48_type_split_color_headline',
    'clip_49_type_kinetic_word_pop',
    'clip_50_type_stacked_statement',
    'clip_51_type_floating_social_proof',
    'clip_52_type_logo_reveal',
    'clip_53_type_kinetic_cta',
    'clip_54_type_illustrated_emphasis',
    'clip_55_type_text_match_cut',
  ],
};

export function motionTemplate(id: string): MotionTemplateSpec | undefined {
  return MOTION_TEMPLATE_CATALOG.find(row => row.id === id);
}

export function templatesAllowedFor(skill: MotionTemplateSkill): MotionTemplateSpec[] {
  const allow = new Set(SKILL_MOTION_TEMPLATE_ALLOWLIST[skill]);
  return MOTION_TEMPLATE_CATALOG.filter(row => allow.has(row.id));
}

export function templateForIntent(skill: MotionTemplateSkill, intent: MotionTemplateIntent): MotionTemplateSpec | null {
  const allowed = templatesAllowedFor(skill);
  return allowed.find(row => row.intents.includes(intent)) ?? allowed[0] ?? null;
}

const PRODUCT = /\b(product|app|iphone|phone|device|capsule|partnership|discover|launch|feature)\b/i;
const GALLERY = /\b(gallery|photos|images|lookbook|carousel|collection|stack)\b/i;
const GRID = /\b(grid|mosaic|palette|brand|logo|colors?)\b/i;
const WALL = /\b(wall|portfolio|bento|desktop|mobile|ui\/?ux|screens?)\b/i;
const EVIDENCE = /\b(proof|evidence|example|see|look|here|this)\b/i;
const TITLE = /\b(title|guideline|presentation|intro|chapter|version)\b/i;
const KINETIC = /\b(moments|memories|emotion|pulse|essence|motion|direction|blur)\b/i;
const NOTIFY = /\b(notify|notification|message|alert|ping|inbox)\b/i;
const LOOP = /\b(config|brand\s*loop|ship\s*it|event|festival)\b/i;
const LETTER = /\b(acme|wordmark|fruit|letter|logo\s*swap)\b/i;
const MORPH = /\b(morph|stretch|bubble|typeface|font)\b/i;
const MENU = /\b(menu|bacon|sandwich|bakery|grill|cheese|weekday)\b/i;
const EDITORIAL = /\b(skincare|heritage|elegance|editorial|fw25|paris|milan)\b/i;
const HERITAGE = /\b(heritage|devotion|elegance|where\s+\w+\s+meets)\b/i;
const SILK = /\b(legacy|silk|since\s*\d{4}|archive|generations?)\b/i;
const GLASS = /\b(testimonial|recommend|review|quote|mango|campaign)\b/i;
const PUSH = /\b(carousel|lookbook|portraits?|fashion\s+edit|scroll\s+push)\b/i;
const STACK = /\b(stack|two[\s-]?up|three[\s-]?up|photo\s+stack|still\s+life|product\s+shots?)\b/i;
const SLIT = /\b(never\s+done|statement|racing|crafted|slit|we\s+are)\b/i;
const LIVE = /\b(livestream|live\s*stream|july|save\s+your\s+spot|link\s+in\s+bio|event)\b/i;
const CHAT = /\b(chat|text\s+message|imessage|sms|whats\s*up|typing|conversation|dm)\b/i;
const SALE = /\b(sale|percent\s*off|%?\s*off|countdown|free\s+trial|offer\s+ends|promo)\b/i;
const WHEEL = /\b(color\s*wheel|paint[\s-]?chip|swatch|yellow|green|orange|purple|colourway|colorway)\b/i;
const TRACKING = /\b(hello\s+monday|goodbye\s+weekend|tracking|letter[\s-]?spacing|headline\s+collapse)\b/i;
const SPATIAL = /\b(spatial\s+audio|available\s+in|spatial|keynote)\b/i;

/**
 * WP52: list-like speech ("first X, second Y", "three things: A, B and C", "A, B, C and D") is a motion-template beat (blur carousel / slit carousel / stacked cards), never caption-clone chips. The live test2
 * burn had `beats:0` on clear enumerations because no keyword matched; this shape check supplies the `list` intent.
 */
const LIST_ORDINAL = /\b(first|second|third|fourth)\b/gi;
const LIST_COUNT_CUE = /\b(?:two|three|four|five|six|2|3|4|5|6)\s+(?:things|ways|steps|reasons|tools|tips|types|kinds|options|mistakes|ideas|rules)\b/i;
export function isListLikeText(text: string): boolean {
  if ((text.match(LIST_ORDINAL) ?? []).length >= 2) return true;
  if (LIST_COUNT_CUE.test(text)) return true;
  const commaItems = text.split(/\s*,\s*/).filter(part => part.trim().length > 0);
  return commaItems.length >= 3 && /,\s*(?:and|or)\s+\S/i.test(text) || (commaItems.length >= 4);
}

export type MotionTemplateWord = {text: string; start: number; end: number};

export type MotionTemplateBeat = {
  id: string;
  start: number;
  end: number;
  templateId: MotionTemplateId;
  compositionId: MotionTemplateSpec['compositionId'];
  intent: MotionTemplateIntent;
  muteCaptions: boolean;
  /** WP54: planner-chosen grounded payload (phrase / prices / target) the binder re-verifies against the spoken words. */
  hint?: Record<string, unknown>;
};

export type MotionTemplatePlan = {
  beats: MotionTemplateBeat[];
  captionMuteRanges: Array<{start: number; end: number}>;
  warnings: string[];
};

const MAX_PER_30S = 2;
const MIN_GAP_S = 4;
/**
 * WP49: graphic beat starts this many seconds BEFORE the triggering spoken word.
 * Fixes the live lag where VO finished the cue and the related template only then appeared.
 */
export const MOTION_TEMPLATE_SYNC_LEAD_SEC = 0.35;

function maxBeats(durationSec: number): number {
  return Math.max(0, Math.min(3, Math.floor(durationSec / 15) + (durationSec >= 8 ? 1 : 0)));
}

function intentAt(text: string): MotionTemplateIntent | null {
  if (NOTIFY.test(text)) return 'ui_notification';
  if (CHAT.test(text)) return 'chat_conversation';
  if (SALE.test(text)) return 'sale_promo';
  if (WHEEL.test(text)) return 'color_wheel';
  if (TRACKING.test(text)) return 'tracking_headline';
  if (SPATIAL.test(text)) return 'spatial_reveal';
  if (LIVE.test(text)) return 'event_typewriter';
  if (SLIT.test(text)) return 'statement_slit';
  if (STACK.test(text)) return 'photo_stack';
  if (GLASS.test(text)) return 'glass_testimonial';
  if (HERITAGE.test(text)) return 'heritage_poster';
  if (SILK.test(text)) return 'magazine_cover';
  if (PUSH.test(text)) return 'portrait_push';
  if (EDITORIAL.test(text)) return 'editorial_poster';
  if (MENU.test(text)) return 'menu_board';
  if (MORPH.test(text)) return 'type_morph';
  if (LETTER.test(text)) return 'letter_lockup';
  if (TITLE.test(text)) return 'title_reveal';
  if (KINETIC.test(text)) return 'kinetic_list';
  if (LOOP.test(text)) return 'brand_loop';
  if (PRODUCT.test(text)) return 'product';
  if (GALLERY.test(text)) return 'gallery_beat';
  if (WALL.test(text)) return 'document_wall';
  if (GRID.test(text)) return 'brand_lockup';
  if (EVIDENCE.test(text)) return 'evidence';
  return null;
}

/**
 * Sparse planner: pick 0–N template beats allowed for the active skill.
 * Pure. Does not publish graphics — analyze / motionDirector does.
 */
export function planMotionTemplateBeats(input: {
  skill: MotionTemplateSkill;
  durationSec: number;
  words: readonly MotionTemplateWord[];
  blockedRanges?: ReadonlyArray<{start: number; end: number}>;
  maxBeats?: number;
}): MotionTemplatePlan {
  const warnings: string[] = [];
  const durationSec = Math.max(0, input.durationSec);
  const cap = Math.min(input.maxBeats ?? maxBeats(durationSec), Math.max(1, Math.floor(durationSec / 12)), MAX_PER_30S + (durationSec > 45 ? 1 : 0));
  // WP53: visual-backend rows (clip_27+) are planned only by planVisualBackendBeats; the native planner never falls back onto them.
  const allowed = templatesAllowedFor(input.skill).filter(row => !row.backend && !row.lane);
  if (allowed.length === 0 || durationSec < 5) {
    warnings.push('polish_motion_templates:skipped:short_or_empty_allowlist');
    return {beats: [], captionMuteRanges: [], warnings};
  }

  const candidates: Array<{at: number; intent: MotionTemplateIntent; text: string}> = [];
  // Opening hook window
  if (input.words.length > 0 && input.words[0]!.start < 2.5) {
    candidates.push({at: Math.max(0.2, input.words[0]!.start), intent: 'hook', text: input.words.slice(0, 6).map(w => w.text).join(' ')});
  }
  for (let i = 0; i < input.words.length; i++) {
    const window = input.words
      .slice(i, Math.min(input.words.length, i + 5))
      .map(w => w.text)
      .join(' ');
    const intent = intentAt(window);
    if (!intent) continue;
    candidates.push({at: input.words[i]!.start, intent, text: window});
  }
  // WP52: enumerations get a `list` intent (sparse: one candidate per ~6 s of speech).
  let lastListAt = -Infinity;
  for (let i = 0; i < input.words.length; i++) {
    const at = input.words[i]!.start;
    if (at - lastListAt < 6) continue;
    const window = input.words.slice(i, Math.min(input.words.length, i + 16)).map(w => w.text).join(' ');
    if (!isListLikeText(window) || /^[,\s]*$/.test(window)) continue;
    candidates.push({at, intent: 'list', text: window});
    lastListAt = at;
  }

  // Prefer mid-edit evidence/product over a second hook
  const order: MotionTemplateIntent[] = [
    'ui_notification',
    'event_typewriter',
    'statement_slit',
    'photo_stack',
    'glass_testimonial',
    'heritage_poster',
    'magazine_cover',
    'portrait_push',
    'editorial_poster',
    'menu_board',
    'title_reveal',
    'type_morph',
    'letter_lockup',
    'product',
    'gallery_beat',
    'document_wall',
    'kinetic_list',
    'list',
    'brand_loop',
    'evidence',
    'brand_lockup',
    'diagram_beat',
    'hook',
  ];
  candidates.sort((a, b) => order.indexOf(a.intent) - order.indexOf(b.intent) || a.at - b.at);

  const beats: MotionTemplateBeat[] = [];
  const blocked = input.blockedRanges ?? [];
  for (const c of candidates) {
    if (beats.length >= cap) break;
    // WP45: prefer an intent-matching template this plan has not used yet (variety); no intent match -> any unused allowed template; all used -> the first match
    const unused = (row: MotionTemplateSpec) => !beats.some(b => b.templateId === row.id);
    // Prefer an unused intent match; if every match is already used, pick any unused allowlist template (variety) before repeating.
    const matching = allowed.filter(row => row.intents.includes(c.intent));
    const spec = matching.find(unused) ?? allowed.find(unused) ?? matching[0] ?? allowed[0];
    if (!spec) continue;
    // WP49 sync lead: open the beat early so the visual is on screen as the word lands (not seconds after).
    let start = Math.max(0, c.at - MOTION_TEMPLATE_SYNC_LEAD_SEC);
    // If hook intent but opening already has another graphic window, skip
    if (c.intent === 'hook' && beats.some(b => b.intent === 'hook')) continue;
    if (beats.some(b => Math.abs(b.start - start) < MIN_GAP_S)) continue;
    const prior = beats.filter(b => b.end > start - 0.05).sort((a, b) => b.end - a.end)[0];
    if (prior) start = Math.max(start, prior.end + MIN_GAP_S);
    const end = Math.min(durationSec, start + Math.min(spec.durationSec, 5.5));
    // a beat much shorter than the template would play it too compressed: needs >= 70 % of the (capped) template length
    if (end - start < Math.max(1.2, Math.min(spec.durationSec, 5.5) * 0.7)) continue;
    if (blocked.some(r => r.start < end && r.end > start)) continue;
    beats.push({
      id: `mt_${beats.length + 1}_${spec.id}`,
      start,
      end,
      templateId: spec.id,
      compositionId: spec.compositionId,
      intent: c.intent,
      muteCaptions: spec.ownsFrame,
    });
  }

  beats.sort((a, b) => a.start - b.start);
  const captionMuteRanges = beats.filter(b => b.muteCaptions).map(b => ({start: b.start, end: b.end}));
  warnings.push(`polish_motion_templates:beats:${beats.length}`);
  if (beats.length === 0) warnings.push('polish_motion_templates:no_triggers');
  return {beats, captionMuteRanges, warnings};
}

// ---------------------------------------------------------------------------- WP45: skill mapping + library brief (stage wiring)

/** The polish lane ids (resolvePolishSkill). Mirrored here so the catalog stays import-free of the pacing module. */
export type PolishLaneSkill = 'default' | 'faceless' | 'explainer' | 'newsroom_mg';

/**
 * Lane skill -> allowlist key. Faceless / explainer / newsroom_mg / default map to themselves: these templates are toolkit moves INSIDE the active lane, never a lane of their own.
 * `textual_mg` (Skill C) is only ever used when a caller passes `skill: 'textual_mg'` explicitly; it is not a lane and is never returned here.
 */
export function mapPolishSkillToMotionTemplateSkill(skill: PolishLaneSkill): MotionTemplateSkill {
  switch (skill) {
    case 'faceless':
      return 'faceless';
    case 'explainer':
      return 'explainer';
    case 'newsroom_mg':
      return 'newsroom_mg';
    default:
      return 'default';
  }
}

/** Graphic id prefix: lets later stages (SFX, scoring) tell a motion-template beat from any other graphic. */
export const MOTION_TEMPLATE_GRAPHIC_ID_PREFIX = 'motion_template_';

/** The library brief for one planned beat (the registry resolves it with no model call). Overlay mocks keep captions; full-screen owns the frame. */
export function motionTemplateBrief(
  beat: MotionTemplateBeat,
  index: number,
  options: {
    accent?: string;
    ground?: string;
    ink?: string;
    idPrefix?: string;
    /** WP48: video-bound copy/assets from bindMotionTemplateContent (required for live polish). */
    content?: Record<string, unknown>;
    assets?: Array<{id: string; type: 'image' | 'video' | 'lottie' | 'audio'; url: string; label?: string}>;
  } = {},
) {
  const spec = motionTemplate(beat.templateId);
  const placement = spec?.placement === 'overlay' ? ('overlay' as const) : ('full_screen' as const);
  const hex = (value?: string) => (value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined);
  const accent = hex(options.accent);
  const ground = hex(options.ground);
  const ink = hex(options.ink);
  const bound = options.content ?? {};
  return {
    id: `${options.idPrefix ?? MOTION_TEMPLATE_GRAPHIC_ID_PREFIX}${index + 1}`,
    goal: `Layer-2 motion template (${beat.templateId}) for the ${beat.intent} beat`,
    visualDescription: `${spec?.compositionId ?? beat.compositionId}: ${(spec?.primitives ?? []).join(', ') || 'ui mock'}; silent, no fades, hard cuts / mask / wipe / typewriter; edit-palette accent`,
    placement,
    durationSeconds: Math.max(0.5, Math.min(60, beat.end - beat.start)),
    content: {
      motionTemplateId: beat.templateId,
      intent: beat.intent,
      ...bound,
      ...(accent ? {accent} : {}),
      ...(ground ? {ground} : {}),
      ...(ink ? {ink} : {}),
    },
    ...(options.assets && options.assets.length > 0 ? {assets: options.assets} : {}),
  };
}
