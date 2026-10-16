#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATIC_FILES=(
  "index.html"
  "style.css"
  "css/base.css"
  "css/arena.css"
  "css/lobby.css"
  "css/modals.css"
  "app.js"
  "engine.js"
  "audio.js"
  "multiplayer.js"
  "supabase-config.js"
  "js/core/board.js"
  "js/core/evaluator.js"
  "js/core/agents.js"
  "js/core/storage.js"
  "js/services/local-channel.js"
  "js/services/auth-wallet.js"
  "js/ui/board-renderer.js"
  "js/ui/camera-input.js"
  "js/ui/lobby-ui.js"
  "js/ui/replay-ui.js"
  "js/ui/multiplayer-ui.js"
  "js/ui/auth-ui.js"
  "manifest.json"
  "icon.svg"
)

mkdir -p "$ROOT_DIR/docs" "$ROOT_DIR/caro_arena/static"

for f in "${STATIC_FILES[@]}"; do
  mkdir -p "$(dirname "$ROOT_DIR/docs/$f")" "$(dirname "$ROOT_DIR/caro_arena/static/$f")"
  cp "$ROOT_DIR/$f" "$ROOT_DIR/docs/$f"
  cp "$ROOT_DIR/$f" "$ROOT_DIR/caro_arena/static/$f"
done

echo "Synced ${#STATIC_FILES[@]} static assets from root -> docs/ and caro_arena/static/."
