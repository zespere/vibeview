# Phase 3: Frontend skeleton

## What this builds

A minimal Next.js frontend that talks to the Phase 2 backend.

It includes:

- repository path configuration
- index trigger
- backend/index status view
- simple search or Cypher query form
- results list
- relationship inspector for a selected symbol

## Why now

This is the thinnest UI that proves the backend contract is usable from a browser.

## Install

```bash
cd /home/wniak/konceptura/frontend
cp .env.local.example .env.local
pnpm install
cd ..
```

## Run

Start the backend first:

```bash
cd /home/wniak/konceptura
./scripts/run-backend.sh
```

Then start the frontend:

```bash
cd /home/wniak/konceptura
./scripts/run-frontend.sh
```

The frontend runs at `http://localhost:3001`.

## Verification

```bash
cd /home/wniak/konceptura/frontend
pnpm lint
pnpm build
```
