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
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY server/package.json ./server/
RUN npm install --omit=dev --workspace=server --ignore-scripts \
  && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist

# Scratch files land in /tmp; a tmpfs mount there keeps the image read-only.
RUN useradd --create-home --uid 10001 engine
USER engine

EXPOSE 8090
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8090/health || exit 1

CMD ["node", "server/dist/index.js"]
