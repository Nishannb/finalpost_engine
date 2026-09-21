Video duration (output timeline): {{OUTPUT_DURATION_SEC}} seconds
Language: {{LANGUAGE}}

STORY ANALYSIS (from Stage 1):
{{STAGE1_JSON}}

CREATOR PROFILE:
{{CREATOR_PROFILE_OR_"none. Design freely."}}

TRANSCRIPT (word IDs with output-time [start-end]):
{{WORD_ID_TRANSCRIPT}}

STORYBOARD (attached images, each labeled with its timestamp):
{{FRAME_LABELS + IMAGES}}

OCCUPANCY (per time slice, every ~0.5s): speaker box, face box, LEGAL_SLOTS with ids, CAPTION_BAND:
{{OCCUPANCY_SLICES}}

SPEAKER_CUTOUT: {{available | not available, plus keying info}}

SUBJECT_MASK (required for depth_overlay): {{SUBJECT_MASK}}

SPEAKER_VISIBLE_RANGES (centered, not too tight — only use depth_overlay inside these):
{{SPEAKER_VISIBLE_RANGES}}

USER_ASSETS (use where they fit; each id at most once):
{{ASSET_LIST_WITH_DESCRIPTIONS_AND_TEXT_REGIONS}}

AVAILABLE_LUTS (choose only from these ids):
{{LUT_LIST}}

INSET_REVEAL GRAPHIC TEMPLATES (for variant=motion_graphic):
{{INSET_REVEAL_GRAPHIC_TEMPLATES}}

THEME COLORS (prefer these for inset_reveal backgrounds):
{{THEME_COLORS}}

{{ALLOWED_EDIT_STYLES}}

RENDERER CAPABILITIES:
{{LIST_OF_SUPPORTED_KINDS_AND_PARAMS_GENERATED_FROM_CODE}}

{{REPAIR_BLOCK_IF_ANY}}

Design the best possible edit for this video.
