from __future__ import annotations

import difflib
import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from .config import settings
from .models import (
    ChangedFileRecord,
    CodexChangeResponse,
    CodexCommandRecord,
    ExplorationContextNode,
    ExplorationSuggestionRecord,
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
EXPLORATION_SUGGESTION_TIMEOUT_SECONDS = 12


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
        conversation_context: str | None = None,
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
            semantic_context=self._merge_context_blocks(
                semantic_context,
                conversation_context,
            ),
        )

    def plan_project(
        self,
        repo_path: str,
        prompt: str,
        semantic_context: str | None,
        conversation_context: str | None = None,
    ) -> tuple[str, str]:
        if not self.is_available():
            raise RuntimeError("Codex CLI is not available. Check codex.binary in konceptura.toml.")

        repo_dir = Path(repo_path)
        context_prefix = self._merge_context_blocks(semantic_context, conversation_context)
        planning_prompt = (
            "You are preparing an implementation plan for the next coding run.\n"
            "Inspect the repository and respond with a concise, practical implementation plan only.\n"
            "Do not modify files.\n"
            "Keep the response grounded in the current codebase.\n"
            "Format:\n"
            "1. Goal\n"
            "2. Approach\n"
            "3. Main implementation steps\n"
            "4. Files or areas likely affected\n"
            "5. Risks or open questions\n\n"
            f"User request:\n{prompt.strip()}"
        )
        final_prompt = (
            f"{context_prefix}\n\nTask:\n{planning_prompt}" if context_prefix else planning_prompt
        )
        command = self._build_command(repo_dir, final_prompt, True, True)
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=False,
                timeout=EXPLORATION_SUGGESTION_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("Could not generate an implementation plan in time.")
        events = self._parse_jsonl_output(result.stdout)
        plan_text = self._last_agent_message(events) or _clean_log_output(result.stdout or result.stderr)
        plan_text = plan_text.strip()
        if result.returncode != 0 or not plan_text:
            error_tail = _clean_log_output(result.stderr or result.stdout).strip()
            raise RuntimeError(error_tail or "Could not generate an implementation plan.")

        summary = self._summarize_plan(plan_text)
        return summary, plan_text

    def infer_project_run_mode(
        self,
        repo_path: str,
        prompt: str,
        semantic_context: str | None,
        conversation_context: str | None = None,
    ) -> Literal["ask", "build"]:
        fallback = self._fallback_prompt_mode(prompt)
        if not self.is_available():
            return fallback

        repo_dir = Path(repo_path)
        context_prefix = self._merge_context_blocks(semantic_context, conversation_context)
        classifier_prompt = (
            "Classify the user's request for a codebase workspace.\n"
            "Return JSON only in this exact shape:\n"
            '{\n  "mode": "ask"\n}\n'
            "Allowed modes: ask, build.\n\n"
            "Use ask when the user primarily wants explanation, understanding, comparison, diagnosis, or discussion without changing code.\n"
            "Use build when the user wants files changed, code written, code edited, features implemented, bugs fixed, or behavior changed.\n"
            "If the request is ambiguous, prefer ask only when it clearly reads like a question; otherwise prefer build.\n\n"
            f"User request:\n{prompt.strip()}"
        )
        final_prompt = (
            f"{context_prefix}\n\nTask:\n{classifier_prompt}" if context_prefix else classifier_prompt
        )
        command = self._build_command(repo_dir, final_prompt, True, True)
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=False,
                timeout=8,
            )
        except subprocess.TimeoutExpired:
            logger.warning("Timed out classifying project request intent for %s", repo_path)
            return fallback

        events = self._parse_jsonl_output(result.stdout)
        raw_text = self._last_agent_message(events) or _clean_log_output(result.stdout or result.stderr)
        payload = self._extract_json_object(raw_text)
        if isinstance(payload, dict):
            mode = str(payload.get("mode", "")).strip().lower()
            if mode in {"ask", "build"}:
                return mode
        return fallback

    def ask_project(
        self,
        repo_path: str,
        prompt: str,
        semantic_context: str | None,
        conversation_context: str | None = None,
    ) -> tuple[str, str]:
        if not self.is_available():
            raise RuntimeError("Codex CLI is not available. Check codex.binary in konceptura.toml.")

        repo_dir = Path(repo_path)
        context_prefix = self._merge_context_blocks(semantic_context, conversation_context)
        question_prompt = (
            "You are answering a user's question about the current project and visible workspace context.\n"
            "Inspect the repository as needed and respond with a concise, grounded answer.\n"
            "Do not modify files.\n"
            "Prefer practical explanations tied to the current codebase.\n\n"
            f"User question:\n{prompt.strip()}"
        )
        final_prompt = (
            f"{context_prefix}\n\nTask:\n{question_prompt}" if context_prefix else question_prompt
        )
        command = self._build_command(repo_dir, final_prompt, True, True)
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        events = self._parse_jsonl_output(result.stdout)
        answer_text = self._last_agent_message(events) or _clean_log_output(result.stdout or result.stderr)
        answer_text = answer_text.strip()
        if result.returncode != 0 or not answer_text:
            error_tail = _clean_log_output(result.stderr or result.stdout).strip()
            raise RuntimeError(error_tail or "Could not answer the project question.")

        summary = self._summarize_plan(answer_text)
        return summary, answer_text

    def generate_exploration_suggestions(
        self,
        repo_path: str,
        active_node: ExplorationContextNode,
        path_titles: list[str],
        suggestion_count: int = 3,
        relation_query: str | None = None,
        semantic_context: str | None = None,
        conversation_context: str | None = None,
    ) -> list[ExplorationSuggestionRecord]:
        fallback = self._fallback_exploration_suggestions(active_node.title, relation_query, suggestion_count)
        if not self.is_available():
            return fallback

        repo_dir = Path(repo_path)
        context_prefix = self._merge_context_blocks(semantic_context, conversation_context)
        relation_clause = (
            f'The user explicitly wants this relationship angle explored: "{relation_query.strip()}".\n'
            if relation_query and relation_query.strip()
            else ""
        )
        prompt = (
            "You are generating exploration suggestions for a visual codebase explorer.\n"
            "Inspect the repository as needed, but return exploration concepts, not persisted architecture notes.\n"
            "These suggestions are temporary next-step concepts that help the user explore one selected concept.\n"
            "Do not copy existing canvas note titles mechanically. Generate fresh conceptual follow-ups.\n"
            "Keep them grounded in the codebase and the active concept.\n"
            "Return JSON only in this exact shape:\n"
            '{\n'
            '  "suggestions": [\n'
            '    {\n'
            '      "title": "string",\n'
            '      "summary": "one concise sentence about what this exploration concept would reveal",\n'
            '      "edge_label": "supports"\n'
            '    }\n'
            "  ]\n"
            "}\n\n"
            "Rules:\n"
            f"- Return exactly {suggestion_count} suggestions.\n"
            "- Suggestions must be exploration concepts, not existing saved notes.\n"
            "- Titles should be short and specific.\n"
            "- Summaries should explain what the user would learn by opening that concept.\n"
            "- edge_label should be a short relation phrase like drives, depends on, shapes, constrains, exposes, persists through.\n"
            "- Avoid duplicating the active concept title.\n\n"
            f"Active concept title: {active_node.title}\n"
            f"Active concept description: {active_node.description or '(none)'}\n"
            f"Active concept tags: {', '.join(active_node.tags) or '(none)'}\n"
            f"Active concept linked files: {', '.join(active_node.linked_files) or '(none)'}\n"
            f"Active concept linked symbols: {', '.join(active_node.linked_symbols) or '(none)'}\n"
            f"Exploration path so far: {', '.join(path_titles) or active_node.title}\n"
            f"{relation_clause}"
        )
        final_prompt = f"{context_prefix}\n\nTask:\n{prompt}" if context_prefix else prompt
        command = self._build_command(repo_dir, final_prompt, True, True)
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        events = self._parse_jsonl_output(result.stdout)
        raw_text = self._last_agent_message(events) or _clean_log_output(result.stdout or result.stderr)
        payload = self._extract_json_object(raw_text)
        if result.returncode != 0 or payload is None:
            return fallback

        try:
            suggestions = [
                ExplorationSuggestionRecord.model_validate(item)
                for item in payload.get("suggestions", [])
            ]
        except Exception:
            return fallback

        if not suggestions:
            return fallback

        return suggestions[:suggestion_count]

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
            "You are mapping a software project into editable workspace notes on a visual canvas.\n"
            "The notes should represent business logic and architecture with only the most relevant implementation details.\n"
            "Inspect the repository and the user prompt, then return JSON only.\n"
            "Do not modify files.\n\n"
            "Return exactly this shape:\n"
            '{\n'
            '  "summary": "short plain sentence",\n'
            '  "nodes": [\n'
            '    {\n'
            '      "title": "string",\n'
            '      "description": "2-4 sentence note about responsibility, business behavior, and only the most relevant implementation evidence",\n'
            '      "tags": ["workflow"],\n'
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
            "- There is no fixed low node limit. Create as many nodes as needed to represent the architecture clearly.\n"
            "- For a small or medium app, 7 to 16 nodes is usually a good range.\n"
            "- Each node should represent one meaningful responsibility, not a vague summary blob.\n"
            "- Titles must be short and human-readable.\n"
            "- Prefer domain and product language over implementation jargon.\n"
            "- Focus on business capabilities, workflows, stateful areas, policies, boundaries, UI surfaces, integrations, and data flow.\n"
            "- Good tag families are: domain, workflow, ui-surface, state, boundary, policy, integration, entity.\n"
            "- A note may include limited implementation detail only to ground it in the codebase.\n"
            "- Avoid catch-all notes when the responsibility can be split into clearer nodes.\n"
            "- Avoid one note per file; map logical responsibilities instead.\n"
            "- Every node should link to the most relevant files and symbols when evidence exists.\n"
            "- Edges should describe how responsibilities interact, such as drives, validates, persists, renders, coordinates, or depends on.\n"
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

    def _merge_context_blocks(
        self,
        semantic_context: str | None,
        conversation_context: str | None,
    ) -> str | None:
        blocks: list[str] = []
        if semantic_context and semantic_context.strip():
            blocks.append(
                "Use this semantic workspace context when planning and editing:\n"
                f"{semantic_context.strip()}"
            )
        if conversation_context and conversation_context.strip():
            blocks.append(
                "Use this conversation context to continue the user's current thread naturally:\n"
                f"{conversation_context.strip()}"
            )
        if not blocks:
            return None
        return "\n\n".join(blocks)

    def _summarize_plan(self, plan_text: str) -> str:
        for line in plan_text.splitlines():
            stripped = line.strip().lstrip("#").strip()
            if stripped:
                return stripped[:140]
        return "Implementation plan ready."

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
                title="Core workflow",
                description=f"The central business workflow for {root}. This note should explain the main user outcome, what steps the system coordinates, and where implementation evidence currently lives.",
                tags=["workflow", "domain"],
            ),
            GeneratedCanvasNode(
                title="Primary interface",
                description="The main UI surface that exposes the core workflow to the user. It should describe what the screen or entry point lets the user do and how it connects to underlying logic.",
                tags=["ui-surface"],
            ),
            GeneratedCanvasNode(
                title="State and rules",
                description="The central stateful area and business rules for the app. This note should track the core data transitions, validations, and invariants that the implementation must preserve.",
                tags=["state", "policy"],
            ),
            GeneratedCanvasNode(
                title="External boundary",
                description="The main persistence, API, or integration boundary the app depends on. This note should explain what crosses the boundary and how the core workflow relies on it.",
                tags=["boundary", "integration"],
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

    def _fallback_exploration_suggestions(
        self,
        active_title: str,
        relation_query: str | None,
        suggestion_count: int,
    ) -> list[ExplorationSuggestionRecord]:
        base = active_title.strip() or "Current concept"
        if relation_query and relation_query.strip():
            query = relation_query.strip()
            return [
                ExplorationSuggestionRecord(
                    title=f"{base} {query.title()}",
                    summary=f"Explore the {query} angle around {base.lower()} and what it changes in practice.",
                    edge_label=query.lower(),
                )
            ]

        seeds = [
            ExplorationSuggestionRecord(
                title=f"{base} Decision Points",
                summary=f"Explore the decisions and branching logic that shape how {base.lower()} behaves.",
                edge_label="shapes",
            ),
            ExplorationSuggestionRecord(
                title=f"{base} Runtime Inputs",
                summary=f"Explore what inputs, triggers, or upstream state feed into {base.lower()}.",
                edge_label="depends on",
            ),
            ExplorationSuggestionRecord(
                title=f"{base} Downstream Effects",
                summary=f"Explore what {base.lower()} changes, updates, or exposes to the rest of the system.",
                edge_label="drives",
            ),
        ]
        return seeds[:suggestion_count]

    def _fallback_prompt_mode(self, prompt: str) -> Literal["ask", "build"]:
        normalized = prompt.strip().lower()
        if not normalized:
            return "ask"

        question_starters = (
            "what",
            "why",
            "how",
            "where",
            "when",
            "which",
            "who",
            "is",
            "are",
            "does",
            "do",
            "can",
            "could",
            "would",
            "should",
            "explain",
            "tell me",
        )
        if normalized.endswith("?") or normalized.startswith(question_starters):
            return "ask"
        return "build"
