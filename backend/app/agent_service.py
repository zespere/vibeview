from __future__ import annotations

import difflib
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Literal

from .config import settings
from .models import (
    AgentChangeResponse,
    AgentCommandRecord,
    CanvasEdge,
    CanvasEditChangeRecord,
    CanvasEditPatch,
    CanvasNode,
    ChangedFileRecord,
    ExplorationContextNode,
    ExplorationSuggestionRecord,
    GeneratedCanvasEdge,
    GeneratedCanvasNode,
)
from .pi_client import PiClient
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
FAST_PROMPT_TIMEOUT_SECONDS = 12


def _append_unique_tags(existing: list[str], additions: list[str]) -> list[str]:
    seen = {tag.strip().lower() for tag in existing if tag.strip()}
    result = [tag.strip() for tag in existing if tag.strip()]
    for value in additions:
        tag = value.strip()
        if not tag or tag.lower() in seen:
            continue
        seen.add(tag.lower())
        result.append(tag)
    return result


@dataclass
class _SnapshotFile:
    path: str
    content: str


class AgentService:
    def __init__(
        self,
        graph_service: GraphService,
        pi_client: PiClient,
        provider_resolver: Callable[[], str | None] | None = None,
    ) -> None:
        self.graph_service = graph_service
        self.pi_client = pi_client
        self.provider_resolver = provider_resolver or (lambda: settings.agent_provider)

    def is_available(self) -> bool:
        return self.pi_client.is_available()

    def run_change(
        self,
        repo_path: str,
        prompt: str,
        dry_run: bool,
        use_graph_context: bool,
        semantic_context: str | None,
        image_paths: list[str] | None = None,
        model: str | None = None,
        reasoning_effort: Literal["low", "medium", "high", "xhigh"] | None = None,
        event_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> AgentChangeResponse:
        if not self.is_available():
            raise RuntimeError("Pi CLI is not available. Check agent.binary in vibeview.toml.")

        repo_dir = Path(repo_path)
        before = self._snapshot_repo(repo_dir)

        graph_context_summary = None
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
                logger.exception("Failed to build graph context for agent change run")
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

        final_prompt = prompt.strip()
        if context_blocks:
            final_prompt = "\n\n".join(context_blocks) + f"\n\nTask:\n{prompt.strip()}"
        if dry_run:
            final_prompt += "\n\nDo not modify files. Inspect the repo and explain the exact changes you would make."

        result = self.pi_client.run_prompt(
            repo_dir,
            final_prompt,
            image_paths=image_paths,
            provider=self._active_provider(),
            model=model,
            reasoning_effort=reasoning_effort,
            event_callback=event_callback,
        )
        summary = self._last_assistant_message(result.events) or _clean_log_output(result.stderr)
        changed_files = [] if dry_run else self._build_changed_files(before, self._snapshot_repo(repo_dir))
        commands = self._collect_command_records(result.events)

        return AgentChangeResponse(
            repo_path=str(repo_dir),
            prompt=prompt,
            summary=summary or ("No changes were made." if dry_run else "Pi run completed."),
            dry_run=dry_run,
            used_graph_context=use_graph_context,
            agent_binary=str(settings.agent_binary),
            agent_name=settings.agent_name,
            agent_provider=self._active_provider(),
            agent_model=model or settings.agent_model,
            graph_context_summary=graph_context_summary,
            changed_files=changed_files,
            commands=commands,
            raw_event_count=len(result.events),
        )

    def run_workspace_prompt(
        self,
        repo_path: str,
        prompt: str,
        semantic_context: str | None,
        conversation_context: str | None = None,
        image_paths: list[str] | None = None,
        model: str | None = None,
        reasoning_effort: Literal["low", "medium", "high", "xhigh"] | None = None,
        event_callback: Callable[[dict[str, Any]], None] | None = None,
        canvas_id: str | None = None,
        canvas_title: str | None = None,
        canvas_file_path: str | None = None,
    ) -> AgentChangeResponse:
        canvas_file = canvas_file_path or str(Path(repo_path) / ".vibeview" / "canvases.json")
        canvas_id_label = canvas_id or "(none)"
        canvas_title_label = canvas_title or "(none)"
        workspace_prompt = "\n".join(
            [
                "You are operating inside Vibeview, a local-first code workspace with editable project canvases.",
                "You can inspect and edit repository files directly.",
                "The canvas workspace data is stored in JSON and may be edited directly when the user wants something shown, mapped, visualized, reorganized, or refined on the canvas.",
                "Use the current repository and current canvas context to decide what to change.",
                "",
                "Canvas workspace rules:",
                f"- Edit this file for canvas changes: {canvas_file}",
                f"- Current active canvas id: {canvas_id_label}",
                f"- Current active canvas title: {canvas_title_label}",
                "- Do not edit .vibeview/canvas.json. It is derived metadata and will be regenerated by the app.",
                "- If the user asks to show, map, expose, represent, or refine codebase structure on the canvas, update the canvas JSON directly instead of implementing a new UI feature.",
                "- Preserve canvases unrelated to the request.",
                "- Keep the canvas JSON valid.",
                "- If the user clearly asks for code changes, edit repository files directly as needed.",
                "- After making changes, explain clearly what changed.",
                "",
                "User request:",
                prompt.strip(),
            ]
        )
        return self.run_change(
            repo_path=repo_path,
            prompt=workspace_prompt,
            dry_run=False,
            use_graph_context=True,
            semantic_context=self._merge_context_blocks(semantic_context, conversation_context),
            image_paths=image_paths,
            model=model,
            reasoning_effort=reasoning_effort,
            event_callback=event_callback,
        )

    def repair_canvas_json(
        self,
        repo_path: str,
        canvas_file_path: str,
        backup_file_path: str | None,
        validation_error: str,
        canvas_id: str | None = None,
        canvas_title: str | None = None,
        model: str | None = None,
        reasoning_effort: Literal["low", "medium", "high", "xhigh"] | None = None,
        event_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> str:
        if not self.is_available():
            raise RuntimeError("Pi CLI is not available. Check agent.binary in vibeview.toml.")

        repo_dir = Path(repo_path)
        repair_prompt_lines = [
            "Repair the canvas workspace JSON after a bad edit.",
            "Edit only the canvas workspace JSON file and nothing else in the repository.",
            "Preserve the latest intended canvas changes when possible, but make the final file valid JSON that matches the expected canvas collection structure.",
            "",
            "Expected structure:",
            "- top-level object with repo_path and canvases",
            "- canvases is a list of canvas objects",
            "- each canvas has id, title, repo_path, nodes, edges",
            "- each node has id, title, description, tags, x, y, linked_files, linked_symbols, linked_canvas_id",
            "- each edge has id, source_node_id, target_node_id, label",
            "",
            "Repair rules:",
            f"- Broken file to repair: {canvas_file_path}",
            f"- Current active canvas id: {canvas_id or '(none)'}",
            f"- Current active canvas title: {canvas_title or '(none)'}",
            f"- Validation error: {validation_error}",
        ]
        if backup_file_path:
            repair_prompt_lines.append(f"- Backup file for reference: {backup_file_path}")
        repair_prompt_lines.extend(
            [
                "- Do not edit .vibeview/canvas.json.",
                "- Do not edit application source files.",
                "- Final result must be valid JSON parseable by the app.",
            ]
        )
        result = self.pi_client.run_prompt(
            repo_dir,
            "\n".join(repair_prompt_lines),
            provider=self._active_provider(),
            model=model,
            reasoning_effort=reasoning_effort,
            timeout_seconds=FAST_PROMPT_TIMEOUT_SECONDS,
            event_callback=event_callback,
        )
        return (self._last_assistant_message(result.events) or _clean_log_output(result.stderr) or "Canvas repair finished.").strip()

    def ask_project(
        self,
        repo_path: str,
        prompt: str,
        semantic_context: str | None,
        conversation_context: str | None = None,
        image_paths: list[str] | None = None,
        model: str | None = None,
        reasoning_effort: Literal["low", "medium", "high", "xhigh"] | None = None,
        event_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> tuple[str, str]:
        if not self.is_available():
            raise RuntimeError("Pi CLI is not available. Check agent.binary in vibeview.toml.")

        repo_dir = Path(repo_path)
        context_prefix = self._merge_context_blocks(semantic_context, conversation_context)
        question_prompt = (
            "You are answering a user's question about the current project and visible workspace context.\n"
            "Inspect the repository as needed and respond with a concise, grounded answer.\n"
            "Do not modify files.\n"
            "Prefer practical explanations tied to the current codebase.\n\n"
            f"User question:\n{prompt.strip()}"
        )
        final_prompt = f"{context_prefix}\n\nTask:\n{question_prompt}" if context_prefix else question_prompt
        result = self.pi_client.run_prompt(
            repo_dir,
            final_prompt,
            image_paths=image_paths,
            provider=self._active_provider(),
            model=model,
            reasoning_effort=reasoning_effort,
            event_callback=event_callback,
        )
        answer_text = (self._last_assistant_message(result.events) or _clean_log_output(result.stderr)).strip()
        if not answer_text:
            raise RuntimeError("Could not answer the project question.")
        return self._summarize_plan(answer_text), answer_text

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
        result = self.pi_client.run_prompt(
            repo_dir,
            final_prompt,
            provider=self._active_provider(),
            timeout_seconds=FAST_PROMPT_TIMEOUT_SECONDS,
        )
        payload = self._extract_json_object(self._last_assistant_message(result.events) or "")
        if payload is None:
            return fallback
        try:
            suggestions = [
                ExplorationSuggestionRecord.model_validate(item)
                for item in payload.get("suggestions", [])
            ]
        except Exception:
            return fallback
        return suggestions[:suggestion_count] or fallback

    def generate_architecture_notes(
        self,
        repo_path: str,
        prompt: str,
        image_paths: list[str] | None = None,
        model: str | None = None,
        reasoning_effort: Literal["low", "medium", "high", "xhigh"] | None = None,
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
        result = self.pi_client.run_prompt(
            repo_dir,
            generation_prompt,
            image_paths=image_paths,
            provider=self._active_provider(),
            model=model,
            reasoning_effort=reasoning_effort,
        )
        payload = self._extract_json_object(self._last_assistant_message(result.events) or "")
        if payload is None:
            nodes = self._fallback_architecture_notes(prompt)
            return nodes, [], f"Created {len(nodes)} architecture notes from the prompt."
        try:
            node_items = [GeneratedCanvasNode.model_validate(item) for item in payload.get("nodes", [])]
            edge_items = [GeneratedCanvasEdge.model_validate(item) for item in payload.get("edges", [])]
        except Exception:
            nodes = self._fallback_architecture_notes(prompt)
            return nodes, [], f"Created {len(nodes)} architecture notes from the prompt."
        summary = str(payload.get("summary") or f"Created {len(node_items)} architecture notes.").strip()
        if not node_items:
            node_items = self._fallback_architecture_notes(prompt)
            edge_items = []
            summary = f"Created {len(node_items)} architecture notes from the prompt."
        return node_items, edge_items, summary

    def draft_canvas_changes(
        self,
        repo_path: str,
        prompt: str,
        target_nodes: list[CanvasNode],
        impacted_notes: list[tuple[CanvasNode, list[str]]],
        semantic_context: str | None = None,
        conversation_context: str | None = None,
    ) -> tuple[list[CanvasEditChangeRecord], str]:
        if not target_nodes:
            return [], "No target notes were selected."

        fallback = self._fallback_canvas_changes(prompt, target_nodes, impacted_notes)
        if not self.is_available():
            return fallback

        repo_dir = Path(repo_path)
        context_prefix = self._merge_context_blocks(semantic_context, conversation_context)

        def note_block(node: CanvasNode, basis: list[str] | None = None) -> str:
            lines = [
                f"id: {node.id}",
                f"title: {node.title}",
                f"description: {node.description or '(none)'}",
                f"tags: {', '.join(node.tags) or '(none)'}",
                f"linked_files: {', '.join(node.linked_files) or '(none)'}",
                f"linked_symbols: {', '.join(node.linked_symbols) or '(none)'}",
            ]
            if basis:
                lines.append(f"impact_basis: {'; '.join(basis)}")
            return "\n".join(lines)

        target_block = "\n\n".join(note_block(node) for node in target_nodes)
        impacted_block = "\n\n".join(note_block(node, basis) for node, basis in impacted_notes) or "(none)"
        draft_prompt = (
            "You are drafting reviewable changes for architecture notes on a visual canvas.\n"
            "You may update existing notes, create new notes, create edges between notes, or delete notes when merging.\n"
            "Return JSON only in this shape:\n"
            "{\n"
            '  "summary": "short plain sentence",\n'
            '  "changes": [\n'
            "    {\n"
            '      "id": "change_1",\n'
            '      "kind": "update_node",\n'
            '      "scope": "direct",\n'
            '      "reason": "why this note should change",\n'
            '      "depends_on_change_ids": ["change_0"],\n'
            '      "impact_basis": ["shared file: frontend/app/page.tsx"],\n'
            '      "target_node_id": "node_123",\n'
            '      "patch": { "title": "optional", "description": "optional", "tags": ["optional"], "linked_files": ["optional"], "linked_symbols": ["optional"], "linked_canvas_id": "optional" },\n'
            '      "anchor_node_id": "optional existing note id",\n'
            '      "after_node": { "id": "draft_node_1", "title": "new note title", "description": "text", "tags": ["workflow"], "linked_files": ["frontend/app/page.tsx"], "linked_symbols": ["Home"], "linked_canvas_id": "optional" },\n'
            '      "after_edge": { "source_node_id": "node_or_draft_id", "target_node_id": "node_or_draft_id", "label": "drives" }\n'
            "    }\n"
            "  ]\n"
            "}\n\n"
            "Rules:\n"
            "- kind must be one of: update_node, create_node, delete_node, create_edge.\n"
            "- target_node_id must reference one of the provided note ids for update_node and delete_node.\n"
            "- scope must be direct for targeted notes or new notes spawned from them, and impacted for secondary notes.\n"
            "- Propose the smallest set of canvas changes needed.\n"
            "- Impacted notes should only be updated if the prompt would make them inconsistent otherwise.\n"
            "- Use create_node plus create_edge for split-style changes.\n"
            "- Use update_node plus delete_node for merge-style changes.\n"
            "- For create_node, provide after_node with a temporary id like draft_node_1 and use anchor_node_id when there is a clear parent note.\n"
            "- For create_edge, after_edge may reference existing note ids or draft_node ids from create_node changes.\n"
            "- Use depends_on_change_ids when an edge depends on a created note or when a delete depends on another change.\n"
            "- Preserve linked files and symbols unless the prompt clearly implies they should change.\n"
            "- Avoid empty patches or no-op changes.\n"
            "- JSON only.\n\n"
            f"User prompt:\n{prompt.strip()}\n\n"
            f"Direct target notes:\n{target_block}\n\n"
            f"Impacted note candidates:\n{impacted_block}\n"
        )
        final_prompt = f"{context_prefix}\n\nTask:\n{draft_prompt}" if context_prefix else draft_prompt
        result = self.pi_client.run_prompt(
            repo_dir,
            final_prompt,
            provider=self._active_provider(),
            timeout_seconds=FAST_PROMPT_TIMEOUT_SECONDS,
        )
        payload = self._extract_json_object(self._last_assistant_message(result.events) or "")
        if payload is None:
            return fallback

        nodes_by_id = {node.id: node for node in [*target_nodes, *(node for node, _ in impacted_notes)]}
        changes: list[CanvasEditChangeRecord] = []
        for index, item in enumerate(payload.get("changes", [])):
            if not isinstance(item, dict):
                continue
            change_id = str(item.get("id") or f"draft_change_{index}").strip() or f"draft_change_{index}"
            kind = str(item.get("kind") or "update_node").strip().lower()
            scope = str(item.get("scope") or "direct").strip().lower()
            if scope not in {"direct", "impacted"} or kind not in {"update_node", "create_node", "delete_node", "create_edge"}:
                continue
            reason = str(item.get("reason") or "Update canvas").strip() or "Update canvas"
            impact_basis = [
                str(value).strip()
                for value in item.get("impact_basis", [])
                if isinstance(value, str) and value.strip()
            ]
            depends_on_change_ids = [
                str(value).strip()
                for value in item.get("depends_on_change_ids", [])
                if isinstance(value, str) and str(value).strip()
            ]
            target_node_id = str(item.get("target_node_id") or "").strip()

            if kind == "update_node":
                before_node = nodes_by_id.get(target_node_id)
                if before_node is None:
                    continue
                try:
                    patch = CanvasEditPatch.model_validate(item.get("patch") or {})
                except Exception:
                    continue
                if not any(
                    value is not None and (value != [] if isinstance(value, list) else True)
                    for value in [patch.title, patch.description, patch.tags, patch.linked_files, patch.linked_symbols, patch.linked_canvas_id]
                ):
                    continue
                after_node = before_node.model_copy(deep=True)
                if patch.title is not None:
                    after_node.title = patch.title.strip()
                if patch.description is not None:
                    after_node.description = patch.description
                if patch.tags is not None:
                    after_node.tags = [tag.strip() for tag in patch.tags if tag.strip()]
                if patch.linked_files is not None:
                    after_node.linked_files = [path.strip() for path in patch.linked_files if path.strip()]
                if patch.linked_symbols is not None:
                    after_node.linked_symbols = [symbol.strip() for symbol in patch.linked_symbols if symbol.strip()]
                if "linked_canvas_id" in patch.model_fields_set:
                    after_node.linked_canvas_id = patch.linked_canvas_id
                if (
                    after_node.title == before_node.title
                    and after_node.description == before_node.description
                    and after_node.tags == before_node.tags
                    and after_node.linked_files == before_node.linked_files
                    and after_node.linked_symbols == before_node.linked_symbols
                    and after_node.linked_canvas_id == before_node.linked_canvas_id
                ):
                    continue
                changes.append(
                    CanvasEditChangeRecord(
                        id=change_id,
                        kind="update_node",
                        scope=scope,  # type: ignore[arg-type]
                        reason=reason,
                        impact_basis=impact_basis,
                        depends_on_change_ids=depends_on_change_ids,
                        target_node_id=target_node_id,
                        target_title=before_node.title,
                        before_node=before_node,
                        after_node=after_node,
                    )
                )
                continue

            if kind == "create_node":
                after_payload = item.get("after_node")
                if not isinstance(after_payload, dict):
                    continue
                draft_title = str(after_payload.get("title") or "").strip()
                if not draft_title:
                    continue
                draft_id = str(after_payload.get("id") or f"draft_node_{index}").strip() or f"draft_node_{index}"
                after_node = CanvasNode(
                    id=draft_id,
                    title=draft_title,
                    description=str(after_payload.get("description") or ""),
                    tags=[str(tag).strip() for tag in after_payload.get("tags", []) if str(tag).strip()],
                    x=0,
                    y=0,
                    linked_files=[str(path).strip() for path in after_payload.get("linked_files", []) if str(path).strip()],
                    linked_symbols=[str(symbol).strip() for symbol in after_payload.get("linked_symbols", []) if str(symbol).strip()],
                    linked_canvas_id=str(after_payload.get("linked_canvas_id") or "").strip() or None,
                )
                anchor_node_id = str(item.get("anchor_node_id") or "").strip() or None
                changes.append(
                    CanvasEditChangeRecord(
                        id=change_id,
                        kind="create_node",
                        scope=scope,  # type: ignore[arg-type]
                        reason=reason,
                        impact_basis=impact_basis,
                        depends_on_change_ids=depends_on_change_ids,
                        target_title=after_node.title,
                        anchor_node_id=anchor_node_id,
                        after_node=after_node,
                    )
                )
                continue

            if kind == "delete_node":
                before_node = nodes_by_id.get(target_node_id)
                if before_node is None:
                    continue
                changes.append(
                    CanvasEditChangeRecord(
                        id=change_id,
                        kind="delete_node",
                        scope=scope,  # type: ignore[arg-type]
                        reason=reason,
                        impact_basis=impact_basis,
                        depends_on_change_ids=depends_on_change_ids,
                        target_node_id=target_node_id,
                        target_title=before_node.title,
                        before_node=before_node,
                    )
                )
                continue

            if kind == "create_edge":
                edge_payload = item.get("after_edge")
                if not isinstance(edge_payload, dict):
                    edge_payload = item
                source_node_id = str(edge_payload.get("source_node_id") or "").strip()
                target_node_id = str(edge_payload.get("target_node_id") or "").strip()
                if not source_node_id or not target_node_id or source_node_id == target_node_id:
                    continue
                after_edge = CanvasEdge(
                    id=str(edge_payload.get("id") or f"draft_edge_{index}").strip() or f"draft_edge_{index}",
                    source_node_id=source_node_id,
                    target_node_id=target_node_id,
                    label=str(edge_payload.get("label") or "").strip(),
                )
                changes.append(
                    CanvasEditChangeRecord(
                        id=change_id,
                        kind="create_edge",
                        scope=scope,  # type: ignore[arg-type]
                        reason=reason,
                        impact_basis=impact_basis,
                        depends_on_change_ids=depends_on_change_ids,
                        after_edge=after_edge,
                    )
                )

        summary = str(payload.get("summary") or "").strip()
        if not changes:
            return fallback
        return changes, summary or f"Drafted {len(changes)} note change{'s' if len(changes) != 1 else ''}."

    def suggest_commit_message(
        self,
        repo_path: str,
        status_text: str,
        diff_text: str,
    ) -> str:
        fallback = self._fallback_commit_message(status_text, diff_text)
        if not self.is_available():
            return fallback

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
        result = self.pi_client.run_prompt(
            Path(repo_path),
            prompt,
            provider=self._active_provider(),
            timeout_seconds=FAST_PROMPT_TIMEOUT_SECONDS,
        )
        candidate = (self._last_assistant_message(result.events) or "").strip().splitlines()[0].strip() if result.events else ""
        if not candidate:
            return fallback
        candidate = candidate.strip("`").strip()
        return candidate[:96].rstrip() or fallback

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
        return "\n\n".join(blocks) if blocks else None

    def _summarize_plan(self, plan_text: str) -> str:
        for line in plan_text.splitlines():
            stripped = line.strip().lstrip("#").strip()
            if stripped:
                return stripped[:140]
        return "Implementation plan ready."

    def _active_provider(self) -> str | None:
        return self.provider_resolver()

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

    def _last_assistant_message(self, events: list[dict[str, Any]]) -> str | None:
        for event in reversed(events):
            if event.get("type") == "agent_end":
                message = self._last_assistant_message_from_messages(event.get("messages"))
                if message:
                    return message
            if event.get("type") == "message_end":
                message = event.get("message")
                text = self._extract_message_text(message)
                if text:
                    return text
        return None

    def _last_assistant_message_from_messages(self, messages: Any) -> str | None:
        if not isinstance(messages, list):
            return None
        for message in reversed(messages):
            text = self._extract_message_text(message)
            if text:
                return text
        return None

    def _extract_message_text(self, message: Any) -> str | None:
        if not isinstance(message, dict):
            return None
        role = str(message.get("role") or "").strip()
        if role != "assistant":
            return None
        content = message.get("content")
        if not isinstance(content, list):
            return None
        parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                text = str(block.get("text") or "").strip()
                if text:
                    parts.append(text)
        return "\n\n".join(parts).strip() or None

    def _collect_command_records(self, events: list[dict[str, Any]]) -> list[AgentCommandRecord]:
        commands: list[AgentCommandRecord] = []
        for event in events:
            if event.get("type") != "tool_execution_end":
                continue
            tool_name = str(event.get("toolName") or "").strip()
            args = event.get("args")
            command = self._format_tool_call(tool_name, args)
            output = self._extract_tool_result_text(event.get("result"))
            commands.append(
                AgentCommandRecord(
                    command=command,
                    status="error" if event.get("isError") else "success",
                    exit_code=None,
                    output=output,
                )
            )
        return commands

    def _format_tool_call(self, tool_name: str, args: Any) -> str:
        if tool_name == "bash" and isinstance(args, dict):
            command = str(args.get("command") or "").strip()
            if command:
                return command
        if isinstance(args, dict) and args:
            return f"{tool_name} {json.dumps(args, ensure_ascii=True, sort_keys=True)}"
        return tool_name or "tool"

    def _extract_tool_result_text(self, result: Any) -> str | None:
        if not isinstance(result, dict):
            return None
        content = result.get("content")
        if not isinstance(content, list):
            return None
        parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                text = str(block.get("text") or "").strip()
                if text:
                    parts.append(text)
        cleaned = _clean_log_output("\n".join(parts))
        return cleaned or None

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
        combined = f"{status_text}\n{diff_text}".lower()
        if any(token in combined for token in ["package.json", "pnpm-lock", "requirements", "pyproject", "cargo.toml"]):
            return "chore: update project dependencies"
        if any(token in combined for token in ["readme", "docs", "agents.md"]):
            return "docs: update project documentation"
        if any(token in combined for token in ["css", "styles", ".tsx", ".jsx", "page.tsx", "component"]):
            return "feat: refine app interface"
        if any(token in combined for token in ["test", "spec"]):
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

    def _fallback_canvas_changes(
        self,
        prompt: str,
        target_nodes: list[CanvasNode],
        impacted_notes: list[tuple[CanvasNode, list[str]]],
    ) -> tuple[list[CanvasEditChangeRecord], str]:
        first_prompt_sentence = prompt.strip().splitlines()[0].strip() if prompt.strip() else "Update this note."
        normalized_prompt = prompt.strip().lower()
        changes: list[CanvasEditChangeRecord] = []
        handled_structural_change = False
        primary_node = target_nodes[0] if target_nodes else None
        secondary_node = target_nodes[1] if len(target_nodes) > 1 else None

        if "split" in normalized_prompt and primary_node is not None:
            handled_structural_change = True
            created_change_id = f"fallback_create_split_{primary_node.id}"
            created_node = CanvasNode(
                id=f"draft_split_{primary_node.id}",
                title=f"{primary_node.title} Breakdown",
                description=f"Spin out the focused responsibility from {primary_node.title.lower()} so the concept can be explored independently.",
                tags=_append_unique_tags(primary_node.tags, ["workflow"]),
                x=0,
                y=0,
                linked_files=primary_node.linked_files,
                linked_symbols=primary_node.linked_symbols,
                linked_canvas_id=None,
            )
            updated_node = primary_node.model_copy(deep=True)
            updated_node.description = (
                f"{updated_node.description.strip()}\n\nRefined to focus on the parent responsibility after splitting related behavior."
            ).strip()
            changes.extend(
                [
                    CanvasEditChangeRecord(
                        id=f"fallback_update_split_{primary_node.id}",
                        kind="update_node",
                        scope="direct",
                        reason="Refocus the original note after splitting out a separate concept.",
                        impact_basis=[],
                        target_node_id=primary_node.id,
                        target_title=primary_node.title,
                        before_node=primary_node,
                        after_node=updated_node,
                    ),
                    CanvasEditChangeRecord(
                        id=created_change_id,
                        kind="create_node",
                        scope="direct",
                        reason="Create the split-out concept as a new note.",
                        impact_basis=[],
                        target_title=created_node.title,
                        anchor_node_id=primary_node.id,
                        after_node=created_node,
                    ),
                    CanvasEditChangeRecord(
                        id=f"fallback_edge_split_{primary_node.id}",
                        kind="create_edge",
                        scope="direct",
                        reason="Link the new split concept back to its parent note.",
                        impact_basis=[],
                        depends_on_change_ids=[created_change_id],
                        after_edge=CanvasEdge(
                            id=f"draft_edge_split_{primary_node.id}",
                            source_node_id=primary_node.id,
                            target_node_id=created_node.id,
                            label="splits into",
                        ),
                    ),
                ]
            )

        elif "merge" in normalized_prompt and primary_node is not None and secondary_node is not None:
            handled_structural_change = True
            updated_node = primary_node.model_copy(deep=True)
            updated_node.description = (
                f"{updated_node.description.strip()}\n\nExpanded to absorb responsibilities previously represented by {secondary_node.title}."
            ).strip()
            changes.extend(
                [
                    CanvasEditChangeRecord(
                        id=f"fallback_merge_update_{primary_node.id}",
                        kind="update_node",
                        scope="direct",
                        reason="Expand the primary note to absorb the merged concept.",
                        impact_basis=[],
                        target_node_id=primary_node.id,
                        target_title=primary_node.title,
                        before_node=primary_node,
                        after_node=updated_node,
                    ),
                    CanvasEditChangeRecord(
                        id=f"fallback_merge_delete_{secondary_node.id}",
                        kind="delete_node",
                        scope="direct",
                        reason="Remove the secondary note after merging it into the primary one.",
                        impact_basis=[],
                        depends_on_change_ids=[f"fallback_merge_update_{primary_node.id}"],
                        target_node_id=secondary_node.id,
                        target_title=secondary_node.title,
                        before_node=secondary_node,
                    ),
                ]
            )

        elif any(keyword in normalized_prompt for keyword in ("connect", "link")) and primary_node is not None and secondary_node is not None:
            handled_structural_change = True
            changes.append(
                CanvasEditChangeRecord(
                    id=f"fallback_edge_connect_{primary_node.id}_{secondary_node.id}",
                    kind="create_edge",
                    scope="direct",
                    reason="Connect the targeted notes on the canvas.",
                    impact_basis=[],
                    after_edge=CanvasEdge(
                        id=f"draft_edge_connect_{primary_node.id}_{secondary_node.id}",
                        source_node_id=primary_node.id,
                        target_node_id=secondary_node.id,
                        label="relates to",
                    ),
                )
            )

        elif any(keyword in normalized_prompt for keyword in ("create note", "create node", "add note", "add node", "new note", "new node")) and primary_node is not None:
            handled_structural_change = True
            created_node = CanvasNode(
                id=f"draft_node_related_{primary_node.id}",
                title=f"{primary_node.title} Follow-up",
                description=f"Capture the new concept requested around {primary_node.title.lower()} and keep it linked to the source note.",
                tags=_append_unique_tags(primary_node.tags, ["workflow"]),
                x=0,
                y=0,
                linked_files=primary_node.linked_files,
                linked_symbols=primary_node.linked_symbols,
                linked_canvas_id=None,
            )
            create_change_id = f"fallback_create_node_{primary_node.id}"
            changes.extend(
                [
                    CanvasEditChangeRecord(
                        id=create_change_id,
                        kind="create_node",
                        scope="direct",
                        reason="Add a new note requested by the prompt.",
                        impact_basis=[],
                        target_title=created_node.title,
                        anchor_node_id=primary_node.id,
                        after_node=created_node,
                    ),
                    CanvasEditChangeRecord(
                        id=f"fallback_edge_create_{primary_node.id}",
                        kind="create_edge",
                        scope="direct",
                        reason="Connect the new note back to the targeted note.",
                        impact_basis=[],
                        depends_on_change_ids=[create_change_id],
                        after_edge=CanvasEdge(
                            id=f"draft_edge_create_{primary_node.id}",
                            source_node_id=primary_node.id,
                            target_node_id=created_node.id,
                            label="extends",
                        ),
                    ),
                ]
            )

        if not handled_structural_change:
            for index, node in enumerate(target_nodes[:2]):
                after_node = node.model_copy(deep=True)
                current_description = after_node.description.strip()
                addition = first_prompt_sentence.rstrip(".")
                if current_description:
                    if addition.lower() not in current_description.lower():
                        after_node.description = f"{current_description}\n\nReview note update: {addition}."
                else:
                    after_node.description = f"Review note update: {addition}."
                changes.append(
                    CanvasEditChangeRecord(
                        id=f"fallback_direct_{index}_{node.id}",
                        kind="update_node",
                        scope="direct",
                        reason="Reflect the requested architecture change in this note.",
                        impact_basis=[],
                        target_node_id=node.id,
                        target_title=node.title,
                        before_node=node,
                        after_node=after_node,
                    )
                )

        for index, (node, basis) in enumerate(impacted_notes[:2]):
            after_node = node.model_copy(deep=True)
            basis_text = basis[0] if basis else "related implementation evidence"
            current_description = after_node.description.strip()
            addition = f"Related note review: revisit this note because of {basis_text}."
            after_node.description = f"{current_description}\n\n{addition}".strip()
            changes.append(
                CanvasEditChangeRecord(
                    id=f"fallback_impacted_{index}_{node.id}",
                    kind="update_node",
                    scope="impacted",
                    reason="Keep this related note aligned with the requested change.",
                    impact_basis=basis,
                    target_node_id=node.id,
                    target_title=node.title,
                    before_node=node,
                    after_node=after_node,
                )
            )

        if not changes:
            return [], "No note changes were suggested."
        return changes, f"Drafted {len(changes)} note change{'s' if len(changes) != 1 else ''} for review."

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
