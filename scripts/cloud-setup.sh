#!/usr/bin/env bash
# One-time setup for a Claude Code cloud session (or any fresh Linux box):
# Node 22 + pnpm (version from package.json) + dependencies, and Google Chrome
# for the end-to-end tests. Safe to run again. Optional parts warn instead of
# failing, so a session can still edit code and run unit tests without Chrome.
#
#   bash scripts/cloud-setup.sh
#
# Needs network access to the npm registry; Chrome needs dl.google.com.
set -uo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n==> %s\n' "$*"; }
warn() { printf '\n!!  %s\n' "$*" >&2; }
SUDO=""; [ "$(id -u)" != 0 ] && command -v sudo >/dev/null && SUDO="sudo"

say "Node"
major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$major" -lt 22 ]; then
  warn "Node $major found; ProdLi needs Node 22+. Trying to install Node 22 (NodeSource)…"
  if curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash - && $SUDO apt-get install -y nodejs; then
    major="$(node -p 'process.versions.node.split(".")[0]')"
  else
    warn "Couldn't install Node 22. Install it, then run this script again."; exit 1
  fi
fi
node -v

say "pnpm"
want="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
if [ "$(pnpm -v 2>/dev/null)" != "$want" ]; then
  corepack enable >/dev/null 2>&1 && corepack prepare "pnpm@$want" --activate >/dev/null 2>&1 || npm install -g "pnpm@$want" >/dev/null
fi
pnpm -v || { warn "pnpm isn't available."; exit 1; }

say "Dependencies"
pnpm install --frozen-lockfile || { warn "pnpm install failed."; exit 1; }

say "Google Chrome (end-to-end tests)"
chrome="${CHROME_PATH:-}"
for c in /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser; do [ -z "$chrome" ] && [ -x "$c" ] && chrome="$c"; done
if [ -z "$chrome" ] && command -v apt-get >/dev/null; then
  deb="$(mktemp -d)/chrome.deb"
  if curl -fsSL -o "$deb" https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb; then
    $SUDO apt-get update -qq >/dev/null 2>&1
    $SUDO apt-get install -y -qq "$deb" >/dev/null 2>&1 && chrome=/usr/bin/google-chrome
  fi
fi
if [ -n "$chrome" ]; then
  "$chrome" --version 2>/dev/null || true
  echo "Run the end-to-end tests with: CI=1 CHROME_PATH=$chrome pnpm --filter @workspace/prodli test:e2e"
else
  warn "No Chrome: end-to-end tests can't run here (CI runs them on every pull request)."
fi

say "Ready"
echo "Type check: pnpm run typecheck · Unit tests: pnpm test · Guide: CLAUDE.md"
