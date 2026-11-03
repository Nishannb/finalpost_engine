#!/usr/bin/env bash
# WP53: clone gbro-collage-broll (MIT) into vendor/ (gitignored). Rendering a collage clip additionally needs
# python3 + `pip install google-genai` + GEMINI_API_KEY, and is opt-in via COLLAGE_RENDER=1 (it costs money). Analyze never calls it.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d vendor/gbro-collage-broll/.git ]; then
  git -C vendor/gbro-collage-broll pull --ff-only
else
  mkdir -p vendor
  git clone --depth 1 https://github.com/pyang5166/gbro-collage-broll.git vendor/gbro-collage-broll
fi
