# eian-riso-broll (vendored at runtime into vendor/eian-riso-broll/, gitignored)

- Source: https://github.com/YIAN6557/eian-riso-broll
- Owner authorization (2026-10-30, remotion/out/phase36-readiness/AUTHORIZATION_WP53.txt): this repository is the FinalPost owner's own. Integrating, modifying and using its render code inside FinalPost is authorized; the upstream non-commercial licence text is not treated as a blocker. It is NOT to be redistributed as a standalone public package.
- Third-party parts keep their own licences (see vendor/eian-riso-broll/THIRD_PARTY_NOTICES.md): GSAP, and the SIL OFL fonts under assets/fonts.
- Only FinalPost's adapter (server/src/stages/broll/visualBackend/risoAdapter.ts) is committed. Install with scripts/vendor-eian-riso.sh or point EIAN_RISO_ROOT at a checkout.
- No API keys are stored here or in the adapter.

# gbro-collage-broll (vendor/gbro-collage-broll/, gitignored)

- Source: https://github.com/pyang5166/gbro-collage-broll (MIT). Install with scripts/vendor-gbro-collage.sh or set COLLAGE_BROLL_ROOT.
- VOX-COLLAGE-BROLL (MaxFusion / ElevenLabs) was audited and rejected; anidoodle (Apache-2.0) is spawned from ANIDOODLE_ENGINE_ROOT and never vendored.
