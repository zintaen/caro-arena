#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATIC_FILES=(
  "index.html"
  "style.css"
  "app.js"
  "engine.js"
  "audio.js"
  "multiplayer.js"
  "supabase-config.js"
  "manifest.json"
  "icon.svg"
)

mkdir -p "$ROOT_DIR/docs" "$ROOT_DIR/caro_arena/static"

for f in "${STATIC_FILES[@]}"; do
  cp "$ROOT_DIR/$f" "$ROOT_DIR/docs/$f"
  cp "$ROOT_DIR/$f" "$ROOT_DIR/caro_arena/static/$f"
done

echo "Synced ${#STATIC_FILES[@]} static assets from root -> docs/ and caro_arena/static/."
