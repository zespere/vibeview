from __future__ import annotations

import os
import shutil
import subprocess
import tomllib
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG_PATH = WORKSPACE_ROOT / "vibeview.toml"


class Settings(BaseModel):
    workspace_root: Path = WORKSPACE_ROOT
    config_path: Path = DEFAULT_CONFIG_PATH
    memgraph_uri: str = "bolt://localhost:7687"
    memgraph_username: str = ""
    memgraph_password: str = ""
    cgr_binary: Path = WORKSPACE_ROOT / "vendor" / "code-graph-rag" / ".venv" / "bin" / "cgr"
    codex_binary: Path | None = None
    codex_model: str | None = None
    codex_bypass_sandbox_default: bool = True
    state_path: Path = WORKSPACE_ROOT / "backend" / "data" / "state.json"
    canvas_path: Path = WORKSPACE_ROOT / "backend" / "data" / "canvas.json"
    project_path: Path = WORKSPACE_ROOT / "backend" / "data" / "project.json"
    log_path: Path = WORKSPACE_ROOT / "backend" / "data" / "vibeview.log"
    log_level: str = "INFO"
    default_repo_path: Path = WORKSPACE_ROOT / "repos" / "react-crud-app"
    frontend_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3001", "http://127.0.0.1:3001"]
    )
    sample_repos: dict[str, Path] = Field(
        default_factory=lambda: {
            "sample-python": WORKSPACE_ROOT / "repos" / "sample-app",
            "react-crud": WORKSPACE_ROOT / "repos" / "react-crud-app",
        }
    )


def _resolve_path(value: str | Path, workspace_root: Path) -> Path:
    path = value if isinstance(value, Path) else Path(value)
    return path if path.is_absolute() else workspace_root / path


def _read_config_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("rb") as handle:
        return tomllib.load(handle)


def _discover_codex_binary() -> Path | None:
    direct = shutil.which("codex")
    if direct:
        return Path(direct)

    npm_binary = shutil.which("npm")
    if not npm_binary:
        return None

    try:
        result = subprocess.run(
            [npm_binary, "prefix", "-g"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None

    prefix = result.stdout.strip()
    if not prefix:
        return None

    candidate = Path(prefix) / "bin" / "codex"
    return candidate if candidate.exists() else None


def load_settings() -> Settings:
    workspace_root = WORKSPACE_ROOT
    config_path = Path(os.getenv("VIBEVIEW_CONFIG", DEFAULT_CONFIG_PATH))
    raw = _read_config_file(config_path)

    app_cfg = raw.get("app", {})
    memgraph_cfg = raw.get("memgraph", {})
    code_graph_cfg = raw.get("code_graph", {})
    codex_cfg = raw.get("codex", {})
    repos_cfg = raw.get("repos", {})

    sample_repos = {
        key: _resolve_path(str(value), workspace_root)
        for key, value in repos_cfg.items()
    }

    settings = Settings(
        workspace_root=workspace_root,
        config_path=config_path,
        memgraph_uri=os.getenv("VIBEVIEW_MEMGRAPH_URI", memgraph_cfg.get("uri", "bolt://localhost:7687")),
        memgraph_username=os.getenv(
            "VIBEVIEW_MEMGRAPH_USERNAME",
            memgraph_cfg.get("username", ""),
        ),
        memgraph_password=os.getenv(
            "VIBEVIEW_MEMGRAPH_PASSWORD",
            memgraph_cfg.get("password", ""),
        ),
        cgr_binary=_resolve_path(
            code_graph_cfg.get("binary", "vendor/code-graph-rag/.venv/bin/cgr"),
            workspace_root,
        ),
        codex_binary=_resolve_path(codex_cfg["binary"], workspace_root)
        if codex_cfg.get("binary")
        else _discover_codex_binary(),
        codex_model=codex_cfg.get("model"),
        codex_bypass_sandbox_default=bool(codex_cfg.get("bypass_sandbox_default", True)),
        state_path=_resolve_path(
            app_cfg.get("state_path", "backend/data/state.json"),
            workspace_root,
        ),
        canvas_path=_resolve_path(
            app_cfg.get("canvas_path", "backend/data/canvas.json"),
            workspace_root,
        ),
        project_path=_resolve_path(
            app_cfg.get("project_path", "backend/data/project.json"),
            workspace_root,
        ),
        log_path=_resolve_path(
            app_cfg.get("log_path", "backend/data/vibeview.log"),
            workspace_root,
        ),
        log_level=os.getenv(
            "VIBEVIEW_LOG_LEVEL",
            app_cfg.get("log_level", "INFO"),
        ),
        default_repo_path=_resolve_path(
            app_cfg.get("default_repo_path", "repos/react-crud-app"),
            workspace_root,
        ),
        frontend_origins=list(
            app_cfg.get(
                "frontend_origins",
                ["http://localhost:3001", "http://127.0.0.1:3001"],
            )
        ),
        sample_repos=sample_repos
        or {
            "sample-python": workspace_root / "repos" / "sample-app",
            "react-crud": workspace_root / "repos" / "react-crud-app",
        },
    )
    return settings


settings = load_settings()
