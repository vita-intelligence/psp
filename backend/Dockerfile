# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the PSP Phoenix backend.
#   builder → fetch deps, compile, cut a mix release
#   runtime → Debian slim + OTP runtime + release artifacts
#
# Override the base tags via --build-arg if a newer hexpm tag is
# preferred or the pinned one disappears from Docker Hub.

ARG ELIXIR_VERSION=1.17.3
ARG OTP_VERSION=27.3.4.18
ARG DEBIAN_VERSION=bookworm-20260918-slim
ARG BUILDER_IMAGE="hexpm/elixir:${ELIXIR_VERSION}-erlang-${OTP_VERSION}-debian-${DEBIAN_VERSION}"
ARG RUNNER_IMAGE="debian:${DEBIAN_VERSION}"

# ---------- Builder ----------

FROM ${BUILDER_IMAGE} AS builder

RUN apt-get update -y && \
    apt-get install -y --no-install-recommends build-essential git ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mix local.hex --force && mix local.rebar --force

ENV MIX_ENV=prod

# ERL_FLAGS="+JPperf true" is REQUIRED when cross-compiling an
# x86_64 BEAM image from an Apple Silicon (arm64) host, whether
# under QEMU or Rosetta translation. The OTP 25+ JIT double-maps
# its generated code pages (W separate from X); QEMU/Rosetta don't
# track writes across the two mappings, so the BEAM's module
# registry sees stale state mid-compile and crashes with:
#   ** (ArgumentError) could not call Module.put_attribute/3
#      because the module <PreviousDep>.MixProject is already compiled
# `+JPperf true` disables the double-mapping (originally a Linux
# perf-profiling flag; single-mapped JIT pages emulate correctly).
# Harmless on a native x86_64 build machine.
# Reference: https://gist.github.com/nicnilov/ece4f2fd65f00bc6240668921f540ede
ENV ERL_FLAGS="+JPperf true"

# Manifests first so a source edit doesn't invalidate the deps cache
COPY mix.exs mix.lock ./
COPY config config
RUN mix deps.get --only prod && mix deps.compile

# Sources
COPY priv priv
COPY lib lib

RUN mix compile

# runtime.exs is read at boot, not compile time — copy last so a
# config edit doesn't re-trigger compilation
COPY config/runtime.exs config/

# Overlays (entrypoint script)
COPY rel rel

RUN mix release --overwrite

# ---------- Runtime ----------

FROM ${RUNNER_IMAGE} AS runtime

# chromium: ChromicPDF requires a real Chrome/Chromium binary in
# $PATH for label + BMR PDF generation. Without it the release
# supervision tree crashes at boot with:
#   could not find executable from ["chromium-browser", "chromium", ...]
# fonts-liberation + libnss3 pulled in as chromium's runtime deps.
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends \
        libstdc++6 openssl libncurses6 locales ca-certificates tini \
        chromium fonts-liberation libnss3 && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# UTF-8 locale so PDF/label generation with non-ASCII chars works
RUN sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8

WORKDIR /app

RUN useradd -m -u 1000 -s /bin/bash app && chown app:app /app
USER app

COPY --from=builder --chown=app:app /app/_build/prod/rel/backend ./
COPY --from=builder --chown=app:app /app/rel/entrypoint.sh ./entrypoint.sh

# Force LF line endings + exec bit (defensive if built on macOS)
USER root
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh
USER app

ENV PHX_SERVER=true \
    PORT=4000

EXPOSE 4000

ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
CMD ["/app/bin/backend", "start"]
