#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_ENV="$ROOT_DIR/frontend/.env.local"
FRONTEND_ENV_EXAMPLE="$ROOT_DIR/frontend/.env.local.example"
BACKEND_PORT=8000
FRONTEND_PORT=3001
MEMGRAPH_CONTAINER="vibeview-memgraph"
MEMGRAPH_IMAGE="memgraph/memgraph:latest"
MEMGRAPH_VOLUME="vibeview-memgraph-data"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

check_docker_ready() {
  if timeout 8s docker version >/dev/null 2>&1; then
    return
  fi

  echo "Docker daemon is not responding." >&2
  if command -v systemctl >/dev/null 2>&1; then
    if ! systemctl is-active snapd >/dev/null 2>&1; then
      echo "snapd is not running, so snap-installed Docker cannot work." >&2
      echo "Try:" >&2
      echo "  sudo systemctl restart snapd" >&2
      echo "  sudo systemctl restart snap.docker.dockerd" >&2
      echo "  docker version" >&2
      exit 1
    fi

    if systemctl is-active docker >/dev/null 2>&1; then
      echo "systemd service 'docker' reports active, but the Docker CLI still timed out." >&2
    elif systemctl is-active snap.docker.dockerd >/dev/null 2>&1; then
      echo "Snap Docker service is active, but the Docker CLI still timed out." >&2
    else
      echo "No active Docker daemon service was detected." >&2
      echo "Try one of:" >&2
      echo "  sudo systemctl start docker" >&2
      echo "  sudo systemctl start snap.docker.dockerd" >&2
    fi
  fi
  exit 1
}

start_memgraph() {
  echo "Starting Memgraph..."

  if timeout 10s docker inspect "$MEMGRAPH_CONTAINER" >/dev/null 2>&1; then
    timeout 20s docker start "$MEMGRAPH_CONTAINER" >/dev/null
    return
  fi

  timeout 30s docker run -d \
    --name "$MEMGRAPH_CONTAINER" \
    --platform linux/arm64/v8 \
    -p 7687:7687 \
    -p 7444:7444 \
    -v "$MEMGRAPH_VOLUME:/var/lib/memgraph" \
    "$MEMGRAPH_IMAGE" \
    --also-log-to-stderr=true >/dev/null
}

start_prefixed() {
  local name="$1"
  shift
  (
    cd "$ROOT_DIR"
    "$@" 2>&1 | sed -u "s/^/[$name] /"
  ) &
  PIDS+=("$!")
}

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if ((${#PIDS[@]} > 0)); then
    kill "${PIDS[@]}" >/dev/null 2>&1 || true
    wait "${PIDS[@]}" >/dev/null 2>&1 || true
  fi
  exit "$code"
}

port_pids() {
  local port="$1"
  ss -ltnp "( sport = :$port )" \
    | awk -F'pid=' 'NR > 1 {split($2, a, ","); if (a[1] != "") print a[1]}' \
    | sort -u
}

stop_port() {
  local port="$1"
  mapfile -t pids < <(port_pids "$port")
  if ((${#pids[@]} == 0)); then
    return
  fi

  echo "Stopping existing process on port $port: ${pids[*]}"
  kill "${pids[@]}" >/dev/null 2>&1 || true
  sleep 1

  mapfile -t pids < <(port_pids "$port")
  if ((${#pids[@]} > 0)); then
    kill -9 "${pids[@]}" >/dev/null 2>&1 || true
  fi
}

require_command docker
require_command pnpm
require_command uv
require_command ss
require_command timeout

if [[ ! -f "$FRONTEND_ENV" && -f "$FRONTEND_ENV_EXAMPLE" ]]; then
  cp "$FRONTEND_ENV_EXAMPLE" "$FRONTEND_ENV"
fi

stop_port "$BACKEND_PORT"
stop_port "$FRONTEND_PORT"

check_docker_ready
start_memgraph

declare -a PIDS=()
trap cleanup EXIT INT TERM

echo "Starting backend on http://127.0.0.1:$BACKEND_PORT"
start_prefixed "backend" "$ROOT_DIR/scripts/run-backend.sh"

echo "Starting frontend on http://127.0.0.1:$FRONTEND_PORT"
start_prefixed "frontend" "$ROOT_DIR/scripts/run-frontend.sh"

echo
echo "Vibeview dev is starting:"
echo "  frontend: http://127.0.0.1:$FRONTEND_PORT"
echo "  backend:  http://127.0.0.1:$BACKEND_PORT"
echo "  memgraph: bolt://127.0.0.1:7687"
echo
echo "Press Ctrl-C to stop frontend and backend."

wait -n "${PIDS[@]}"
