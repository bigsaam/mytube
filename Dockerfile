# syntax=docker/dockerfile:1

##########################################################################
# Haystack — self-hosted YouTube frontend
#
# Single container. yt-dlp + ffmpeg are baked in. Chromium (for the optional
# recommended-feed module) is installed ONLY when INSTALL_CHROMIUM=true at build
# time — it roughly doubles the image size, so it is off by default.
##########################################################################

ARG NODE_VERSION=22-bookworm-slim
# Pin yt-dlp; extractor breakage is the #1 failure mode. Keep this current with
# the latest stable — a stale pin fails on YouTube's current player. The Settings
# page has a "self-update yt-dlp" button (yt-dlp -U) to move ahead of this
# baseline without rebuilding, and `--build-arg YTDLP_VERSION=<tag>` overrides it.
ARG YTDLP_VERSION=2026.07.04

############################### deps / build ##############################
FROM node:${NODE_VERSION} AS build
WORKDIR /app

# Toolchain for native modules (better-sqlite3).
RUN apt-get update && apt-get install -y --no-install-recommends \
	python3 make g++ ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Install with a package manager cache mount for fast rebuilds.
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
	pnpm install --frozen-lockfile || pnpm install

COPY . .
RUN pnpm run build \
	&& pnpm prune --prod

############################### chromium (optional) ######################
# Isolated stage so the browser + its apt deps never touch the default image.
FROM build AS chromium
RUN pnpm exec playwright install --with-deps chromium

############################### runtime ###################################
FROM node:${NODE_VERSION} AS runtime
ARG YTDLP_VERSION
ENV NODE_ENV=production \
	PORT=3000 \
	DATABASE_PATH=/data/haystack.db \
	MEDIA_ROOT=/media \
	DATA_ROOT=/data \
	PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Runtime OS deps: ffmpeg (remux/thumbs) + python3 (yt-dlp is a python zipapp).
RUN apt-get update && apt-get install -y --no-install-recommends \
	ffmpeg python3 ca-certificates curl tini \
	&& curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" \
		-o /usr/local/bin/yt-dlp \
	&& chmod a+rx /usr/local/bin/yt-dlp \
	&& rm -rf /var/lib/apt/lists/*

# App: built output, production deps, migrations, and package metadata.
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json

VOLUME ["/data", "/media"]
EXPOSE 3000

# tini for correct signal handling / subprocess reaping (yt-dlp, chromium).
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "build/index.js"]

##########################################################################
# To build WITH the recommended-feed module (Chromium ~+450MB):
#   docker build --target runtime-chromium -t haystack:chromium .
# Without it (default), the `runtime` target ships no browser at all.
##########################################################################

FROM runtime AS runtime-chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=chromium /ms-playwright /ms-playwright
# Chromium's shared-lib dependencies:
RUN apt-get update && apt-get install -y --no-install-recommends \
	libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
	libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
	libcairo2 libasound2 libatspi2.0-0 \
	&& rm -rf /var/lib/apt/lists/*
