#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:8000}"

echo "== status =="
curl -fsS "$BASE_URL/status"
echo
echo

echo "== structure =="
curl -fsS "$BASE_URL/structure"
echo
echo

echo "== impact:create user =="
curl -fsS \
  -X POST "$BASE_URL/assist/impact" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"create user","limit":5}'
echo

echo
echo "== codex:dry-run =="
curl -fsS \
  -X POST "$BASE_URL/codex/change" \
  -H 'Content-Type: application/json' \
  -d '{"repo_path":"/home/wniak/konceptura/repos/react-crud-app","prompt":"Describe the smallest safe change to add a footer note to the UI.","dry_run":true,"use_graph_context":true,"bypass_sandbox":true}'
echo
