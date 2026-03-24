# Local Codex integration

Konceptura now exposes a minimal local change runner on top of the Codex CLI.

## Endpoint

```text
POST /codex/change
```

Request body:

```json
{
  "repo_path": "/home/wniak/konceptura/repos/react-crud-app",
  "prompt": "Add a footer note to the UI.",
  "dry_run": true,
  "use_graph_context": true,
  "bypass_sandbox": true
}
```

Response includes:

- final Codex summary
- whether graph context was injected
- changed files with unified diffs
- command executions reported by Codex

## Setup

Install Codex:

```bash
npm install -g @openai/codex
```

Confirm the binary path:

```bash
npm prefix -g
```

If needed, update [`konceptura.toml`](/home/wniak/konceptura/konceptura.toml):

```toml
[codex]
binary = "/absolute/path/to/codex"
bypass_sandbox_default = true
```

## Machine-specific note

On this host, Codex sandboxed runs currently fail with:

```text
bwrap: Unknown option --argv0
```

That means:

- dry runs can still work if bypass mode is enabled
- real code changes currently require bypass mode

Konceptura surfaces that explicitly in the UI instead of hiding it.
