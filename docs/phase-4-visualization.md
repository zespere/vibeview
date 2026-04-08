# Phase 4: Basic visualization

## What this builds

A minimal structural view of the indexed repository.

This phase adds:

- `GET /structure` on the backend
- an expandable repo tree in the frontend
- a structure inspector panel for the selected node
- basic outgoing `CALLS` inspection for symbol-backed tree nodes

## Why now

The MVP now has enough backend and frontend surface area to benefit from a dedicated structural view. A tree is the simplest inspectable visualization that stays maintainable.

## Backend

The backend now exposes:

```bash
curl http://127.0.0.1:8000/structure | python3 -m json.tool
```

It uses the currently active indexed repository by default.

## Frontend

Start both services:

```bash
cd vibeview
./scripts/run-backend.sh
./scripts/run-frontend.sh
```

Open:

```text
http://localhost:3001
```

## Verification

```bash
cd backend
export PATH="$HOME/.local/bin:$PATH"
uv run python -m compileall app

cd ../frontend
pnpm lint
pnpm build
```
