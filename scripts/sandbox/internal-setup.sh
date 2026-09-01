#!/bin/bash
# Everything that makes a sandbox ours rather than the one we ship to everyone.
#
# Run against a fork of the published image, which is then promoted to an
# environment — the same path a customer takes, so the rough edges in it are
# ours to feel first. Nothing here belongs in the product image: it is taste,
# and a customer's taste is their own.
#
# Idempotent: re-running against an already-configured fork changes nothing.
set -uo pipefail

log() { printf '[internal-setup] %s\n' "$1"; }

CONFIG_REPO="${SUPERSET_INTERNAL_CONFIG_REPO:-https://github.com/saddlepaddle/config.git}"
CONFIG_DIR="$HOME/code/config"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# neovim because config.zsh aliases vim to nvim; silversearcher-ag because it
# aliases ag with a fixed ignore list; fzf and tmux are used directly.
apt-get install -y -qq --no-install-recommends \
  zsh tmux fzf silversearcher-ag neovim >/dev/null
log "shell tooling installed"

# Electron's shared libraries — roughly 400 MB, and ours alone: nobody else
# develops an Electron app, so this stays out of the image every customer gets.
# The virtual display and VNC server it renders into are in the base image,
# because a GUI pane is a product capability rather than our taste.
#
# Electron also needs --no-sandbox here: Chromium's sandbox wants user
# namespaces, which this container does not grant. Verified — it creates a
# window with the flag and refuses without it.
apt-get install -y -qq --no-install-recommends \
  libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils \
  libatspi2.0-0 libsecret-1-0 libgbm1 libasound2 libdrm2 libxkbcommon0 \
  >/dev/null 2>&1 && log "electron runtime libraries installed" \
  || log "electron libraries failed (desktop dev will not start)"

if [ ! -d "$HOME/.oh-my-zsh" ]; then
  # config.zsh sources $ZSH/oh-my-zsh.sh, so this is a hard dependency of it
  # rather than a preference.
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" \
    "" --unattended >/dev/null 2>&1
  log "oh-my-zsh installed"
fi

if [ -d "$CONFIG_DIR/.git" ]; then
  git -C "$CONFIG_DIR" pull --ff-only >/dev/null 2>&1 && log "config repo updated"
else
  mkdir -p "$(dirname "$CONFIG_DIR")"
  git clone --depth 1 "$CONFIG_REPO" "$CONFIG_DIR" >/dev/null 2>&1 &&
    log "config repo cloned"
fi

# config.zsh lists these in `plugins=(…)`; they are not bundled with oh-my-zsh,
# and a missing one is a warning on every shell start rather than a failure, so
# it goes unnoticed until someone reads the scrollback.
ZSH_CUSTOM="$HOME/.oh-my-zsh/custom"
for plugin in zsh-autosuggestions zsh-syntax-highlighting; do
  if [ ! -d "$ZSH_CUSTOM/plugins/$plugin" ]; then
    git clone --depth 1 "https://github.com/zsh-users/$plugin" \
      "$ZSH_CUSTOM/plugins/$plugin" >/dev/null 2>&1 && log "$plugin installed"
  fi
done

# Themes the config repo carries. `jatin` is not an oh-my-zsh theme — upstream
# has never shipped it — so a prompt that works on a laptop only works here once
# the theme file is committed alongside the config that names it.
if [ -d "$CONFIG_DIR/zsh/themes" ]; then
  mkdir -p "$ZSH_CUSTOM/themes"
  cp "$CONFIG_DIR"/zsh/themes/*.zsh-theme "$ZSH_CUSTOM/themes/" 2>/dev/null &&
    log "themes installed from config repo"
fi

# The real ~/.zshrc is machine-specific and stays on the laptop; the portable
# half lives in the repo and is all a sandbox needs. `gt` resolves the monorepo
# from SUPERSET_WORKSPACE_PATH, which host-service already sets on every
# terminal it opens, so nothing here has to know the checkout path.
if ! grep -qs "code/config/zsh/config.zsh" "$HOME/.zshrc" 2>/dev/null; then
  cat >> "$HOME/.zshrc" <<'ZRC'
export ZSH="$HOME/.oh-my-zsh"
[ -f "$HOME/code/config/zsh/config.zsh" ] && source "$HOME/code/config/zsh/config.zsh"
ZRC
  log ".zshrc wired to config repo"
fi

if command -v zsh >/dev/null && [ "$(getent passwd root | cut -d: -f7)" != "$(command -v zsh)" ]; then
  chsh -s "$(command -v zsh)" root
  log "login shell set to zsh"
fi

# The monorepo, warmed. This used to live in the published image, where it
# shipped our code to every customer and re-cloned on each build. Here it costs
# only us: an environment promoted from this fork carries the objects, so our
# workspaces still get a one-ref fetch instead of a cold clone, and a customer's
# image stays 230 MiB lighter.
#
# --no-checkout because start.sh checks out the workspace's own branch; a
# blobless clone keeps the transfer small while leaving the history usable.
WORKSPACE="${SUPERSET_SANDBOX_WORKSPACE_PATH:-/workspace}"
MONOREPO="${SUPERSET_INTERNAL_MONOREPO_URL:-https://github.com/superset-sh/superset.git}"
if [ ! -d "$WORKSPACE/.git" ]; then
  mkdir -p "$WORKSPACE"
  if git clone --filter=blob:none --no-checkout "$MONOREPO" "$WORKSPACE" >/dev/null 2>&1; then
    git -C "$WORKSPACE" checkout main >/dev/null 2>&1
    log "monorepo warmed at $WORKSPACE"
  else
    log "monorepo clone failed (workspace will clone on first boot)"
  fi
fi

# Dependencies, warmed. `bun install` on this monorepo is minutes and hundreds
# of megabytes, which is tolerable once when the environment is built and
# intolerable on every workspace that forks from it.
#
# Skipped when node_modules already exists so a re-run costs nothing.
if [ -d "$WORKSPACE/.git" ] && [ ! -d "$WORKSPACE/node_modules" ]; then
  if command -v bun >/dev/null; then
    log "installing dependencies (several minutes)"
    if (cd "$WORKSPACE" && bun install --frozen-lockfile >/dev/null 2>&1); then
      log "dependencies installed"
    else
      log "bun install failed — run it by hand in the workspace"
    fi
  else
    log "bun not found; skipping dependency install"
  fi
fi

log "done"
