from __future__ import annotations

import difflib
import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import settings
from .models import (
    ChangedFileRecord,
    CodexChangeResponse,
    CodexCommandRecord,
    GeneratedCanvasEdge,
    GeneratedCanvasNode,
)
from .services import GraphService, _clean_log_output

logger = logging.getLogger(__name__)

IGNORED_DIR_NAMES = {
    ".git",
    ".next",
    ".venv",
    "__pycache__",
    "build",
    "coverage",
    "dist",
    "node_modules",
}
MAX_SNAPSHOT_BYTES = 250_000


@dataclass
class _SnapshotFile:
    path: str
    content: str


class CodexService:
    def __init__(self, graph_service: GraphService) -> None:
        self.graph_service = graph_service

    def is_available(self) -> bool:
        return bool(settings.codex_binary and settings.codex_binary.exists())

    def run_change(
        self,
        repo_path: str,
        prompt: str,
        dry_run: bool,
        use_graph_context: bool,
        bypass_sandbox: bool | None,
        semantic_context: str | None,
    ) -> CodexChangeResponse:
        if not self.is_available():
            raise RuntimeError("Codex CLI is not available. Check codex.binary in konceptura.toml.")

        repo_dir = Path(repo_path)
        before = self._snapshot_repo(repo_dir)

        graph_context_summary = None
        final_prompt = prompt.strip()
        context_blocks: list[str] = []
        if semantic_context:
            context_blocks.append(
                "Use this semantic workspace context when planning and editing:\n"
                f"{semantic_context.strip()}"
            )
        if use_graph_context:
            try:
                impact = self.graph_service.analyze_impact(prompt, limit=5)
            except Exception:
                logger.exception("Failed to build graph context for Codex change run")
                graph_context_summary = "Graph context unavailable; proceeding without code-graph hints."
            else:
                graph_context_summary = impact.summary
                context_lines = [impact.summary]
                if impact.affected_files:
                    context_lines.append("Likely files:")
                    context_lines.extend(f"- {item.path}" for item in impact.affected_files[:5])
                if impact.seeds:
                    context_lines.append("Seed symbols:")
                    context_lines.extend(
                        f"- {seed.symbol.properties.get('qualified_name') or seed.symbol.properties.get('path')}"
                        for seed in impact.seeds[:5]
                    )
                context_blocks.append(
                    "Use this code-graph context when deciding what to inspect or change.\n"
                    + "\n".join(context_lines)
                )

        if context_blocks:
            final_prompt = "\n\n".join(context_blocks) + f"\n\nTask:\n{prompt.strip()}"

        if dry_run:
            final_prompt += (
                "\n\nDo not modify files. Inspect the repo and explain the exact changes you would make."
            )

        bypass = settings.codex_bypass_sandbox_default if bypass_sandbox is None else bypass_sandbox
        command = self._build_command(repo_dir, final_prompt, dry_run, bypass)
        logger.info("Starting Codex change run for %s", repo_path)
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
        events = self._parse_jsonl_output(result.stdout)
        commands = self._collect_command_records(events)
        summary = self._last_agent_message(events) or _clean_log_output(result.stdout or result.stderr)

        after = self._snapshot_repo(repo_dir)
        changed_files = [] if dry_run else self._build_changed_files(before, after)

        if result.returncode != 0:
            error_tail = _clean_log_output(result.stderr or result.stdout)
            summary = error_tail or summary or "Codex run failed."

        return CodexChangeResponse(
            repo_path=str(repo_dir),
            prompt=prompt,
            summary=summary,
            dry_run=dry_run,
            used_graph_context=use_graph_context,
            bypass_sandbox=bypass,
            codex_binary=str(settings.codex_binary),
            codex_model=settings.codex_model,
            graph_context_summary=graph_context_summary,
            changed_files=changed_files,
            commands=commands,
            raw_event_count=len(events),
        )

    def build_project(
        self,
        repo_path: str,
        prompt: str,
        semantic_context: str | None,
    ) -> CodexChangeResponse:
        implementation_prompt = (
            "Implement the user's request directly in the repository.\n"
            "Make real file changes when they are needed.\n"
            "If the repository is empty or effectively empty, scaffold the smallest practical web app that satisfies the request.\n"
            "Prefer a simple local-first web stack already implied by the repository. If there is no stack yet, choose the minimum practical setup.\n"
            "Do not modify files inside .konceptura/. The system manages that workspace metadata.\n"
            "Do not stop at a plan. Write the code.\n\n"
            f"User request:\n{prompt.strip()}"
        )
        return self.run_change(
            repo_path=repo_path,
            prompt=implementation_prompt,
            dry_run=False,
            use_graph_context=True,
            bypass_sandbox=None,
            semantic_context=semantic_context,
        )

    def generate_architecture_notes(
        self,
        repo_path: str,
        prompt: str,
    ) -> tuple[list[GeneratedCanvasNode], list[GeneratedCanvasEdge], str]:
        if not self.is_available():
            nodes = self._fallback_architecture_notes(prompt)
            return nodes, [], f"Created {len(nodes)} architecture notes from the prompt."

        repo_dir = Path(repo_path)
        generation_prompt = (
            "You are mapping product architecture into editable workspace notes.\n"
            "Inspect the repository and the user prompt, then return JSON only.\n"
            "Do not modify files.\n\n"
            "Return exactly this shape:\n"
            '{\n'
            '  "summary": "short plain sentence",\n'
            '  "nodes": [\n'
            '    {\n'
            '      "title": "string",\n'
            '      "description": "2-4 sentence note about responsibility and behavior",\n'
            '      "tags": ["feature"],\n'
            '      "linked_files": ["src/app.tsx"],\n'
            '      "linked_symbols": ["app.main"]\n'
            '    }\n'
            '  ],\n'
            '  "edges": [\n'
            '    {\n'
            '      "source_title": "string",\n'
            '      "target_title": "string",\n'
            '      "label": "drives"\n'
            '    }\n'
            "  ]\n"
            "}\n\n"
            "Rules:\n"
            "- 3 to 6 nodes only.\n"
            "- Titles must be short and human-readable.\n"
            "- Focus on app architecture, features, screens, state, and data flow.\n"
            "- If the repo is empty, propose a sensible first-pass architecture for the prompt.\n"
            "- JSON only. No markdown fences.\n\n"
            f"User prompt:\n{prompt.strip()}\n"
        )
        command = self._build_command(repo_dir, generation_prompt, True, True)
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        events = self._parse_jsonl_output(result.stdout)
        raw_text = self._last_agent_message(events) or _clean_log_output(result.stdout or result.stderr)
        payload = self._extract_json_object(raw_text)
        if payload is None:
            nodes = self._fallback_architecture_notes(prompt)
            return nodes, [], f"Created {len(nodes)} architecture notes from the prompt."

        try:
            node_items = [
                GeneratedCanvasNode.model_validate(item)
                for item in payload.get("nodes", [])
            ]
            edge_items = [
                GeneratedCanvasEdge.model_validate(item)
                for item in payload.get("edges", [])
            ]
        except Exception:
            nodes = self._fallback_architecture_notes(prompt)
            return nodes, [], f"Created {len(nodes)} architecture notes from the prompt."

        node_items = node_items[:6]
        summary = str(payload.get("summary") or f"Created {len(node_items)} architecture notes.").strip()
        if not node_items:
            node_items = self._fallback_architecture_notes(prompt)
            edge_items = []
            summary = f"Created {len(node_items)} architecture notes from the prompt."
        return node_items, edge_items, summary

    def suggest_commit_message(
        self,
        repo_path: str,
        status_text: str,
        diff_text: str,
    ) -> str:
        fallback = self._fallback_commit_message(status_text, diff_text)
        if not self.is_available():
            return fallback

        repo_dir = Path(repo_path)
        prompt = (
            "Read the git status and diff summary, then return exactly one concise conventional-style commit message.\n"
            "Requirements:\n"
            "- one line only\n"
            "- lower case after the type prefix\n"
            "- no quotes\n"
            "- prefer prefixes like feat, fix, refactor, chore, docs, style\n\n"
            f"Git status:\n{status_text.strip() or '(empty)'}\n\n"
            f"Git diff summary:\n{diff_text.strip() or '(empty)'}\n"
        )
        command = self._build_command(repo_dir, prompt, True, True)
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        events = self._parse_jsonl_output(result.stdout)
        raw_text = self._last_agent_message(events) or _clean_log_output(result.stdout or result.stderr)
        candidate = raw_text.strip().splitlines()[0].strip() if raw_text.strip() else ""
        if not candidate:
            return fallback
        candidate = candidate.strip("`").strip()
        if len(candidate) > 96:
            candidate = candidate[:96].rstrip()
        return candidate or fallback

    def _build_command(
        self,
        repo_dir: Path,
        prompt: str,
        dry_run: bool,
        bypass_sandbox: bool,
    ) -> list[str]:
        assert settings.codex_binary is not None
        command = [
            str(settings.codex_binary),
            "exec",
            "-C",
            str(repo_dir),
            "--skip-git-repo-check",
            "--json",
        ]
        if settings.codex_model:
            command.extend(["-m", settings.codex_model])
        if bypass_sandbox:
            command.append("--dangerously-bypass-approvals-and-sandbox")
        else:
            command.extend(["--sandbox", "read-only" if dry_run else "workspace-write"])
        command.append(prompt)
        return command

    def _snapshot_repo(self, repo_dir: Path) -> dict[str, _SnapshotFile]:
        snapshot: dict[str, _SnapshotFile] = {}
        for path in repo_dir.rglob("*"):
            if not path.is_file():
                continue
            if any(part in IGNORED_DIR_NAMES for part in path.relative_to(repo_dir).parts):
                continue
            try:
                if path.stat().st_size > MAX_SNAPSHOT_BYTES:
                    continue
                content = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            relative_path = str(path.relative_to(repo_dir))
            snapshot[relative_path] = _SnapshotFile(path=relative_path, content=content)
        return snapshot

    def _build_changed_files(
        self,
        before: dict[str, _SnapshotFile],
        after: dict[str, _SnapshotFile],
    ) -> list[ChangedFileRecord]:
        changed: list[ChangedFileRecord] = []
        all_paths = sorted(set(before) | set(after))
        for path in all_paths:
            before_file = before.get(path)
            after_file = after.get(path)
            if before_file and after_file and before_file.content == after_file.content:
                continue

            if before_file is None and after_file is not None:
                change_type = "added"
                before_lines: list[str] = []
                after_lines = after_file.content.splitlines()
            elif before_file is not None and after_file is None:
                change_type = "deleted"
                before_lines = before_file.content.splitlines()
                after_lines = []
            else:
                change_type = "modified"
                assert before_file is not None and after_file is not None
                before_lines = before_file.content.splitlines()
                after_lines = after_file.content.splitlines()

            diff = "\n".join(
                difflib.unified_diff(
                    before_lines,
                    after_lines,
                    fromfile=f"a/{path}",
                    tofile=f"b/{path}",
                    lineterm="",
                )
            )
            changed.append(ChangedFileRecord(path=path, change_type=change_type, diff=diff))
        return changed

    def _parse_jsonl_output(self, stdout: str) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        for line in stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return events

    def _last_agent_message(self, events: list[dict[str, Any]]) -> str | None:
        for event in reversed(events):
            item = event.get("item")
            if event.get("type") == "item.completed" and isinstance(item, dict) and item.get("type") == "agent_message":
                text = item.get("text")
                if isinstance(text, str):
                    return text
        return None

    def _collect_command_records(self, events: list[dict[str, Any]]) -> list[CodexCommandRecord]:
        commands: list[CodexCommandRecord] = []
        for event in events:
            item = event.get("item")
            if event.get("type") != "item.completed" or not isinstance(item, dict):
                continue
            if item.get("type") != "command_execution":
                continue
            commands.append(
                CodexCommandRecord(
                    command=str(item.get("command", "")),
                    status=str(item.get("status", "")),
                    exit_code=item.get("exit_code"),
                    output=_clean_log_output(str(item.get("aggregated_output", ""))) or None,
                )
            )
        return commands

    def _extract_json_object(self, value: str) -> dict[str, Any] | None:
        if not value:
            return None
        text = value.strip()
        candidates = [text]
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            candidates.append(text[start : end + 1])
        for candidate in candidates:
            try:
                payload = json.loads(candidate)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                return payload
        return None

    def _fallback_architecture_notes(self, prompt: str) -> list[GeneratedCanvasNode]:
        prompt_value = prompt.strip() or "App"
        root = prompt_value[:80]
        return [
            GeneratedCanvasNode(
                title="App shell",
                description=f"The main application shell for {root}. It owns routing, layout, and top-level composition.",
                tags=["shell"],
            ),
            GeneratedCanvasNode(
                title="Primary screen",
                description="The main screen users interact with first. It should present the core workflow in the simplest possible way.",
                tags=["screen"],
            ),
            GeneratedCanvasNode(
                title="Data model",
                description="The central data shape and CRUD behavior for the app. This note should track create, read, update, and delete expectations.",
                tags=["data", "crud"],
            ),
            GeneratedCanvasNode(
                title="UI state",
                description="Local state, form state, loading state, and error handling for the main flow.",
                tags=["state"],
            ),
        ]

    def _fallback_commit_message(self, status_text: str, diff_text: str) -> str:
        combined = f"{status_text}\n{diff_text}"
        lowered = combined.lower()
        if any(token in lowered for token in ["package.json", "pnpm-lock", "requirements", "pyproject", "cargo.toml"]):
            return "chore: update project dependencies"
        if any(token in lowered for token in ["readme", "docs", "agents.md"]):
            return "docs: update project documentation"
        if any(token in lowered for token in ["css", "styles", ".tsx", ".jsx", "page.tsx", "component"]):
            return "feat: refine app interface"
        if any(token in lowered for token in ["test", "spec"]):
            return "test: update project coverage"
        return "feat: update project workspace"
