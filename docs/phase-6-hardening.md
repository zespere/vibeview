# Phase 6: Hardening the MVP

## What this builds

The minimum operational polish needed for a local-first single-user MVP.

This phase adds:

- root config file: [`konceptura.toml`](/home/wniak/konceptura/konceptura.toml)
- backend file logging
- dry-run support for `POST /index`
- Codex CLI binary config
- sample repo shortcuts surfaced through `GET /status`
- smoke-check script: [`scripts/run-mvp-check.sh`](/home/wniak/konceptura/scripts/run-mvp-check.sh)

## Why now

At this point the system works. Hardening keeps it understandable and easier to operate locally without changing the architecture.

## Commands

Preview an index command without running it:

```bash
curl -X POST http://127.0.0.1:8000/index \
  -H 'Content-Type: application/json' \
  -d '{"repo_path":"/home/wniak/konceptura/repos/react-crud-app","clean":true,"dry_run":true}' \
  | python3 -m json.tool
```

Run the backend smoke check:

```bash
cd /home/wniak/konceptura
./scripts/run-mvp-check.sh
```

Inspect backend logs:

```bash
tail -n 50 /home/wniak/konceptura/backend/data/konceptura.log
```
