# North Star vs v1 flash director

Same clip, same `--edits`, same user B-roll. Only change: `--north-star` (Director v2 + storyboard frames + critic).

| | v1 flash (saveintrust) | North Star |
| --- | --- | --- |
| Command extras | none | `--north-star` |
| Blueprint | `bp_8dfb8c10881e4ab58e2b` | `bp_95929f02ab0d4675ab30` |
| Output | [v1 render](https://media-kinmel.namantechnologies.biz/ai-video/render/2026-09-20/first_bp_8dfb8c10881e4ab58e2b.mp4) | [north-star render](https://media-kinmel.namantechnologies.biz/ai-video/render/2026-09-20/first_bp_95929f02ab0d4675ab30.mp4) |
| Model | `gemini-3.6-flash` transcript-only | same flash model, but **8 storyboard stills** + two stages |
| Cost | ~$0.0024 | ~$0.0026 (+ story/creative/critic) |
| Analysis time | ~66s | ~113s |
| Dumps | `director-dump/` | `director-dump-northstar/` |

---

## Conclusion

**North Star is a better director. It is not yet a better editor.**

The v2 creative plan is clearly smarter than the v1 JSON dump: it saw she is holding a passport, wrote an emerald thesis from the room, timed tools to word IDs, planned a zoom on the mission line, an inset graphic that actually says `SIX-FIGURE SALARIES & FINANCIAL FREEDOM`, and a cutaway on “lives of adventure.”

Then the engine did the same damage as last time:

- leftover user B-roll landed at **3.5s**, not the directed cutaway at **18.9s**
- compiler correctly **dropped** depth overlay (no speaker mask)
- `--edits=` then **forced it back** on the word **“20s”** (from “late 20s”)
- the planned zoom was filled, then deleted because it overlapped that forced depth window
- karaoke lock overwrote the editorial caption look
- occupancy is still `fallback`

So: North Star improves the *brief*. The assembler still does not execute the brief. If the question is “does the AI director do a better job?” — **yes, the plan is better. The finished video is only slightly better**, mostly because delivery shaping actually ran and the inset has real copy.

---

## Side-by-side: what Gemini planned

| Beat | v1 flash | North Star creative director |
| --- | --- | --- |
| Sees the footage? | No | Yes — 8 JPEGs. Story notes passport, fan backdrop, hand gestures |
| Hook | `BUILD YOUR DREAM LIFE` / `duo` | `Gabby Beckford \| @Packslight` / `stack` (handle is a misspelling of Packslight / “Pax Lite”) |
| Thesis | none | emerald `#162822` + mint, punchy list ending |
| Zoom | none | yes, on “build their dream lives and take their dream trips” |
| Cutaway | two generic stock queries at 11.64 and 23.54; never used `ub_1` | one cutaway on adventure (`woman solo traveler mountain`), word ids w65–w73 |
| Depth overlay | looping garbage `user_broll_id` at 18.5 | planned on 1M community (w44–w53) with `ub_1` |
| Inset | garbage `variant` string at 13.46 | motion graphic 23.2–26.6, copy **SIX-FIGURE SALARIES & FINANCIAL FREEDOM** |
| JSON hygiene | id loop, thousands of wasted tokens | mostly clean; cold_open field still string-looped |

North Star story analyst (verbatim highlights):

- `content_type`: sales_pitch
- hook weakness: intro has low stopping power
- recommended cold open: start on “I have a community of about a million plus online”
- beat b6: punchy list (solo travel, six-figure salaries, financial freedom), `visual_potential: strong`
- on-screen: “Speaker holding up a US passport directly to camera”

That last line is something v1 could never know.

North Star creative elements (the actual edit instruction):

```
e1 hook_title   w0–w9    Gabby identity / handle
e2 zoom         w35–w43  punch-in on dream lives / dream trips
e3 depth_overlay w44–w53 1M+ community, ub_1, direction up
e4 cutaway      w65–w73  travel visuals for “big, bold lives of adventure”
e5 inset_reveal w81–w87  motion_graphic “SIX-FIGURE SALARIES & FINANCIAL FREEDOM”
```

---

## Side-by-side: what the engine shipped

| Toolkit | v1 shipped | North Star shipped |
| --- | --- | --- |
| Karaoke | yes, recolored | yes, recolored; animation stayed `highlight` (director wanted editorial-emphasis, CLI locked karaoke template) |
| Hook | Dream Life, 4.44s, 1.2s, `stack` | Brand/handle, **0.76s**, 1.2s, `stack` |
| Cutaway | `o.mp4` at **3.50–8.08** | `o.mp4` at **3.50–8.14** *plus* Pixabay city street 16.51–19.71 (`static_gaps_filled`) |
| Depth overlay | 17.46–19.62, `o.mp4`, no mask | **8.6–12.4**, `o.mp4`, reason `Requested depth_overlay on “20s”.` |
| Inset | simple 12.42–15.82 | **motion_graphic 23.19–26.59** with the six-figure line |
| Zoom | 0 | 0 (director planned 9.9s / 2.8s, then overlap drop) |
| Delivery shaping | failed true-peak | **worked**: -26.7 → -18.1 LUFS, peak -3.48, trimmed ~0.97s of dead air |
| Motion graphics | 0 | 4 (north-star critic shoved them all `top_left`) |

Compiler vs allowlist fight (North Star only):

1. Compiler: `drop:e3:no_mask` — correct. This clip has no speaker cutout.
2. `ensureRequestedEditStyles`: `requested_edits_filled:depth_overlay` because `--edits=` still requires it.
3. Fill aligned to “20s” instead of “million plus.” Same speech-align bug as earlier runs.

So North Star *knew* depth overlay was illegal here. The engine put it back.

---

## Did North Star do a better job?

### Yes, as a director

- It looked at frames (passport, room, energy).
- It wrote a real thesis instead of two Pexels queries.
- Tools map to the speech: zoom on the promise, inset on the money list, cutaway on adventure.
- Inset copy is specific, not a blank card.
- Delivery director + renderer succeeded (v1’s ffmpeg true-peak path failed).
- No 5k-character id loop on the required tools.

### No, not enough to trust the finished edit

The leftover-B-roll injector still stole `o.mp4` into the intro. The directed adventure cutaway never used the user clip. A random city-street stock gap-fill appeared. Depth overlay was dropped for a good reason and then force-filled on the wrong phrase. Zoom died. Handle is wrong (`@Packslight`). Cold open was recommended and never actually reordered the timeline.

North Star is still `gemini-3.6-flash`. The upgrade is **structure + vision**, not a smarter base model. Flash still looped `cold_open` and misspelled the handle.

---

## Verdict

If the goal is “does the director think better?” → **North Star wins, clearly.**

If the goal is “does the video become the edit we asked for?” → **not yet.** The same engine bugs dominate: leftover user B-roll, required-edits fill vs compiler, speech-align on “20s”, zoom overlap, occupancy fallback, no mask.

Fix those four assembler issues and North Star’s plan would actually show up on screen. Swapping models without that will keep producing a nicer PDF of an edit than an edit.
