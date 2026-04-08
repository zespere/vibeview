# Vibeview

Vibeview is a local-first visual interface for understanding and editing a codebase through canvases, notes, and conversation.
Vibecoded using t3code&GPT 5.4

Thanks you Vitali for making code graph rag
https://github.com/vitali87

## Run locally

Prerequisites:

- `docker`
- `uv`
- `pnpm`
- `@openai/codex`

Start everything:

```bash
./scripts/dev.sh
```

Then open:

```text
http://localhost:3001
```

## What `./scripts/dev.sh` does

- starts Memgraph if needed
- starts the backend on `8000`
- starts the frontend on `3001`
- stops stale local processes on those ports first
