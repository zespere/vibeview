from __future__ import annotations

import json
import logging
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from .models import (
    CanvasCollection,
    CanvasCreateRequest,
    CanvasCreateFromSnapshotRequest,
    CanvasDuplicateRequest,
    CanvasEditChangeRecord,
    CanvasDocument,
    CanvasEdge,
    CanvasEdgeCreateRequest,
    CanvasSummary,
    CanvasUpdateRequest,
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

    def _project_canvases_path(self, repo_path: str) -> Path:
        return Path(repo_path) / ".konceptura" / "canvases.json"

    def _ensure_konceptura_gitignore(self, repo_path: str) -> None:
        konceptura_dir = Path(repo_path) / ".konceptura"
        konceptura_dir.mkdir(parents=True, exist_ok=True)
        gitignore_path = konceptura_dir / ".gitignore"
        desired = "*\n!.gitignore\n!canvas.json\n!canvases.json\n"
        current = gitignore_path.read_text() if gitignore_path.exists() else None
        if current != desired:
            gitignore_path.write_text(desired)

    def _read_document(self, path: Path) -> CanvasDocument:
        if not path.exists():
            return CanvasDocument()
        return CanvasDocument.model_validate(json.loads(path.read_text()))

    def _read_collection(self, path: Path) -> CanvasCollection:
        if not path.exists():
            return CanvasCollection()
        return CanvasCollection.model_validate(json.loads(path.read_text()))

    def _normalize_canvas(self, repo_path: str, document: CanvasDocument, index: int = 0) -> CanvasDocument:
        return document.model_copy(
            update={
                "id": document.id or f"canvas_{uuid4().hex[:10]}",
                "title": (document.title or "").strip() or ("Overview" if index == 0 else f"Canvas {index + 1}"),
                "repo_path": repo_path,
            }
        )

    def load(self) -> CanvasDocument:
        pointer = self._read_document(self.path)
        if pointer.repo_path:
            return self.get_default_for_repo(pointer.repo_path)
        return pointer

    def load_collection_for_repo(self, repo_path: str) -> CanvasCollection:
        collection_path = self._project_canvases_path(repo_path)
        if collection_path.exists():
            collection = self._read_collection(collection_path)
            collection.repo_path = repo_path
            collection.canvases = [
                self._normalize_canvas(repo_path, canvas, index)
                for index, canvas in enumerate(collection.canvases)
            ]
            return collection

        legacy_document = self._read_document(self._project_canvas_path(repo_path))
        if legacy_document.nodes or legacy_document.edges or legacy_document.id or legacy_document.title != "Canvas":
            canvas = self._normalize_canvas(repo_path, legacy_document, 0)
            collection = CanvasCollection(repo_path=repo_path, canvases=[canvas])
            self.save_collection(collection)
            return collection
        return CanvasCollection(repo_path=repo_path, canvases=[])

    def get_default_for_repo(self, repo_path: str) -> CanvasDocument:
        collection = self.load_collection_for_repo(repo_path)
        if collection.canvases:
            return collection.canvases[0]
        return CanvasDocument(repo_path=repo_path, title="Canvas")

    def save_collection(self, collection: CanvasCollection) -> CanvasCollection:
        if not collection.repo_path:
            return collection
        repo_path = collection.repo_path
        self._ensure_konceptura_gitignore(repo_path)
        collection.canvases = [
            self._normalize_canvas(repo_path, canvas, index)
            for index, canvas in enumerate(collection.canvases)
        ]
        payload = json.dumps(collection.model_dump(mode="json"), indent=2, sort_keys=True)
        self._project_canvases_path(repo_path).write_text(payload)

        pointer_document = collection.canvases[0] if collection.canvases else CanvasDocument(repo_path=repo_path, title="Canvas")
        self.path.write_text(json.dumps(pointer_document.model_dump(mode="json"), indent=2, sort_keys=True))
        legacy_path = self._project_canvas_path(repo_path)
        if collection.canvases:
            legacy_path.write_text(
                json.dumps(collection.canvases[0].model_dump(mode="json"), indent=2, sort_keys=True)
            )
        elif legacy_path.exists():
            legacy_path.unlink()
        return collection

    def delete_for_repo(self, repo_path: str) -> None:
        for project_path in [self._project_canvas_path(repo_path), self._project_canvases_path(repo_path)]:
            if project_path.exists():
                project_path.unlink()
        kon_path = self._project_canvas_path(repo_path).parent
        if kon_path.exists() and not any(kon_path.iterdir()):
            kon_path.rmdir()


class CanvasService:
    def __init__(self, store: CanvasStore) -> None:
        self.store = store

    def list_canvases_for_repo(self, repo_path: str) -> list[CanvasSummary]:
        collection = self.store.load_collection_for_repo(repo_path)
        return [
            CanvasSummary(id=canvas.id or f"canvas_{index}", title=canvas.title, node_count=len(canvas.nodes))
            for index, canvas in enumerate(collection.canvases)
        ]

    def get_document(self) -> CanvasDocument:
        return self.store.load()

    def get_document_for_repo(self, repo_path: str, canvas_id: str | None = None) -> CanvasDocument:
        collection = self.store.load_collection_for_repo(repo_path)
        if canvas_id:
            target = next((canvas for canvas in collection.canvases if canvas.id == canvas_id), None)
            if target is None:
                raise ValueError(f"Canvas not found: {canvas_id}")
            return target
        return self.store.get_default_for_repo(repo_path)

    def set_repo_path(self, repo_path: str) -> CanvasDocument:
        document = self.store.get_default_for_repo(repo_path)
        self.store.path.write_text(json.dumps(document.model_dump(mode="json"), indent=2, sort_keys=True))
        return document

    def create_canvas(self, request: CanvasCreateRequest) -> CanvasDocument:
        repo_path = request.repo_path
        collection = self.store.load_collection_for_repo(repo_path)
        requested_title = (request.title or "").strip() or f"Canvas {len(collection.canvases) + 1}"
        title = self._dedupe_canvas_title(collection, requested_title)
        document = CanvasDocument(
            id=f"canvas_{uuid4().hex[:10]}",
            title=title,
            repo_path=repo_path,
            nodes=[],
            edges=[],
        )
        collection.canvases.append(document)
        self.store.save_collection(collection)
        return document

    def create_canvas_from_snapshot(self, request: CanvasCreateFromSnapshotRequest) -> CanvasDocument:
        repo_path = request.repo_path
        collection = self.store.load_collection_for_repo(repo_path)
        requested_title = (request.title or "").strip() or f"Canvas {len(collection.canvases) + 1}"
        title = self._dedupe_canvas_title(collection, requested_title)
        nodes, edges = self._normalize_snapshot_layout(
            deepcopy(request.nodes),
            deepcopy(request.edges),
        )
        document = CanvasDocument(
            id=f"canvas_{uuid4().hex[:10]}",
            title=title,
            repo_path=repo_path,
            nodes=nodes,
            edges=edges,
        )
        collection.canvases.append(document)
        self.store.save_collection(collection)
        return document

    def update_canvas(self, request: CanvasUpdateRequest, canvas_id: str) -> CanvasDocument:
        collection = self.store.load_collection_for_repo(request.repo_path)
        document = next((canvas for canvas in collection.canvases if canvas.id == canvas_id), None)
        if document is None:
            raise ValueError(f"Canvas not found: {canvas_id}")
        next_title = request.title.strip()
        if not next_title:
            raise ValueError("Canvas title cannot be empty.")
        normalized = next_title.lower()
        if any(canvas.id != canvas_id and canvas.title.strip().lower() == normalized for canvas in collection.canvases):
            raise ValueError(f'Canvas title already exists: "{next_title}"')
        document.title = next_title
        self.store.save_collection(collection)
        return document

    def duplicate_canvas(self, request: CanvasDuplicateRequest, canvas_id: str) -> CanvasDocument:
        collection = self.store.load_collection_for_repo(request.repo_path)
        source = next((canvas for canvas in collection.canvases if canvas.id == canvas_id), None)
        if source is None:
            raise ValueError(f"Canvas not found: {canvas_id}")
        requested_title = (request.title or "").strip() or f"{source.title} Copy"
        next_title = self._dedupe_canvas_title(collection, requested_title)
        duplicate = deepcopy(source)
        duplicate.id = f"canvas_{uuid4().hex[:10]}"
        duplicate.title = next_title
        collection.canvases.append(duplicate)
        self.store.save_collection(collection)
        return duplicate

    def delete_canvas(self, repo_path: str, canvas_id: str) -> CanvasCollection:
        collection = self.store.load_collection_for_repo(repo_path)
        next_canvases = [canvas for canvas in collection.canvases if canvas.id != canvas_id]
        if len(next_canvases) == len(collection.canvases):
            raise ValueError(f"Canvas not found: {canvas_id}")
        collection.canvases = next_canvases
        self.store.save_collection(collection)
        return collection

    def reset_repo_canvas(self, repo_path: str, canvas_id: str | None = None) -> CanvasDocument:
        collection, document = self._load_canvas(repo_path, canvas_id)
        document.nodes = []
        document.edges = []
        self._save_canvas(collection, document)
        return document

    def create_node(self, request: CanvasNodeCreateRequest) -> CanvasDocument:
        collection, document = self._load_canvas(request.repo_path, request.canvas_id)
        node = CanvasNode(
            id=f"node_{uuid4().hex[:10]}",
            title=request.title.strip(),
            description=request.description,
            tags=_normalize_tags(request.tags),
            x=request.x,
            y=request.y,
            linked_files=request.linked_files,
            linked_symbols=request.linked_symbols,
            linked_canvas_id=request.linked_canvas_id,
        )
        document.nodes.append(node)
        logger.info("Created canvas node %s", node.id)
        self._save_canvas(collection, document)
        return document

    def update_node(self, repo_path: str, canvas_id: str | None, node_id: str, request: CanvasNodeUpdateRequest) -> CanvasDocument:
        collection, document = self._load_canvas(repo_path, canvas_id)
        node = next((item for item in document.nodes if item.id == node_id), None)
        if node is None:
            raise ValueError(f"Canvas node not found: {node_id}")

        updates = request.model_dump(exclude_unset=True)
        if "tags" in updates and updates["tags"] is not None:
            updates["tags"] = _normalize_tags(updates["tags"])
        for key, value in updates.items():
            setattr(node, key, value)
        self._save_canvas(collection, document)
        return document

    def delete_node(self, repo_path: str, canvas_id: str | None, node_id: str) -> CanvasDocument:
        collection, document = self._load_canvas(repo_path, canvas_id)
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
        self._save_canvas(collection, document)
        return document

    def create_edge(self, request: CanvasEdgeCreateRequest) -> CanvasDocument:
        collection, document = self._load_canvas(request.repo_path, request.canvas_id)
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
        self._save_canvas(collection, document)
        return document

    def _load_canvas(self, repo_path: str, canvas_id: str | None) -> tuple[CanvasCollection, CanvasDocument]:
        collection = self.store.load_collection_for_repo(repo_path)
        if not collection.canvases:
            created = self.create_canvas(CanvasCreateRequest(repo_path=repo_path, title="Overview"))
            collection = self.store.load_collection_for_repo(repo_path)
            target = next((canvas for canvas in collection.canvases if canvas.id == created.id), created)
            return collection, target

        if canvas_id:
            target = next((canvas for canvas in collection.canvases if canvas.id == canvas_id), None)
            if target is None:
                raise ValueError(f"Canvas not found: {canvas_id}")
            return collection, target

        return collection, collection.canvases[0]

    def _save_canvas(self, collection: CanvasCollection, document: CanvasDocument) -> None:
        collection.canvases = [document if canvas.id == document.id else canvas for canvas in collection.canvases]
        self.store.save_collection(collection)

    def _dedupe_canvas_title(self, collection: CanvasCollection, requested_title: str) -> str:
        normalized_titles = {canvas.title.strip().lower() for canvas in collection.canvases}
        candidate = requested_title.strip() or "Canvas"
        if candidate.lower() not in normalized_titles:
            return candidate
        suffix = 2
        while True:
            next_candidate = f"{candidate} {suffix}"
            if next_candidate.lower() not in normalized_titles:
                return next_candidate
            suffix += 1

    def _normalize_snapshot_layout(
        self,
        nodes: list[CanvasNode],
        edges: list[CanvasEdge],
    ) -> tuple[list[CanvasNode], list[CanvasEdge]]:
        if not nodes:
            return [], []

        valid_node_ids = {node.id for node in nodes}
        filtered_edges = [
            edge
            for edge in edges
            if edge.source_node_id in valid_node_ids and edge.target_node_id in valid_node_ids
        ]
        min_x = min(node.x for node in nodes)
        min_y = min(node.y for node in nodes)
        offset_x = 120 - min_x
        offset_y = 120 - min_y

        normalized_nodes = [
            node.model_copy(
                update={
                    "x": node.x + offset_x,
                    "y": node.y + offset_y,
                }
            )
            for node in nodes
        ]
        return normalized_nodes, filtered_edges

    def append_generated_map(
        self,
        repo_path: str,
        canvas_id: str | None,
        nodes: list[GeneratedCanvasNode],
        edges: list[GeneratedCanvasEdge],
    ) -> tuple[CanvasDocument, int, NoteChangeSummary]:
        collection, document = self._load_canvas(repo_path, canvas_id)
        before_document = document.model_copy(deep=True)
        existing_titles = {node.title.strip().lower(): node for node in document.nodes}
        title_to_id: dict[str, str] = {}
        created_count = 0
        for generated in nodes:
            normalized_title = generated.title.strip().lower()
            if not normalized_title or normalized_title in existing_titles or normalized_title in title_to_id:
                continue

            x, y = self._resolve_generated_node_position(
                generated=generated,
                generated_edges=edges,
                existing_titles=existing_titles,
                document=document,
            )
            node = CanvasNode(
                id=f"node_{uuid4().hex[:10]}",
                title=generated.title.strip(),
                description=generated.description.strip(),
                tags=_normalize_tags(generated.tags),
                x=x,
                y=y,
                linked_files=generated.linked_files,
                linked_symbols=generated.linked_symbols,
                linked_canvas_id=None,
            )
            document.nodes.append(node)
            title_to_id[normalized_title] = node.id
            existing_titles[normalized_title] = node
            created_count += 1

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
        self._save_canvas(collection, document)
        note_changes = self._build_note_change_summary(before_document, document)
        return document, created_count, note_changes

    def delete_edge(self, repo_path: str, canvas_id: str | None, edge_id: str) -> CanvasDocument:
        collection, document = self._load_canvas(repo_path, canvas_id)
        next_edges = [edge for edge in document.edges if edge.id != edge_id]
        if len(next_edges) == len(document.edges):
            raise ValueError(f"Canvas edge not found: {edge_id}")
        document.edges = next_edges
        logger.info("Deleted canvas edge %s", edge_id)
        self._save_canvas(collection, document)
        return document

    def find_impacted_notes(
        self,
        document: CanvasDocument,
        target_node_ids: list[str],
    ) -> dict[str, list[str]]:
        target_nodes = [node for node in document.nodes if node.id in set(target_node_ids)]
        if not target_nodes:
            return {}

        target_files = {path for node in target_nodes for path in node.linked_files if path.strip()}
        target_symbols = {symbol for node in target_nodes for symbol in node.linked_symbols if symbol.strip()}
        edge_bases: dict[str, list[str]] = {}
        for edge in document.edges:
            if edge.source_node_id in target_node_ids and edge.target_node_id not in target_node_ids:
                edge_bases.setdefault(edge.target_node_id, []).append(
                    f"linked from {self._title_for_node_id(document, edge.source_node_id)} via {edge.label.strip() or 'connection'}"
                )
            elif edge.target_node_id in target_node_ids and edge.source_node_id not in target_node_ids:
                edge_bases.setdefault(edge.source_node_id, []).append(
                    f"linked to {self._title_for_node_id(document, edge.target_node_id)} via {edge.label.strip() or 'connection'}"
                )

        impacted: dict[str, list[str]] = {}
        for node in document.nodes:
            if node.id in target_node_ids:
                continue
            reasons: list[str] = []
            shared_files = sorted(target_files.intersection(node.linked_files))
            shared_symbols = sorted(target_symbols.intersection(node.linked_symbols))
            if shared_files:
                reasons.append(f"shared file: {shared_files[0]}")
            if shared_symbols:
                reasons.append(f"shared symbol: {shared_symbols[0]}")
            reasons.extend(edge_bases.get(node.id, []))
            if reasons:
                impacted[node.id] = reasons[:3]
        return impacted

    def apply_canvas_edit_changes(
        self,
        repo_path: str,
        canvas_id: str | None,
        changes: list[CanvasEditChangeRecord],
        accepted_change_ids: list[str],
    ) -> tuple[CanvasDocument, NoteChangeSummary, list[str], list[str]]:
        collection, document = self._load_canvas(repo_path, canvas_id)
        before_document = document.model_copy(deep=True)
        changes_by_id = {change.id: change for change in changes}
        accepted_ids = {change_id for change_id in accepted_change_ids if change_id.strip()}
        pending = list(accepted_ids)
        while pending:
            current_id = pending.pop()
            change = changes_by_id.get(current_id)
            if change is None:
                continue
            for dependency_id in change.depends_on_change_ids:
                if dependency_id and dependency_id not in accepted_ids:
                    accepted_ids.add(dependency_id)
                    pending.append(dependency_id)
        applied_change_ids: list[str] = []

        existing_nodes = {node.id: node for node in document.nodes}
        existing_titles = {node.title.strip().lower(): node.id for node in document.nodes}
        created_node_ids: dict[str, str] = {}

        for change in changes:
            if change.id not in accepted_ids or change.kind != "create_node" or change.after_node is None:
                continue
            draft_node = change.after_node
            next_title = draft_node.title.strip()
            normalized_next_title = next_title.lower()
            owner_of_title = existing_titles.get(normalized_next_title)
            if owner_of_title:
                raise ValueError(f'Cannot create "{next_title}" because that title already exists.')

            next_x, next_y = self._resolve_canvas_edit_node_position(document, draft_node, change.anchor_node_id)
            created_node = CanvasNode(
                id=f"node_{uuid4().hex[:10]}",
                title=next_title,
                description=draft_node.description,
                tags=_normalize_tags(draft_node.tags),
                x=next_x,
                y=next_y,
                linked_files=[item.strip() for item in draft_node.linked_files if item.strip()],
                linked_symbols=[item.strip() for item in draft_node.linked_symbols if item.strip()],
                linked_canvas_id=draft_node.linked_canvas_id,
            )
            document.nodes.append(created_node)
            existing_nodes[created_node.id] = created_node
            existing_titles[normalized_next_title] = created_node.id
            created_node_ids[draft_node.id] = created_node.id
            applied_change_ids.append(change.id)

        for change in changes:
            if change.id not in accepted_ids or change.kind != "update_node" or change.after_node is None or not change.target_node_id:
                continue
            node = existing_nodes.get(change.target_node_id)
            if node is None:
                continue

            next_title = change.after_node.title.strip()
            normalized_next_title = next_title.lower()
            owner_of_title = existing_titles.get(normalized_next_title)
            if owner_of_title and owner_of_title != node.id:
                raise ValueError(f'Cannot rename "{node.title}" to "{next_title}" because that title already exists.')

            existing_titles.pop(node.title.strip().lower(), None)
            node.title = next_title
            node.description = change.after_node.description
            node.tags = _normalize_tags(change.after_node.tags)
            node.linked_files = [item.strip() for item in change.after_node.linked_files if item.strip()]
            node.linked_symbols = [item.strip() for item in change.after_node.linked_symbols if item.strip()]
            node.linked_canvas_id = change.after_node.linked_canvas_id
            existing_titles[normalized_next_title] = node.id
            if change.id not in applied_change_ids:
                applied_change_ids.append(change.id)

        edge_keys = {
            (edge.source_node_id, edge.target_node_id, edge.label.strip().lower())
            for edge in document.edges
        }
        for change in changes:
            if change.id not in accepted_ids or change.kind != "create_edge" or change.after_edge is None:
                continue

            source_node_id = created_node_ids.get(change.after_edge.source_node_id, change.after_edge.source_node_id)
            target_node_id = created_node_ids.get(change.after_edge.target_node_id, change.after_edge.target_node_id)
            if source_node_id not in existing_nodes or target_node_id not in existing_nodes:
                raise ValueError("Cannot create a canvas edge before all referenced notes exist.")
            if source_node_id == target_node_id:
                continue

            edge_label = change.after_edge.label.strip()
            edge_key = (source_node_id, target_node_id, edge_label.lower())
            if edge_key in edge_keys:
                continue

            edge = CanvasEdge(
                id=f"edge_{uuid4().hex[:10]}",
                source_node_id=source_node_id,
                target_node_id=target_node_id,
                label=edge_label,
            )
            document.edges.append(edge)
            edge_keys.add(edge_key)
            applied_change_ids.append(change.id)

        deleted_node_ids: set[str] = set()
        for change in changes:
            if change.id not in accepted_ids or change.kind != "delete_node" or not change.target_node_id:
                continue
            if change.target_node_id in created_node_ids:
                target_node_id = created_node_ids[change.target_node_id]
            else:
                target_node_id = change.target_node_id
            node = existing_nodes.get(target_node_id)
            if node is None:
                continue
            deleted_node_ids.add(target_node_id)
            existing_titles.pop(node.title.strip().lower(), None)
            existing_nodes.pop(target_node_id, None)
            applied_change_ids.append(change.id)

        if deleted_node_ids:
            document.nodes = [node for node in document.nodes if node.id not in deleted_node_ids]
            document.edges = [
                edge
                for edge in document.edges
                if edge.source_node_id not in deleted_node_ids and edge.target_node_id not in deleted_node_ids
            ]

        self._save_canvas(collection, document)
        note_changes = self._build_note_change_summary(before_document, document)
        remaining_change_ids = [change.id for change in changes if change.id not in set(applied_change_ids)]
        return document, note_changes, applied_change_ids, remaining_change_ids

    def _resolve_canvas_edit_node_position(
        self,
        document: CanvasDocument,
        draft_node: CanvasNode,
        anchor_node_id: str | None,
    ) -> tuple[int, int]:
        if anchor_node_id:
            anchor_node = next((node for node in document.nodes if node.id == anchor_node_id), None)
            if anchor_node is not None:
                return self._find_open_position(document, anchor_node.x + 320, anchor_node.y)

        if draft_node.x or draft_node.y:
            return self._find_open_position(document, draft_node.x, draft_node.y)

        zone_x, zone_y = self._tag_zone_origin(draft_node.tags)
        return self._find_open_position(document, zone_x, zone_y)

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

    def _title_for_node_id(self, document: CanvasDocument, node_id: str) -> str:
        node = next((item for item in document.nodes if item.id == node_id), None)
        return node.title if node else node_id

    def _node_changed(self, previous: CanvasNode, current: CanvasNode) -> bool:
        return any(
            [
                previous.description.strip() != current.description.strip(),
                previous.tags != current.tags,
                previous.linked_files != current.linked_files,
                previous.linked_symbols != current.linked_symbols,
                previous.linked_canvas_id != current.linked_canvas_id,
            ]
        )

    def _resolve_generated_node_position(
        self,
        generated: GeneratedCanvasNode,
        generated_edges: list[GeneratedCanvasEdge],
        existing_titles: dict[str, CanvasNode],
        document: CanvasDocument,
    ) -> tuple[int, int]:
        normalized_title = generated.title.strip().lower()
        neighbor_positions: list[tuple[int, int]] = []
        for edge in generated_edges:
            source_title = edge.source_title.strip().lower()
            target_title = edge.target_title.strip().lower()
            if normalized_title not in {source_title, target_title}:
                continue
            other_title = target_title if source_title == normalized_title else source_title
            existing = existing_titles.get(other_title)
            if existing is not None:
                neighbor_positions.append((existing.x, existing.y))

        if neighbor_positions:
            center_x = round(sum(x for x, _ in neighbor_positions) / len(neighbor_positions))
            center_y = round(sum(y for _, y in neighbor_positions) / len(neighbor_positions))
            return self._find_open_position(document, center_x + 280, center_y)

        zone_x, zone_y = self._tag_zone_origin(generated.tags)
        return self._find_open_position(document, zone_x, zone_y)

    def _tag_zone_origin(self, tags: list[str]) -> tuple[int, int]:
        tag_set = {tag.strip().lower() for tag in tags if tag.strip()}
        if {"ui-surface", "screen", "layout", "shell"} & tag_set:
            return (120, 120)
        if {"workflow", "feature", "domain"} & tag_set:
            return (460, 160)
        if {"state", "entity", "policy"} & tag_set:
            return (820, 140)
        if {"boundary", "integration", "data", "persistence"} & tag_set:
            return (1120, 220)
        return (420, 420)

    def _find_open_position(self, document: CanvasDocument, start_x: int, start_y: int) -> tuple[int, int]:
        gap_x = 300
        gap_y = 220
        occupied = [(node.x, node.y) for node in document.nodes]
        for col in range(0, 8):
            x_candidates = [start_x] if col == 0 else [start_x + col * gap_x, start_x - col * gap_x]
            for x in x_candidates:
                for row in range(0, 12):
                    y = start_y + row * gap_y
                    if self._position_is_open(x, y, occupied):
                        return (x, y)
                    y_up = start_y - row * gap_y
                    if row != 0 and self._position_is_open(x, y_up, occupied):
                        return (x, y_up)
        return (start_x, start_y)

    def _position_is_open(self, x: int, y: int, occupied: list[tuple[int, int]]) -> bool:
        for other_x, other_y in occupied:
            if abs(other_x - x) < 220 and abs(other_y - y) < 140:
                return False
        return True
