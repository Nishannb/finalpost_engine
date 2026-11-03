#!/usr/bin/env bash
# WP53: clone the owner-authorized eian-riso-broll renderer into vendor/ (gitignored). See vendor/NOTICE-eian-riso.md.
# Render needs Chrome/Chromium (or CHROME=<path>) + ffmpeg. Check with: node vendor/eian-riso-broll/scripts/check_setup.mjs
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -d vendor/eian-riso-broll/.git ]; then
  git -C vendor/eian-riso-broll pull --ff-only
else
  mkdir -p vendor
  git clone --depth 1 https://github.com/YIAN6557/eian-riso-broll.git vendor/eian-riso-broll
fi
