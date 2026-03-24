#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 '<cypher query>'" >&2
  exit 1
fi

printf '%s\n' "$1" | docker exec -i konceptura-memgraph mgconsole --output_format=csv
