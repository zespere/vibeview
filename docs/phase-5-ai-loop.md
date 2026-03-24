# Phase 5: AI interaction loop

## What this builds

A constrained, inspectable assistant action on top of the code graph.

This phase adds:

- `POST /assist/impact`
- ranked symbol matching for natural text search
- graph expansion across `CALLS` and `IMPORTS`
- frontend UI for likely files, matched symbols, and related graph edges

## Why now

The MVP already had indexing, structure browsing, and raw querying. This phase adds one useful code-intelligence action without introducing flows, specs, queues, or hidden orchestration.

## Backend

Run impact analysis directly:

```bash
curl -X POST http://127.0.0.1:8000/assist/impact \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"create user","limit":5}' | python3 -m json.tool
```

The response includes:

- matched seed symbols
- related symbols reached through graph edges
- likely affected files

## Frontend

The frontend now exposes an `Impact analysis` panel where you can:

- enter a change request
- inspect matched symbols
- inspect likely files
- trace why each result was suggested
