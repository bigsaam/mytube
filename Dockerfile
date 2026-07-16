# syntax=docker/dockerfile:1

##########################################################################
# MyTube — self-hosted YouTube frontend
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
# yt-dlp needs a real JS runtime to solve YouTube's "n" challenge (its EJS
# system). Without one, extraction yields only storyboard images and every
# download fails with "Requested format is not available". Deno is yt-dlp's
# preferred runtime and is auto-detected on PATH. Pin it like yt-dlp.
ARG DENO_VERSION=2.9.3

############################### deps / build ##############################
FROM node:${NODE_VERSION} AS build
WORKDIR /app

# Toolchain for native modules (better-sqlite3).
RUN apt-get update && apt-get install -y --no-install-recommends \
	python3 make g++ ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Install with a package manager cache mount for fast rebuilds.
RUN corepack enable
# pnpm-workspace.yaml carries onlyBuiltDependencies — without it, pnpm refuses
# to run better-sqlite3's native build (ERR_PNPM_IGNORED_BUILDS) and install fails.
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
	pnpm install --frozen-lockfile || pnpm install

COPY . .
RUN pnpm run build \
	&& pnpm prune --prod

############################### chromium (optional) ######################
# Isolated stage so the browser + its apt deps never touch the default image.
FROM build AS chromium
# Install into /ms-playwright (not the default ~/.cache) so the runtime-chromium
# stage can COPY it from a fixed, predictable path.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN pnpm exec playwright install --with-deps chromium

############################### runtime ###################################
FROM node:${NODE_VERSION} AS runtime
ARG YTDLP_VERSION
ARG DENO_VERSION
ENV NODE_ENV=production \
	PORT=3000 \
	DATABASE_PATH=/data/mytube.db \
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
	&& curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" \
		-o /tmp/deno.zip \
	&& python3 -c "import zipfile; zipfile.ZipFile('/tmp/deno.zip').extractall('/usr/local/bin')" \
	&& chmod a+rx /usr/local/bin/deno \
	&& rm -f /tmp/deno.zip \
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
#   docker build --target runtime-chromium -t mytube:chromium .
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
