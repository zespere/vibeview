from __future__ import annotations

import json
import logging
from pathlib import Path
from uuid import uuid4

from .models import (
    CanvasDocument,
    CanvasEdge,
    CanvasEdgeCreateRequest,
    GeneratedCanvasEdge,
    GeneratedCanvasNode,
    NoteChangeSummary,
    CanvasNode,
    CanvasNodeCreateRequest,
    CanvasNodeUpdateRequest,
)

logger = logging.getLogger(__name__)


def _normalize_tags(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        tag = value.strip()
        if not tag:
            continue
        lowered = tag.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        result.append(tag)
    return result


class CanvasStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _project_canvas_path(self, repo_path: str) -> Path:
        return Path(repo_path) / ".konceptura" / "canvas.json"

    def _read_document(self, path: Path) -> CanvasDocument:
        if not path.exists():
            return CanvasDocument()
        return CanvasDocument.model_validate(json.loads(path.read_text()))

    def load(self) -> CanvasDocument:
        pointer = self._read_document(self.path)
        if pointer.repo_path:
            project_path = self._project_canvas_path(pointer.repo_path)
            if project_path.exists():
                return self._read_document(project_path)
            return CanvasDocument(repo_path=pointer.repo_path)
        return pointer

    def load_for_repo(self, repo_path: str) -> CanvasDocument:
        project_path = self._project_canvas_path(repo_path)
        if project_path.exists():
            return self._read_document(project_path)
        return CanvasDocument(repo_path=repo_path)

    def save(self, document: CanvasDocument) -> CanvasDocument:
        payload = json.dumps(document.model_dump(mode="json"), indent=2, sort_keys=True)
        self.path.write_text(payload)
        if document.repo_path:
            project_path = self._project_canvas_path(document.repo_path)
            if document.nodes or document.edges or project_path.exists():
                project_path.parent.mkdir(parents=True, exist_ok=True)
                project_path.write_text(payload)
        return document

    def delete_for_repo(self, repo_path: str) -> None:
        project_path = self._project_canvas_path(repo_path)
        if project_path.exists():
            project_path.unlink()
        kon_path = project_path.parent
        if kon_path.exists() and not any(kon_path.iterdir()):
            kon_path.rmdir()


class CanvasService:
    def __init__(self, store: CanvasStore) -> None:
        self.store = store

    def get_document(self) -> CanvasDocument:
        return self.store.load()

    def get_document_for_repo(self, repo_path: str) -> CanvasDocument:
        document = self.store.load_for_repo(repo_path)
        document.repo_path = repo_path
        return self.store.save(document)

    def set_repo_path(self, repo_path: str) -> CanvasDocument:
        document = self.store.load_for_repo(repo_path)
        document.repo_path = repo_path
        return self.store.save(document)

    def reset_repo_canvas(self, repo_path: str) -> CanvasDocument:
        self.store.delete_for_repo(repo_path)
        document = CanvasDocument(repo_path=repo_path)
        return self.store.save(document)

    def create_node(self, request: CanvasNodeCreateRequest) -> CanvasDocument:
        document = self.store.load()
        node = CanvasNode(
            id=f"node_{uuid4().hex[:10]}",
            title=request.title.strip(),
            description=request.description,
            tags=_normalize_tags(request.tags),
            x=request.x,
            y=request.y,
            linked_files=request.linked_files,
            linked_symbols=request.linked_symbols,
        )
        document.nodes.append(node)
        logger.info("Created canvas node %s", node.id)
        return self.store.save(document)

    def update_node(self, node_id: str, request: CanvasNodeUpdateRequest) -> CanvasDocument:
        document = self.store.load()
        node = next((item for item in document.nodes if item.id == node_id), None)
        if node is None:
            raise ValueError(f"Canvas node not found: {node_id}")

        updates = request.model_dump(exclude_unset=True)
        if "tags" in updates and updates["tags"] is not None:
            updates["tags"] = _normalize_tags(updates["tags"])
        for key, value in updates.items():
            setattr(node, key, value)
        return self.store.save(document)

    def delete_node(self, node_id: str) -> CanvasDocument:
        document = self.store.load()
        next_nodes = [item for item in document.nodes if item.id != node_id]
        if len(next_nodes) == len(document.nodes):
            raise ValueError(f"Canvas node not found: {node_id}")
        document.nodes = next_nodes
        document.edges = [
            edge
            for edge in document.edges
            if edge.source_node_id != node_id and edge.target_node_id != node_id
        ]
        logger.info("Deleted canvas node %s", node_id)
        return self.store.save(document)

    def create_edge(self, request: CanvasEdgeCreateRequest) -> CanvasDocument:
        document = self.store.load()
        node_ids = {node.id for node in document.nodes}
        if request.source_node_id not in node_ids or request.target_node_id not in node_ids:
            raise ValueError("Both source and target nodes must exist before creating an edge.")
        if request.source_node_id == request.target_node_id:
            raise ValueError("Canvas edges must connect two different nodes.")

        exists = any(
            edge.source_node_id == request.source_node_id
            and edge.target_node_id == request.target_node_id
            and edge.label == request.label
            for edge in document.edges
        )
        if exists:
            return document

        edge = CanvasEdge(
            id=f"edge_{uuid4().hex[:10]}",
            source_node_id=request.source_node_id,
            target_node_id=request.target_node_id,
            label=request.label,
        )
        document.edges.append(edge)
        logger.info("Created canvas edge %s", edge.id)
        return self.store.save(document)

    def append_generated_map(
        self,
        nodes: list[GeneratedCanvasNode],
        edges: list[GeneratedCanvasEdge],
    ) -> tuple[CanvasDocument, int, NoteChangeSummary]:
        document = self.store.load()
        before_document = document.model_copy(deep=True)
        existing_titles = {node.title.strip().lower(): node for node in document.nodes}
        title_to_id: dict[str, str] = {}
        start_x = 120
        start_y = 120
        gap_x = 320
        gap_y = 220
        created_count = 0

        index = len(document.nodes)
        for generated in nodes:
            normalized_title = generated.title.strip().lower()
            if not normalized_title or normalized_title in existing_titles or normalized_title in title_to_id:
                continue

            col = index % 3
            row = index // 3
            node = CanvasNode(
                id=f"node_{uuid4().hex[:10]}",
                title=generated.title.strip(),
                description=generated.description.strip(),
                tags=_normalize_tags(generated.tags),
                x=start_x + col * gap_x,
                y=start_y + row * gap_y,
                linked_files=generated.linked_files,
                linked_symbols=generated.linked_symbols,
            )
            document.nodes.append(node)
            title_to_id[normalized_title] = node.id
            existing_titles[normalized_title] = node
            created_count += 1
            index += 1

        edge_keys = {
            (edge.source_node_id, edge.target_node_id, edge.label.strip().lower())
            for edge in document.edges
        }
        for generated_edge in edges:
            source = existing_titles.get(generated_edge.source_title.strip().lower())
            target = existing_titles.get(generated_edge.target_title.strip().lower())
            if source is None or target is None or source.id == target.id:
                continue
            key = (source.id, target.id, generated_edge.label.strip().lower())
            if key in edge_keys:
                continue
            edge = CanvasEdge(
                id=f"edge_{uuid4().hex[:10]}",
                source_node_id=source.id,
                target_node_id=target.id,
                label=generated_edge.label.strip(),
            )
            document.edges.append(edge)
            edge_keys.add(key)

        if created_count:
            logger.info("Generated %s canvas nodes from prompt workflow", created_count)
        saved = self.store.save(document)
        note_changes = self._build_note_change_summary(before_document, saved)
        return saved, created_count, note_changes

    def delete_edge(self, edge_id: str) -> CanvasDocument:
        document = self.store.load()
        next_edges = [edge for edge in document.edges if edge.id != edge_id]
        if len(next_edges) == len(document.edges):
            raise ValueError(f"Canvas edge not found: {edge_id}")
        document.edges = next_edges
        logger.info("Deleted canvas edge %s", edge_id)
        return self.store.save(document)

    def _build_note_change_summary(
        self,
        before: CanvasDocument,
        after: CanvasDocument,
    ) -> NoteChangeSummary:
        before_nodes_by_title = {node.title.strip().lower(): node for node in before.nodes}
        after_nodes_by_title = {node.title.strip().lower(): node for node in after.nodes}

        created_titles: list[str] = []
        updated_titles: list[str] = []

        for key, node in after_nodes_by_title.items():
            previous = before_nodes_by_title.get(key)
            if previous is None:
                created_titles.append(node.title)
                continue
            if self._node_changed(previous, node):
                updated_titles.append(node.title)

        before_edge_keys = {
            (edge.source_node_id, edge.target_node_id, edge.label.strip().lower()) for edge in before.edges
        }
        linked_titles: list[str] = []
        seen_links: set[str] = set()
        after_nodes_by_id = {node.id: node for node in after.nodes}
        for edge in after.edges:
            key = (edge.source_node_id, edge.target_node_id, edge.label.strip().lower())
            if key in before_edge_keys:
                continue
            source = after_nodes_by_id.get(edge.source_node_id)
            target = after_nodes_by_id.get(edge.target_node_id)
            if source is None or target is None:
                continue
            label = edge.label.strip() or "linked to"
            text = f"{source.title} {label} {target.title}"
            if text in seen_links:
                continue
            seen_links.add(text)
            linked_titles.append(text)

        summary_parts: list[str] = []
        if created_titles:
            summary_parts.append(
                "Created notes: " + ", ".join(created_titles[:4]) + ("." if len(created_titles) <= 4 else ", ...")
            )
        if updated_titles:
            summary_parts.append(
                "Updated notes: " + ", ".join(updated_titles[:4]) + ("." if len(updated_titles) <= 4 else ", ...")
            )
        if linked_titles:
            summary_parts.append(
                "Linked notes: " + "; ".join(linked_titles[:3]) + ("." if len(linked_titles) <= 3 else "; ...")
            )
        if not summary_parts:
            summary_parts.append("No visible note changes were needed.")

        return NoteChangeSummary(
            summary=" ".join(summary_parts),
            created_titles=created_titles,
            updated_titles=updated_titles,
            linked_titles=linked_titles,
        )

    def _node_changed(self, previous: CanvasNode, current: CanvasNode) -> bool:
        return any(
            [
                previous.description.strip() != current.description.strip(),
                previous.tags != current.tags,
                previous.linked_files != current.linked_files,
                previous.linked_symbols != current.linked_symbols,
            ]
        )
