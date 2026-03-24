# Phase 2: Backend skeleton

## What this builds

A single local Python service that sits on top of Memgraph and Code-Graph-RAG.

It exposes:

- `POST /index`
- `GET /status`
- `GET /symbols`
- `GET /relationships`
- `POST /query`

## Why now

This gives the frontend a stable backend contract before we build UI screens.

## Install

```bash
cd /home/wniak/konceptura/backend
export PATH="$HOME/.local/bin:$PATH"
uv sync
cd ..
```

## Run

```bash
scripts/run-backend.sh
```

The API will be available at `http://localhost:8000`.

## Example requests

Get backend status:

```bash
curl http://localhost:8000/status | python3 -m json.tool
```

Trigger indexing:

```bash
curl -X POST http://localhost:8000/index \
  -H 'Content-Type: application/json' \
  -d '{"repo_path":"/home/wniak/konceptura/repos/sample-app","clean":true}' | python3 -m json.tool
```

`clean=true` is safe here because the backend removes the Code-Graph-RAG hash cache before rebuilding.

List symbols:

```bash
curl 'http://localhost:8000/symbols?q=user&limit=10' | python3 -m json.tool
```

Get call relationships:

```bash
curl 'http://localhost:8000/relationships?qualified_name=sample-app.app.main&relationship=CALLS&direction=outgoing' | python3 -m json.tool
```

Run a simple backend query:

```bash
curl -X POST http://localhost:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"text":"create_user","limit":10}' | python3 -m json.tool
```

Run a direct Cypher query:

```bash
curl -X POST http://localhost:8000/query \
  -H 'Content-Type: application/json' \
  -d '{"cypher":"MATCH (n:Function) RETURN n.qualified_name AS qualified_name LIMIT 10"}' | python3 -m json.tool
```
