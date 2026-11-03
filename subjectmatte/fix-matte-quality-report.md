# Matte quality fix (black fringe + sealed arm–torso gaps)

## Root causes

1. **Black thick rim** — RVM soft-edge `fgr` is contaminated with dark background. Ceiling soft alpha to 1 locked that sludge in. Fix: decontaminate colour from bright eroded solid samples **before** alpha shaping, soften crust next to newly opened holes, contract/erode the outer silhouette.
2. **Sealed limb gaps** — RVM paints chair/wall in the arm–torso wedge as opaque. Global “bg-preferring” floods ate hair/shirt because room tones overlap hair and the person palette was polluted by near-black fringe / false-fg. Fix: clear only inside **convexity defects** + **warm-brown near person** corridors (and enclosed synthetic holes), with a clean person palette from the eroded opaque core.

## Changes

`subjectmatte/human_matting/processing/alpha_refinement.py`

- Defect-constrained + near-person warm pocket clearing (2 passes)
- Hole-edge alpha soften so rim decontam can run
- Stronger edge colour extend + 2px silhouette erode
- Unit tests: `human_matting/tests/test_alpha_refinement.py` (5/5)

## Validation

- Live frames t=2/8/14: face/nose/shirt alpha stay 1.0 (eroded-core protection); arm–torso gap box ~35–45% transparent (was ~4%); cent chair sample clears to 0.
- White soft-band p5 luminance improved (~142 → ~200+).
- Unit tests: 5/5.
- Regenerated `/tmp/subject-stage-proof/hi-matte-0-20.webm` for Subject Stage proof.
