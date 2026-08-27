# Default Superset workspace sandbox image.
#
# Contract (what host-service's sandbox runtime expects of ANY image used
# as `sandbox.image`):
#   - /bin/bash present (terminals launch bash --rcfile /opt/superset/bash/rcfile)
#   - git, curl, ca-certificates on PATH (isolated git dir + agent hooks)
#   - a `sleep` binary (PID 1 keepalive; docker --init provides the reaper)
#
# Everything else (agent CLIs, language runtimes) is convenience for the
# default image; projects can substitute their own image via sandbox.image.

FROM node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION=latest
ARG CODEX_VERSION=latest
ARG OPENCODE_VERSION=latest
ARG GEMINI_CLI_VERSION=latest
ARG AMP_VERSION=latest
ARG COPILOT_VERSION=latest
ARG MASTRACODE_VERSION=latest

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       git \
       jq \
       openssh-client \
       procps \
       ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Every Superset-supported agent CLI with an official npm distribution.
# Not npm-distributed (bring your own via sandbox.image + config mounts):
# droid/Factory and cursor-agent (curl installers), kimi, grok, vibe, pi/omp.
RUN npm install -g \
       bun \
       "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
       "@openai/codex@${CODEX_VERSION}" \
       "opencode-ai@${OPENCODE_VERSION}" \
       "@google/gemini-cli@${GEMINI_CLI_VERSION}" \
       "@sourcegraph/amp@${AMP_VERSION}" \
       "@github/copilot@${COPILOT_VERSION}" \
       "mastracode@${MASTRACODE_VERSION}" \
    && npm cache clean --force

# Host worktrees bind-mount at arbitrary paths with host ownership; git
# must not refuse them inside the sandbox.
RUN git config --system safe.directory "*"

WORKDIR /root

CMD ["sleep", "infinity"]
