from __future__ import annotations

import json
import logging
from pathlib import Path
from uuid import uuid4

from .models import (
    CanvasDocument,
    CanvasEdge,
    CanvasEdgeCreateRequest,
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

    def load(self) -> CanvasDocument:
        if not self.path.exists():
            return CanvasDocument()
        return CanvasDocument.model_validate(json.loads(self.path.read_text()))

    def save(self, document: CanvasDocument) -> CanvasDocument:
        self.path.write_text(json.dumps(document.model_dump(mode="json"), indent=2, sort_keys=True))
        return document


class CanvasService:
    def __init__(self, store: CanvasStore) -> None:
        self.store = store

    def get_document(self) -> CanvasDocument:
        return self.store.load()

    def set_repo_path(self, repo_path: str) -> CanvasDocument:
        document = self.store.load()
        document.repo_path = repo_path
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

    def delete_edge(self, edge_id: str) -> CanvasDocument:
        document = self.store.load()
        next_edges = [edge for edge in document.edges if edge.id != edge_id]
        if len(next_edges) == len(document.edges):
            raise ValueError(f"Canvas edge not found: {edge_id}")
        document.edges = next_edges
        logger.info("Deleted canvas edge %s", edge_id)
        return self.store.save(document)
