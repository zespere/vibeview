#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR/backend"
if [[ -d "$HOME/.config/nvm/versions/node" ]]; then
  LATEST_NODE_BIN="$(find "$HOME/.config/nvm/versions/node" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)/bin"
  export PATH="$LATEST_NODE_BIN:$HOME/.local/bin:$PATH"
else
  export PATH="$HOME/.local/bin:$PATH"
fi
exec uv run python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
