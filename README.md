# Konceptura MVP

Self-hosted, local-first MVP for code graph inspection and graph-backed code assistance.

## What it does

- Runs Memgraph locally
- Runs `code-graph-rag` locally
- Indexes a repository into a code graph
- Exposes a small Python REST backend
- Exposes a Next.js frontend for indexing, structure browsing, search, and impact analysis
- Can delegate local code changes to the Codex CLI and return diffs plus command traces

## Quick start

Start infrastructure:

```bash
cd /home/wniak/konceptura
docker compose -f infra/docker-compose.yml up -d
```

Install `code-graph-rag` with broad grammar support:

```bash
cd /home/wniak/konceptura/vendor/code-graph-rag
export PATH="$HOME/.local/bin:$PATH"
uv sync --no-dev --extra treesitter-full
```

Install backend dependencies:

```bash
cd /home/wniak/konceptura/backend
export PATH="$HOME/.local/bin:$PATH"
uv sync
```

Install frontend dependencies:

```bash
cd /home/wniak/konceptura/frontend
cp .env.local.example .env.local
pnpm install
```

Install Codex locally:

```bash
npm install -g @openai/codex
```

Run the full local dev stack:

```bash
cd /home/wniak/konceptura
./scripts/dev.sh
```

Open:

```text
http://localhost:3001
```

`./scripts/dev.sh`:

- starts Memgraph if needed
- stops stale frontend/backend processes on `3001` and `8000`
- starts the backend on `8000`
- starts the frontend on `3001`
- prefixes logs so both services can run in one terminal
- stops backend and frontend together on `Ctrl-C`

If you want to run services separately, the old scripts still exist:

```bash
./scripts/run-backend.sh
./scripts/run-frontend.sh
```

## Sample repositories

- Python sample: `repos/sample-app`
- React CRUD sample: `repos/react-crud-app`

The default repo in [`konceptura.toml`](/home/wniak/konceptura/konceptura.toml) is the React CRUD app.

## Smoke check

With the backend running:

```bash
cd /home/wniak/konceptura
./scripts/run-mvp-check.sh
```

## Config

[`konceptura.toml`](/home/wniak/konceptura/konceptura.toml) controls:

- Memgraph connection
- `code-graph-rag` binary path
- Codex CLI binary path
- backend state path
- backend log path
- default repo path
- frontend origins
- sample repo shortcuts

## Codex notes

- The app now exposes `POST /codex/change` through the backend.
- On this machine, Codex's built-in sandbox wrapper fails with `bwrap: Unknown option --argv0`.
- Because of that, real Codex edit runs currently require bypass mode.
- The UI surfaces that as a toggle so the behavior is explicit.
