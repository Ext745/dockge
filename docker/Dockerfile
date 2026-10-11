############################################
# Healthcheck Binary
############################################
FROM ghcr.io/darthrater78/dockge:build-healthcheck@sha256:199ec80354eb804167710977a431729197455ad1adb2ed710ad16d2fd9179bc3 AS build_healthcheck

############################################
# Build
############################################
# Pinned by digest: bump after each docker-base.yml run (Dependabot proposes it weekly)
FROM ghcr.io/darthrater78/dockge:base@sha256:1a71c86cb0adedca11b56dfc33ab54c5e1d7ae017c8b3dbf38654c7b0734907f AS build
WORKDIR /app
COPY --chown=node:node  ./package.json ./package.json
COPY --chown=node:node  ./package-lock.json ./package-lock.json
RUN npm ci --omit=dev

############################################
# ⭐ Main Image
############################################
FROM ghcr.io/darthrater78/dockge:base@sha256:1a71c86cb0adedca11b56dfc33ab54c5e1d7ae017c8b3dbf38654c7b0734907f AS release
WORKDIR /app
# Debian security updates published since the base image was built, and no npm/npx/corepack:
# Dockge never runs them, and the copy bundled with Node carries its own CVEs
RUN apt-get update && apt-get upgrade --yes --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
# App files stay root-owned, so the user Dockge switches to (PUID) can't modify the code root starts
COPY --from=build_healthcheck /app/extra/healthcheck /app/extra/healthcheck
COPY --from=build /app/node_modules /app/node_modules
COPY . .
RUN mkdir ./data && chmod 755 ./extra/entrypoint.sh


# It is just for safe, as by default, it is disabled in the latest Node.js now.
# Read more:
# - https://github.com/sagemathinc/cocalc/issues/6963
# - https://github.com/microsoft/node-pty/issues/630#issuecomment-1987212447
ENV UV_USE_IO_URING=0

VOLUME /app/data
EXPOSE 5001
HEALTHCHECK --interval=60s --timeout=30s --start-period=60s --retries=5 CMD extra/healthcheck
# Starts as root unless `user:` is set; with PUID/PGID it fixes folder ownership and drops to that user
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/app/extra/entrypoint.sh"]
CMD ["tsx", "./backend/index.ts"]
