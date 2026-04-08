# Phase 1: Foundation setup

## Folder structure

```text
vibeview/
├── docs/
├── infra/
│   └── docker-compose.yml
├── repos/
│   └── sample-app/
├── scripts/
│   └── query-memgraph.sh
└── vendor/
```

## Why this layout

- `infra/` holds local infrastructure only.
- `vendor/` holds third-party code we do not own, starting with `code-graph-rag`.
- `repos/` holds target repositories for local testing.
- `scripts/` holds repeatable shell entrypoints we can later call from the backend.
- `docs/` keeps the setup runnable without reading source code.

## Commands

### 1. Install local prerequisites

```bash
sudo apt-get update
sudo apt-get install -y cmake ripgrep
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Open a new shell after installing `uv`, or run:

```bash
export PATH="$HOME/.local/bin:$PATH"
uv python install 3.12
```

### 2. Start Memgraph

```bash
docker compose -f infra/docker-compose.yml up -d
docker ps --filter name=vibeview-memgraph
```

Memgraph Lab will be available at `http://localhost:3000`.

If you are on ARM and Memgraph exits immediately, keep the explicit `platform: linux/arm64/v8` line in [`infra/docker-compose.yml`](../infra/docker-compose.yml).

### 3. Install Code-Graph-RAG

```bash
git clone https://github.com/vitali87/code-graph-rag.git vendor/code-graph-rag
cd vendor/code-graph-rag
uv sync --no-dev
cd ../..
```

### 4. Index the sample repository

```bash
rm -f repos/sample-app/.cgr-hash-cache.json
vendor/code-graph-rag/.venv/bin/cgr start \
  --repo-path repos/sample-app \
  --update-graph \
  --clean
```

### 5. Verify the graph

List parsed files:

```bash
scripts/query-memgraph.sh 'MATCH (f:File) RETURN f.path ORDER BY f.path;'
```

List parsed functions:

```bash
scripts/query-memgraph.sh 'MATCH (n:Function) RETURN n.qualified_name ORDER BY n.qualified_name;'
```

List parsed methods:

```bash
scripts/query-memgraph.sh 'MATCH (n:Method) RETURN n.qualified_name ORDER BY n.qualified_name;'
```

Show the calls from `sample-app.app.main`:

```bash
scripts/query-memgraph.sh 'MATCH (src:Function {qualified_name: "sample-app.app.main"})-[r:CALLS]->(dst) RETURN type(r), labels(dst)[0], coalesce(dst.qualified_name, dst.name) ORDER BY labels(dst)[0], coalesce(dst.qualified_name, dst.name);'
```
