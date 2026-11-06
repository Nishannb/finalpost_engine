# CaptionKit

74 original caption templates, a renderer that applies any of them to a video using its transcript, a demo clip for every template, and an API service your app talks to.

```
user video ──► speech-to-text (word timestamps) ──► transcript ──┐
                                                                  ├──► captionkit ──► .ass ──► ffmpeg/libass ──► captioned MP4
                              template id + user overrides ──────┘
```

## What's in the folder

| Path | What it is |
|---|---|
| `presets.json` | The 74 templates (9 categories) |
| `captionkit.py` | Renderer and CLI: transcript + template → captioned video |
| `make_previews.py` | Renders the demo clip + poster for every template |
| `previews/` | `<id>.mp4` (5.5 s, 540×960, ~90 KB), `<id>.jpg` poster, `manifest.json` |
| `service/` | FastAPI service: templates, uploads, transcription, renders |
| `fonts/` | All fonts used (SIL OFL / Apache 2.0, free for commercial use and redistribution); licence texts and the per-family index in `fonts/LICENSES.md` |
| `gallery.html` | Browsable gallery of every template's demo clip |
| `tools/` | Scripts that generated the second batch of presets |

## Quick start

Requirements: Python 3.10+, ffmpeg with libass ≥ 0.17 (`apt install ffmpeg`, `brew install ffmpeg`), and `pip install fastapi uvicorn python-multipart pillow fonttools faster-whisper`.

```bash
python captionkit.py list                                   # all template ids
python captionkit.py render --video in.mp4 --transcript words.json --preset sticker --out out.mp4
uvicorn service.app:app --reload                            # API on :8000, docs at /docs
```

---

## Integrating with your app

### 1. Template picker

Call `GET /templates`. Each entry has `id`, `name`, `category`, `description`, `preview_video` and `preview_poster`.

Render a grid of `<video muted loop playsinline poster=…>` tiles, the same way `gallery.html` does, and only play the tiles that are on screen (IntersectionObserver on web; `onViewableItemsChanged` in React Native FlatList; `LazyVerticalGrid` + ExoPlayer on Android; AVPlayer cells on iOS). The clips are about 90 KB each, so put `previews/` on your CDN and the whole picker loads quickly on mobile.

Use `GET /templates?category=Boxed` for category tabs.

### 2. Upload and transcribe

`POST /videos` (multipart `file`) uploads the video and starts transcription. Poll `GET /videos/{id}` until `status` is `ready`. The response includes the word-timed transcript.

The default speech-to-text backend is **faster-whisper**: self-hosted, about 1× real-time on CPU with the `small` model and much faster on GPU. To use a hosted API instead (Deepgram, AssemblyAI, OpenAI), add a function to `service/transcribe.py`. If your app already has a transcript, send it as the `transcript` form field and transcription is skipped.

### 3. Let the user edit (recommended)

Show the transcript in an editor and send corrections back with `PUT /videos/{id}/transcript`. Each word is `{text, start, end, emphasis?}`; `emphasis: true` draws that word in the template's accent color. A "highlight keywords" button can set `emphasis` automatically, for example with an LLM pass over the transcript.

### 4. Live preview while choosing a template

There are two options:

- **Exact preview.** `GET /videos/{id}/subtitles.ass?template_id=sticker` returns the styled subtitle track. Play it over the user's video with [JASSUB](https://github.com/ThaUnknown/jassub) (libass compiled to WebAssembly) on web. It uses the same engine as the final render, so what the user sees is what they get. Load the `fonts/` files into JASSUB.
- **Lightweight preview.** Show the template's demo clip from `previews/` until the user commits.

### 5. Final render

```http
POST /videos/{id}/renders
{"template_id": "spotlight", "overrides": {"wordBox": {"color": "#FF6B00"}, "layout": {"position": "center"}}}
```

Poll `GET /renders/{rid}` until `status` is `done`, then download `file_url`. Audio is copied through untouched.

### 6. Per-user customization

`overrides` is deep-merged over the template, so any field in the schema can drive an edit panel:

| Control in your UI | Override |
|---|---|
| Highlight color | `{"colors": {"active": "#FF0055"}}` |
| Tag color (box-word templates) | `{"wordBox": {"color": "#FF6B00"}}` |
| Text size | `{"font": {"size": 0.06}}` (fraction of video height) |
| Position | `{"layout": {"position": "top", "offset": 0.12}}` |
| Words per caption | `{"layout": {"maxWords": 2}}` |
| All caps / lowercase | `{"font": {"case": "upper"}}` |
| Animation | `{"animation": "bounce"}` (`none`, `pop`, `bounce`, `stretch`, `zoom`, `fade`, `slide-up`) |

Save `{template_id, overrides}` with the user's project so they can come back and re-render. Users can also save customizations as "My templates" the same way.

### Production checklist

- Replace in-memory storage with S3/GCS plus a database, and the thread pool with a job queue (Celery, RQ, SQS, Cloud Tasks).
- Run render workers in a container with ffmpeg, libass and `fonts/`. A 60-second 1080p video renders in roughly 10–20 s on 2 vCPUs. Add `-preset veryfast` in `render()` for speed, or use GPU encoding (`h264_nvenc`).
- Add auth and per-user ownership checks on `/videos` and `/renders`.
- Prefer real footage for demo clips. Record or license one short talking-head clip, transcribe it, then run `python make_previews.py --background clip.mp4 --transcript clip_words.json` to regenerate every preview.

---

## Template schema

```jsonc
{
  "id": "spotlight", "name": "Spotlight", "category": "Boxed", "description": "...",
  "font":   { "family": "Poppins", "weight": 900, "size": 0.05, "case": "upper|lower|none", "spacing": 0, "italic": false },
  "colors": { "text": "#FFFFFF", "active": "#0B0B0B", "spoken": "#FFFFFF", "accent": "#3DDC84",
              "outline": "#000000", "shadow": "#00000000",
              "line2": "#FFD60A",            // optional: second line in another color
              "activeOutline": "#FFD60A" },  // optional: glow/edge only on the spoken word
  "stroke": { "width": 0.003, "blur": 0 },  "shadowDepth": 0,
  "box":     { "color": "#000000CC", "padding": 0.012 },   // optional strip behind the line
  "wordBox": { "color": "#3DDC84",   "padding": 0.008 },   // optional tag behind the spoken word
  "activeScale": 1.2,                                      // optional: spoken word stays larger
  "activeUnderline": true,                                 // optional
  "layout": { "maxWords": 3, "maxChars": 20, "lines": 1, "position": "bottom|center|top", "offset": 0.24 },
  "mode": "static | highlight | karaoke | reveal | box-word | one-word",
  "animation": "none | pop | bounce | stretch | zoom | fade | slide-up"
}
```

- Sizes are fractions of the video height, so one template works at 9:16, 1:1, 16:9 and 4K.
- Colors are `#RRGGBB` or `#RRGGBBAA`.
- Long lines are measured with the real font and shrunk automatically so they never run off screen.

## Adding templates

1. Add an object to `presets.json`.
2. Put any new font file in `fonts/`.
3. Run `python make_previews.py --only <id>` to render its demo clip.

Fonts are matched to the exact face (for example Poppins Black vs Poppins Bold) automatically. Stick to OFL/Apache fonts to keep licensing simple.
