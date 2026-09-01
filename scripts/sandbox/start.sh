#!/bin/bash
# Brings a freshly created sandbox to serving. Everything expensive already
# happened at image build time — the repo is cloned, node_modules installed,
# host.db carries the schema — so this is per-workspace work only and takes a
# second or two.
#
# Started once, fire-and-forget, right after the sandbox is created. It is not
# the image's ENTRYPOINT on purpose: that slot belongs to Blaxel's sandbox-api,
# which serves /process, /fs and the preview routes, and overriding it leaves a
# sandbox nothing can talk to.
set -uo pipefail

WORKSPACE="${SUPERSET_SANDBOX_WORKSPACE_PATH:-/workspace}"
BRANCH="${SUPERSET_SANDBOX_BRANCH:-}"
REPO_URL="${SUPERSET_SANDBOX_REPO_URL:-}"

# The platform injects its own PORT into the sandbox environment, which beats
# the image's ENV. host-service reads PORT, so without this it tries to bind 80
# — reserved here, along with 443 and 8080 — and exits with EADDRINUSE.
export PORT="${SUPERSET_SANDBOX_HOST_PORT:-4879}"

# The schema is baked, so first boot has nothing to migrate. Copied rather than
# used in place because /data is where a persistent volume would mount.
mkdir -p /data
if [ ! -f /data/host.db ] && [ -f /app/host.db.template ]; then
  cp /app/host.db.template /data/host.db
fi

# The image carries no repository, so a workspace normally clones on first
# boot. An environment forked from a configured sandbox may already have one:
# when its origin matches what the workspace wants, moving to the branch is a
# one-ref fetch against objects that are already local, and when it doesn't the
# baked objects are useless and it clones instead.
#
# Getting this wrong is silent rather than loud: fetching the requested branch
# from the wrong origin leaves a sandbox serving somebody else's code, so the
# URLs are compared rather than assumed to match.
#
# Both branches below are destructive to work in progress: the clone path wipes
# the directory, and the fetch path moves the branch onto the remote's head,
# which orphans commits an agent made and hadn't pushed. That was survivable
# only because nothing ever ran this script twice. It now restarts — the
# provider restarts it on failure, and updating host-service re-runs it — so
# the repository bootstrap is fenced behind a marker and every later run falls
# straight through to serving.
#
# The marker is written only after the bootstrap succeeds, so a run interrupted
# midway retries on the next start rather than leaving a half-checked-out
# workspace nothing will ever repair.
BOOTSTRAP_MARKER=/data/.workspace-bootstrapped

if [ -n "$REPO_URL" ] && [ ! -f "$BOOTSTRAP_MARKER" ]; then
  BAKED_URL=$(git -C "$WORKSPACE" remote get-url origin 2>/dev/null || echo "")
  if [ -n "${SUPERSET_SANDBOX_GIT_TOKEN:-}" ]; then
    export GIT_ASKPASS=/app/git-askpass.sh
  fi
  if [ "$BAKED_URL" = "$REPO_URL" ] && [ -d "$WORKSPACE/.git" ]; then
    (
      cd "$WORKSPACE" || exit 1
      git fetch --depth 1 origin "$BRANCH" >/dev/null 2>&1 &&
        git checkout -q -B "$BRANCH" FETCH_HEAD >/dev/null 2>&1
    ) && touch "$BOOTSTRAP_MARKER"
  else
    rm -rf "$WORKSPACE"
    if git clone --depth 1 --single-branch --branch "$BRANCH" "$REPO_URL" "$WORKSPACE" \
      >/dev/null 2>&1 ||
      git clone --depth 1 "$REPO_URL" "$WORKSPACE" >/dev/null 2>&1; then
      touch "$BOOTSTRAP_MARKER"
    fi
  fi
  unset GIT_ASKPASS
fi

cd /app
exec node host-service.js
