# Playthrough ships as what it is: a stock Node runtime with the source in it.
#
# One stage, because there is nothing to build: no dependencies, no lockfile, no compile step. What a
# team owns, its folder of flows, is not in here; it is mounted at run time at /app/specs, which is
# what lets one image serve anybody's flows.

FROM node:22-alpine

LABEL org.opencontainers.image.title="Playthrough" \
      org.opencontainers.image.description="Draw the flow of a feature before it exists, list its scenarios, and play each one through the drawing." \
      org.opencontainers.image.source="https://github.com/hussein-akar/playthrough" \
      org.opencontainers.image.documentation="https://github.com/hussein-akar/playthrough#readme" \
      org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app

# npm, npx, corepack and yarn, deleted. Nothing in here runs them: there are no dependencies to
# install, and the container's one job is `node serve.mjs`. What they do leave behind is npm's own
# dependency tree — a couple of hundred packages a scanner reads and reports CVEs against, in an
# image that never calls a line of them. Deleting them is the whole fix for that, and it costs
# nothing, because nothing here asked for them. Before the COPY steps, so editing the page or the
# server does not rebuild this layer.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Only what the server reads at run time: the page, its modules, the server, and the presets the
# Template menu offers.
COPY package.json LICENSE serve.mjs index.html ./
COPY lib/ ./lib/
COPY ui/ ./ui/
COPY examples/ ./examples/

# The project folder, created empty and owned by `node` so the server can write to it even when
# nothing is mounted over it. Mount your own folder here to keep what you save.
RUN mkdir -p specs && chown -R node:node /app

# Not root. On Linux a bind mount keeps the host's ownership, so a mounted folder must be writable
# by uid 1000, or run the container as yourself: `--user "$(id -u):$(id -g)"`.
USER node

# PORT is the port inside the container. PLAYTHROUGH_DIR is the project folder; set it to an empty
# string to run without one (Save then downloads a file instead of writing it).
ENV PORT=8095 \
    PLAYTHROUGH_DIR=/app/specs

EXPOSE 8095

# Shell form on purpose, so PORT is read when the check runs rather than when the image is built.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD wget -qO- "http://localhost:${PORT:-8095}/health" > /dev/null || exit 1

CMD ["node", "serve.mjs"]
