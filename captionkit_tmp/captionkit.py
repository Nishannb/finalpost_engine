#!/usr/bin/env python3
"""
captionkit — turn a word-timed transcript + a style preset into styled,
burned-in captions.

Pipeline:  transcript (word timestamps)  ->  .ass subtitle file  ->  ffmpeg burn-in

Usage:
  python captionkit.py render  --video in.mp4 --transcript words.json --preset punchline --out out.mp4
  python captionkit.py ass     --transcript words.json --preset punchline --width 1080 --height 1920 --out subs.ass
  python captionkit.py list

Transcript JSON accepted shapes (Whisper / Deepgram / AssemblyAI style all map onto these):
  [{"text": "Hello", "start": 0.12, "end": 0.40}, ...]
  {"words": [...]}
  {"segments": [{"words": [{"word": "Hello", "start": 0.12, "end": 0.40}, ...]}, ...]}
Optional per word: "emphasis": true  -> drawn in the preset's accent color.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_PRESETS = HERE / "presets.json"
DEFAULT_FONTS = HERE / "fonts"


# --------------------------------------------------------------------------- data

@dataclass
class Word:
    text: str
    start: float
    end: float
    emphasis: bool = False


def load_presets(path: Path = DEFAULT_PRESETS) -> dict[str, dict]:
    data = json.loads(Path(path).read_text())
    return {p["id"]: p for p in data["presets"]}


def load_transcript(path_or_obj) -> list[Word]:
    obj = path_or_obj
    if isinstance(path_or_obj, (str, Path)):
        obj = json.loads(Path(path_or_obj).read_text())
    if isinstance(obj, dict):
        if "words" in obj:
            raw = obj["words"]
        elif "segments" in obj:
            raw = [w for s in obj["segments"] for w in s.get("words", [])]
        else:
            raise ValueError("Transcript needs a 'words' or 'segments' key")
    else:
        raw = obj
    words = []
    for w in raw:
        text = (w.get("text") or w.get("word") or w.get("punctuated_word") or "").strip()
        if not text:
            continue
        start, end = float(w["start"]), float(w["end"])
        if start > 1000 * 60 * 60:  # milliseconds (AssemblyAI) -> seconds
            start, end = start / 1000, end / 1000
        words.append(Word(text, start, max(end, start + 0.05), bool(w.get("emphasis"))))
    words.sort(key=lambda w: w.start)
    return words


# --------------------------------------------------------------------------- helpers

def ass_color(hex_str: str) -> tuple[str, str]:
    """'#RRGGBB[AA]' -> ('&HBBGGRR&', '&HAA&') with ASS alpha (00 = opaque)."""
    h = hex_str.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    opacity = int(h[6:8], 16) if len(h) == 8 else 255
    return f"&H{b}{g}{r}&".upper(), f"&H{255 - opacity:02X}&"


def style_color(hex_str: str) -> str:
    """'#RRGGBB[AA]' -> '&HAABBGGRR' for [V4+ Styles]."""
    c, a = ass_color(hex_str)
    return f"&H{a[2:4]}{c[2:8]}"


def ass_time(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")")


def apply_case(text: str, case: str) -> str:
    return text.upper() if case == "upper" else text.lower() if case == "lower" else text


SENTENCE_END = re.compile(r"[.!?…]$")
CLAUSE_END = re.compile(r"[,;:—–]$")


def chunk_words(words: list[Word], max_words: int, max_chars: int, gap: float = 0.7) -> list[list[Word]]:
    chunks, cur = [], []
    for w in words:
        if cur:
            length = sum(len(x.text) for x in cur) + len(cur) + len(w.text)
            prev = cur[-1]
            if (len(cur) >= max_words or length > max_chars or w.start - prev.end > gap
                    or SENTENCE_END.search(prev.text)
                    or (CLAUSE_END.search(prev.text) and len(cur) >= max(2, max_words // 2))):
                chunks.append(cur)
                cur = []
        cur.append(w)
    if cur:
        chunks.append(cur)
    return chunks


def split_lines(chunk: list[Word], lines: int) -> int | None:
    """Index of the word that starts line 2 (balanced by characters), or None."""
    if lines < 2 or len(chunk) < 2:
        return None
    total = sum(len(w.text) for w in chunk)
    best, best_diff, acc = None, 1e9, 0
    for i in range(1, len(chunk)):
        acc += len(chunk[i - 1].text)
        diff = abs(acc - (total - acc))
        if diff < best_diff:
            best, best_diff = i, diff
    return best


# --------------------------------------------------------------------------- text measuring (auto-fit)

_FONT_INDEX: dict | None = None


def _font_index(fonts_dir: Path) -> dict:
    global _FONT_INDEX
    if _FONT_INDEX is None:
        from fontTools.ttLib import TTFont
        _FONT_INDEX = {}
        for f in Path(fonts_dir).glob("*.[ot]tf"):
            try:
                tt = TTFont(f, lazy=True)
                name = tt["name"]
                fam = (name.getDebugName(16) or name.getDebugName(1) or "").lower()
                weight = tt["OS/2"].usWeightClass
                italic = bool(tt["OS/2"].fsSelection & 1)
                sub = (name.getDebugName(2) or "Regular").strip().lower()
                if sub in ("regular", "bold", "italic", "bold italic"):   # RIBBI face: family + flags
                    legacy, legacy_bold = name.getDebugName(1) or fam, sub.startswith("bold")
                else:                                                    # e.g. ExtraBold: match by full name
                    legacy, legacy_bold = name.getDebugName(4) or name.getDebugName(1), False
                _FONT_INDEX.setdefault(fam, []).append((weight, italic, str(f), legacy, legacy_bold))
            except Exception:
                continue
    return _FONT_INDEX


def font_file(family: str, weight: int = 400, italic: bool = False, fonts_dir: Path = DEFAULT_FONTS) -> str | None:
    faces = _font_index(fonts_dir).get(family.lower())
    if not faces:
        return None
    return _best_face(faces, weight, italic)[2]


def _best_face(faces, weight, italic):
    return min(faces, key=lambda f: (f[1] != italic, abs(f[0] - weight)))


def ass_font(family: str, weight: int = 400, italic: bool = False, fonts_dir: Path = DEFAULT_FONTS):
    """(Fontname, Bold, Italic) for an ASS style that makes libass pick exactly this face.
    libass matches on the legacy family name (e.g. 'Poppins Black'), not the typographic one."""
    faces = _font_index(fonts_dir).get(family.lower())
    if not faces:  # not bundled: let the system resolve it
        return family, (-1 if weight >= 600 else 0), (-1 if italic else 0)
    w, it, _, legacy, legacy_bold = _best_face(faces, weight, italic)
    return legacy, (-1 if legacy_bold else 0), (-1 if it else 0)


def measure(text: str, family: str, weight: int, italic: bool, size: int, spacing: float,
            fonts_dir: Path = DEFAULT_FONTS) -> float | None:
    path = font_file(family, weight, italic, fonts_dir)
    if not path:
        return None
    from PIL import ImageFont
    f = ImageFont.truetype(path, size)
    return f.getlength(text) + spacing * max(0, len(text) - 1)


# --------------------------------------------------------------------------- ASS build

ANIMATIONS = ("none", "pop", "bounce", "stretch", "zoom", "fade", "slide-up")


def anim_in(anim: str, scale: float = 1.0) -> str:
    """Entrance tags for the active word, settling at `scale` (1.0 = 100%)."""
    S = lambda f: round(100 * scale * f)
    if anim == "pop":
        return rf"\fscx{S(1.25)}\fscy{S(1.25)}\t(0,120,\fscx{S(1)}\fscy{S(1)})"
    if anim == "bounce":
        return rf"\fscx{S(.7)}\fscy{S(.7)}\t(0,90,\fscx{S(1.18)}\fscy{S(1.18)})\t(90,180,\fscx{S(1)}\fscy{S(1)})"
    if anim == "stretch":
        return rf"\fscx{S(1)}\fscy{S(1.6)}\t(0,150,\fscy{S(1)})"
    if anim == "zoom":
        return rf"\fscx{S(.4)}\fscy{S(.4)}\t(0,140,\fscx{S(1)}\fscy{S(1)})"
    if scale != 1.0:
        return rf"\fscx{S(1)}\fscy{S(1)}"
    return ""


def build_ass(words: list[Word], preset: dict, width: int, height: int,
              fonts_dir: Path = DEFAULT_FONTS) -> str:
    P = preset
    font, colors, layout = P["font"], P["colors"], P["layout"]
    mode, anim = P.get("mode", "static"), P.get("animation", "none")
    H = height
    size = round(font["size"] * H)
    stroke = round(P.get("stroke", {}).get("width", 0) * H, 1)
    blur = round(P.get("stroke", {}).get("blur", 0) * H, 1)
    shadow = round(P.get("shadowDepth", 0) * H, 1)
    fontname, bold, italic = ass_font(font["family"], font.get("weight", 400), bool(font.get("italic")), fonts_dir)
    case = font.get("case", "none")
    line_box = P.get("box")
    word_box = P.get("wordBox")

    # position
    x = width // 2
    pos = layout.get("position", "bottom")
    off = layout.get("offset", 0.1)
    if pos == "top":
        an, y = 8, round(H * off)
    elif pos == "center":
        an, y = 5, round(H * (0.5 + off))
    else:
        an, y = 2, round(H * (1 - off))
    margin_lr = round(width * 0.06)

    # styles
    if line_box:
        pad = round(line_box.get("padding", 0.01) * H)
        main = (f"Style: Main,{fontname},{size},{style_color(colors['text'])},&H000000FF,"
                f"&HFF000000,{style_color(line_box['color'])},{bold},{italic},0,0,100,100,"
                f"{font.get('spacing', 0)},0,4,{pad},0,{an},{margin_lr},{margin_lr},0,1")
    else:
        main = (f"Style: Main,{fontname},{size},{style_color(colors['text'])},&H000000FF,"
                f"{style_color(colors.get('outline', '#000000'))},{style_color(colors.get('shadow', '#00000000'))},"
                f"{bold},{italic},0,0,100,100,{font.get('spacing', 0)},0,1,{stroke},{shadow},{an},"
                f"{margin_lr},{margin_lr},0,1")
    styles = [main]
    if word_box:
        wpad = round(word_box.get("padding", 0.008) * H)
        styles.append(
            f"Style: WordBox,{fontname},{size},&H00FFFFFF,&H000000FF,"
            f"{style_color(word_box['color'])},{style_color(word_box['color'])},{bold},{italic},0,0,100,100,"
            f"{font.get('spacing', 0)},0,3,{wpad},0,{an},{margin_lr},{margin_lr},0,1")

    text_c, text_a = ass_color(colors["text"])
    act_c, act_a = ass_color(colors.get("active", colors["text"]))
    spk_c, spk_a = ass_color(colors.get("spoken", colors.get("active", colors["text"])))
    acc_c, acc_a = ass_color(colors.get("accent", colors["text"]))
    l2_c, l2_a = ass_color(colors.get("line2", colors["text"]))
    oc, oa = ass_color(colors.get("outline", "#000000"))
    sc, sa = ass_color(colors.get("shadow", "#00000000"))
    a_scale = P.get("activeScale", 1.0)
    a_outline = colors.get("activeOutline")
    a_under = P.get("activeUnderline", False)

    def base_reset(j: int, br) -> str:
        c, a = (l2_c, l2_a) if br and j >= br else (text_c, text_a)
        r = rf"\1c{c}\1a{a}\fscx100\fscy100"
        if not line_box:
            r += rf"\3c{oc}\3a{oa}\4a{sa}\bord{stroke}\shad{shadow}"
        if a_under:
            r += r"\u0"
        return r

    def active_extra() -> str:
        t = ""
        if a_outline and not line_box:
            c, a = ass_color(a_outline)
            t += rf"\3c{c}\3a{a}"
            if not stroke:
                t += rf"\bord{max(2, round(size * 0.06))}"
        if a_under:
            t += r"\u1"
        return t
    weight_tag = ""

    def fit_scale(chunk, br) -> float:
        """Shrink a chunk whose widest line would overflow the safe area."""
        groups = [chunk[:br], chunk[br:]] if br else [chunk]
        widths = []
        for g in groups:
            m = measure(" ".join(apply_case(w.text, case) for w in g), font["family"], font.get("weight", 400),
                        bool(font.get("italic")), size, font.get("spacing", 0), fonts_dir)
            if m is None:
                return 1.0
            widths.append(m)
        pad = 2 * (round(line_box.get("padding", 0.01) * H) if line_box else stroke)
        limit = width * 0.88 / max(1.0, P.get("activeScale", 1.0))
        need = max(widths) + pad
        return 1.0 if need <= limit else max(0.5, limit / need)

    def lead(first_in_chunk: bool, dy: int = 0, k: float = 1.0) -> str:
        t = rf"\an{an}"
        if k < 1.0:
            t += rf"\fs{round(size * k)}"
        y0 = y - dy
        if anim == "slide-up" and first_in_chunk:
            d = round(H * 0.025)
            t += rf"\move({x},{y0 + d},{x},{y0},0,160)\fad(140,0)"
        else:
            t += rf"\pos({x},{y0})"
            if anim == "fade" and first_in_chunk and mode != "reveal":
                t += r"\fad(150,0)"
        if blur:
            t += rf"\blur{blur}"
        return t + weight_tag

    def word_text(chunk, active, br, layer):
        parts = []
        for j, w in enumerate(chunk):
            if j and j == br:
                parts.append(r"\N")
            elif j:
                parts.append(" ")
            t = esc(apply_case(w.text, case))
            is_active = j == active
            reset = base_reset(j, br)
            if br and j == br and not is_active and not (mode == "reveal" and active is not None and j > active) \
                    and colors.get("line2") and layer != "box":
                t = "{" + reset + "}" + t
            if layer == "box":
                if is_active:
                    tags = r"\1a&HFF&\3a&H00&\4a&H00&"
                    tags += anim_in(anim, a_scale)
                    parts.append("{" + tags + "}" + t + r"{\alpha&HFF&\fscx100\fscy100}")
                else:
                    parts.append(t)
                continue
            tags = ""
            if mode == "reveal" and active is not None and j > active:
                tags = r"\1a&HFF&\3a&HFF&" if line_box else r"\alpha&HFF&"
                parts.append("{" + tags + "}" + t + "{" + reset + "}")
                continue
            if is_active and mode in ("highlight", "karaoke", "box-word", "reveal", "one-word"):
                tags += rf"\1c{act_c}\1a{act_a}"
                if mode == "box-word":
                    tags += r"\bord0\shad0"
                else:
                    tags += active_extra()
                if mode != "reveal":
                    tags += anim_in(anim, a_scale)
                if mode == "reveal" and anim == "fade":
                    tags += rf"\1a&HFF&\t(0,180,\1a{act_a})"
            elif mode == "karaoke" and active is not None and j < active:
                tags += rf"\1c{spk_c}\1a{spk_a}"
            elif w.emphasis:
                tags += rf"\1c{acc_c}\1a{acc_a}"
            if tags:
                parts.append("{" + tags + "}" + t + "{" + reset + "}")
            else:
                parts.append(t)
        return "".join(parts)

    events = []
    max_words = layout.get("maxWords", 5)
    if mode == "one-word":
        max_words = 1
    chunks = chunk_words(words, max_words, layout.get("maxChars", 30))
    for ci, chunk in enumerate(chunks):
        nxt = chunks[ci + 1][0].start if ci + 1 < len(chunks) else None
        chunk_end = chunk[-1].end + 0.3
        if nxt is not None:
            chunk_end = min(chunk_end, nxt)
        br = split_lines(chunk, layout.get("lines", 1))
        k = fit_scale(chunk, br)

        if mode == "static":
            events.append((1, chunk[0].start, chunk_end, "Main",
                           "{" + lead(True, 0, k) + "}" + word_text(chunk, None, br, "text")))
            continue

        for i, w in enumerate(chunk):
            s = chunk[0].start if i == 0 else w.start
            e = chunk[i + 1].start if i + 1 < len(chunk) else chunk_end
            if e - s < 0.02:
                continue
            first = i == 0
            if word_box and mode == "box-word":
                box_dy = round(size * (0.2 if case == "upper" else 0.1))
                events.append((0, s, e, "WordBox", "{" + lead(first, round(box_dy * k), k) + r"\alpha&HFF&}" + word_text(chunk, i, br, "box")))
            events.append((1, s, e, "Main", "{" + lead(first, 0, k) + "}" + word_text(chunk, i, br, "text")))

    header = f"""[Script Info]
; Generated by captionkit — preset: {P['id']}
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{chr(10).join(styles)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [f"Dialogue: {l},{ass_time(s)},{ass_time(e)},{st},,0,0,0,,{txt}" for l, s, e, st, txt in events]
    return header + "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- video

def probe_size(video: str) -> tuple[int, int]:
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height:stream_side_data=rotation",
        "-of", "json", video])
    st = json.loads(out)["streams"][0]
    w, h = st["width"], st["height"]
    rot = 0
    for sd in st.get("side_data_list", []) or []:
        rot = abs(int(sd.get("rotation", 0)))
    return (h, w) if rot in (90, 270) else (w, h)


def deep_merge(base: dict, over: dict) -> dict:
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def resolve_preset(preset_id: str, overrides: dict | None = None,
                   presets_path: Path = DEFAULT_PRESETS) -> dict:
    """Base preset + per-user overrides, e.g. {"colors": {"active": "#FF0000"}, "font": {"size": 0.06}}."""
    presets = load_presets(presets_path)
    if preset_id not in presets:
        raise KeyError(f"Unknown preset '{preset_id}'")
    return deep_merge(presets[preset_id], overrides or {})


def render(video: str, transcript, preset_id: str, out: str,
           presets_path: Path = DEFAULT_PRESETS, fonts_dir: Path = DEFAULT_FONTS,
           crf: int = 20, keep_ass: bool = False, overrides: dict | None = None) -> str:
    try:
        preset = resolve_preset(preset_id, overrides, presets_path)
    except KeyError as e:
        raise SystemExit(f"{e}. Run `list` to see presets.")
    words = load_transcript(transcript)
    w, h = probe_size(video)
    ass = build_ass(words, preset, w, h, Path(fonts_dir))
    ass_path = Path(out).with_suffix(".ass")
    ass_path.write_text(ass, encoding="utf-8")
    vf = f"subtitles={ass_path.as_posix()}:fontsdir={Path(fonts_dir).as_posix()}"
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", video, "-vf", vf,
           "-c:v", "libx264", "-preset", "medium", "-crf", str(crf), "-pix_fmt", "yuv420p",
           "-c:a", "copy", out]
    subprocess.run(cmd, check=True)
    if not keep_ass:
        ass_path.unlink(missing_ok=True)
    return out


# --------------------------------------------------------------------------- CLI

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("render", help="burn captions into a video")
    r.add_argument("--video", required=True)
    r.add_argument("--transcript", required=True)
    r.add_argument("--preset", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--presets", default=str(DEFAULT_PRESETS))
    r.add_argument("--fonts", default=str(DEFAULT_FONTS))
    r.add_argument("--keep-ass", action="store_true")

    a = sub.add_parser("ass", help="write only the .ass file (for players / client-side burn)")
    a.add_argument("--transcript", required=True)
    a.add_argument("--preset", required=True)
    a.add_argument("--width", type=int, default=1080)
    a.add_argument("--height", type=int, default=1920)
    a.add_argument("--out", required=True)
    a.add_argument("--presets", default=str(DEFAULT_PRESETS))

    l = sub.add_parser("list", help="list presets")
    l.add_argument("--presets", default=str(DEFAULT_PRESETS))

    args = ap.parse_args(argv)
    if args.cmd == "list":
        for p in load_presets(args.presets).values():
            print(f"{p['id']:<12} {p['category']:<12} {p['description']}")
    elif args.cmd == "ass":
        p = load_presets(args.presets)[args.preset]
        Path(args.out).write_text(build_ass(load_transcript(args.transcript), p, args.width, args.height))
        print(args.out)
    else:
        print(render(args.video, args.transcript, args.preset, args.out,
                     Path(args.presets), Path(args.fonts), keep_ass=args.keep_ass))


if __name__ == "__main__":
    main()
