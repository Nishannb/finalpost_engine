# Video engine API — Node 22 + ffmpeg.
#
# Only the server ships in this image. The Remotion project is deployed
# separately to Lambda/S3 (`npm run deploy --workspace=remotion`), so the runtime
# container stays small and holds no Chromium.

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json ./
COPY server/package.json ./server/
RUN npm install --omit=dev --workspace=server --ignore-scripts \
  && npm install --workspace=server --include=dev --ignore-scripts

COPY server ./server
RUN npm run build --workspace=server

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ffmpeg/ffprobe are required by src/media/ffmpeg.ts for audio extraction.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY server/package.json ./server/
RUN npm install --omit=dev --workspace=server --ignore-scripts \
  && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
# Person matte = Robust Video Matting (RVM). MediaPipe is retired; there is no matte build stage any more. Only the RVM CODE is copied (not .venv-rvm, weights or out/):
# production must PROVISION the RVM virtualenv (torch CPU/CUDA, requirements-rvm.txt) and the weights file (subjectmatte/weights/rvm_mobilenetv3.pth) on the host / a mounted volume and point
# RVM_PYTHON at that interpreter (RVM_DEVICE=auto|cuda|mps|cpu). Without them the matte reports not_configured and kinetic type keeps the headroom layout. Weights are never baked into this image.
COPY subjectmatte/human_matting ./subjectmatte/human_matting
COPY subjectmatte/vendor ./subjectmatte/vendor
COPY subjectmatte/requirements-rvm.txt ./subjectmatte/requirements-rvm.txt
# Music specialist (BGM): the server spawns `python -m music_specialist` from /app/agents (see agentsDir()) and measures the creator's voice loudness with it.
# Without this block the image still serves pool beds (pure TypeScript) but cannot generate a bed for an empty mood and assumes -20 LUFS for the voice.
# The mood map and briefRules.json (styles, arcs) are read by prompts.py from its source path, so it is copied to the same place. Dependencies live in /app/agents/.venv, which resolvePython() prefers.
COPY agents/music_specialist ./agents/music_specialist
COPY server/src/stages/music/contentMoodMap.json ./server/src/stages/music/contentMoodMap.json
COPY server/src/stages/music/briefRules.json ./server/src/stages/music/briefRules.json
RUN python3 -m venv /app/agents/.venv \
  && /app/agents/.venv/bin/pip install --no-cache-dir pydub pyloudnorm numpy scipy librosa
COPY captionkit_tmp/captionkit.py captionkit_tmp/presets.json ./captionkit_tmp/
COPY captionkit_tmp/fonts ./captionkit_tmp/fonts
ENV CAPTIONKIT_ROOT=/app/captionkit_tmp
ENV CAPTIONKIT_PYTHON=python3

# Scratch files land in /tmp; a tmpfs mount there keeps the image read-only.
RUN useradd --create-home --uid 10001 engine \
  && chown -R engine /app/agents/music_specialist  # spend.log and the specialist's scratch files are written next to the code
USER engine

EXPOSE 8090
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8090/health || exit 1

CMD ["node", "server/dist/index.js"]
