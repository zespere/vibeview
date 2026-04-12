# Local Pi integration

Vibeview runs local agent changes through the Pi CLI in RPC mode.

## Install Pi

```bash
npm install -g @mariozechner/pi-coding-agent
```

Then authenticate Pi with your provider before using build, plan, or ask flows.

## Config

`vibeview.toml`:

```toml
[agent]
name = "pi"
binary = "pi"
```

Optional fields:

```toml
[agent]
provider = "openai"
model = "gpt-5.4"
reasoning_default = "medium"
```

## Dry-run smoke test

```bash
./scripts/run-mvp-check.sh
```

That calls `POST /agent/change` with `dry_run=true` and verifies the local Pi integration is reachable.
