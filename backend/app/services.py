from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from neo4j import GraphDatabase
from neo4j.graph import Node, Path as Neo4jPath, Relationship

from .config import settings
from .models import (
    AssistImpactResponse,
    ImpactFileRecord,
    ImpactRelationshipRecord,
    ImpactSeed,
    IndexJobState,
    RelationshipRecord,
    StructureNode,
    SymbolRecord,
)

logger = logging.getLogger(__name__)

SEARCHABLE_SYMBOL_LABELS = [
    "Project",
    "Folder",
    "File",
    "Module",
    "Class",
    "Interface",
    "TypeAlias",
    "Function",
    "Method",
]
IMPACT_RELATIONSHIPS = [
    ("CALLS", "incoming"),
    ("CALLS", "outgoing"),
    ("IMPORTS", "incoming"),
    ("IMPORTS", "outgoing"),
]


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _clean_log_output(output: str) -> str:
    ansi_pattern = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
    cleaned = ansi_pattern.sub("", output).strip()
    return cleaned[-1500:] if cleaned else ""


def _serialize_value(value: Any) -> Any:
    if isinstance(value, Node):
        return {
            "labels": list(value.labels),
            "properties": dict(value.items()),
        }
    if isinstance(value, Relationship):
        return {
            "type": value.type,
            "properties": dict(value.items()),
        }
    if isinstance(value, Neo4jPath):
        return {
            "nodes": [_serialize_value(node) for node in value.nodes],
            "relationships": [_serialize_value(rel) for rel in value.relationships],
        }
    if isinstance(value, list):
        return [_serialize_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _serialize_value(item) for key, item in value.items()}
    return value


def _as_string(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _symbol_display_value(symbol: SymbolRecord) -> str:
    properties = symbol.properties
    return str(properties.get("qualified_name") or properties.get("path") or properties.get("name") or "unknown")


def _tokenize_query(text: str) -> list[str]:
    tokens = [token for token in re.split(r"[^a-zA-Z0-9]+", text.lower()) if len(token) >= 2]
    return list(dict.fromkeys(tokens))


def _token_variants(token: str) -> set[str]:
    variants = {token}
    if token.endswith("ies") and len(token) > 4:
        variants.add(token[:-3] + "y")
    if token.endswith("s") and len(token) > 3:
        variants.add(token[:-1])
    if token.endswith("ing") and len(token) > 5:
        variants.add(token[:-3])
        variants.add(f"{token[:-3]}e")
    if token.endswith("ed") and len(token) > 4:
        variants.add(token[:-2])
        variants.add(token[:-1])
    return {value for value in variants if len(value) >= 2}


def _score_symbol(symbol: SymbolRecord, query_text: str, tokens: list[str]) -> tuple[float, str]:
    haystack = " ".join(
        str(value).lower()
        for value in (
            symbol.properties.get("qualified_name"),
            symbol.properties.get("path"),
            symbol.properties.get("name"),
        )
        if value
    )
    if not haystack:
        return 0.0, ""

    score = 0.0
    reasons: list[str] = []
    phrase = query_text.strip().lower()
    if phrase and phrase in haystack:
        score += 6.0
        reasons.append("matched full phrase")

    for token in tokens:
        variants = _token_variants(token)
        matches = sorted({variant for variant in variants if variant in haystack})
        if not matches:
            continue
        score += 2.5
        if any(haystack.startswith(match) for match in matches):
            score += 1.0
        reasons.append(f"matched {matches[0]}")

    primary_label = symbol.labels[0] if symbol.labels else ""
    if primary_label in {"Function", "Method", "Module"}:
        score += 0.25

    reason = ", ".join(dict.fromkeys(reasons))
    return score, reason


class StateStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {
                "active_repo_path": None,
                "index_job": IndexJobState().model_dump(mode="json"),
            }
        return json.loads(self.path.read_text())

    def save(self, payload: dict[str, Any]) -> None:
        self.path.write_text(json.dumps(payload, indent=2, sort_keys=True))


class GraphService:
    def __init__(self) -> None:
        auth = None
        if settings.memgraph_username:
            auth = (settings.memgraph_username, settings.memgraph_password)
        self.driver = GraphDatabase.driver(settings.memgraph_uri, auth=auth)

    def healthcheck(self) -> bool:
        try:
            result = self.run_query("RETURN 1 AS ok")
            return bool(result and result[0].get("ok") == 1)
        except Exception:
            logger.exception("Memgraph healthcheck failed")
            return False

    def run_query(self, query: str, parameters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        with self.driver.session() as session:
            records = session.run(query, parameters or {})
            return [
                {key: _serialize_value(value) for key, value in record.items()}
                for record in records
            ]

    def list_symbols(self, query_text: str | None, labels: list[str], limit: int) -> list[SymbolRecord]:
        cypher = """
        MATCH (n)
        WHERE any(label IN labels(n) WHERE label IN $labels)
          AND (
            $query_text IS NULL
            OR toLower(coalesce(n.qualified_name, n.name, n.path, "")) CONTAINS toLower($query_text)
            OR toLower(coalesce(n.path, "")) CONTAINS toLower($query_text)
          )
        RETURN labels(n) AS labels, properties(n) AS properties
        ORDER BY coalesce(properties(n).qualified_name, properties(n).name, properties(n).path, "")
        LIMIT $limit
        """
        rows = self.run_query(
            cypher,
            {"labels": labels, "query_text": query_text, "limit": limit},
        )
        return [SymbolRecord(**row) for row in rows]

    def search_symbols_ranked(self, query_text: str, labels: list[str], limit: int) -> list[ImpactSeed]:
        tokens = _tokenize_query(query_text)
        cypher = """
        MATCH (n)
        WHERE any(label IN labels(n) WHERE label IN $labels)
          AND (
            size($tokens) = 0
            OR any(token IN $tokens WHERE
              toLower(coalesce(n.qualified_name, n.name, n.path, "")) CONTAINS token
              OR toLower(coalesce(n.path, "")) CONTAINS token
            )
          )
        RETURN labels(n) AS labels, properties(n) AS properties
        LIMIT 500
        """
        rows = self.run_query(cypher, {"labels": labels, "tokens": tokens})
        scored: list[tuple[float, str, SymbolRecord]] = []
        for row in rows:
            symbol = SymbolRecord(**row)
            score, reason = _score_symbol(symbol, query_text, tokens)
            if score <= 0:
                continue
            scored.append((score, reason, symbol))

        scored.sort(
            key=lambda item: (
                -item[0],
                _symbol_display_value(item[2]),
            )
        )

        results: list[ImpactSeed] = []
        for score, reason, symbol in scored[:limit]:
            results.append(
                ImpactSeed(
                    score=round(score, 2),
                    reason=reason or "matched search tokens",
                    file_path=self.resolve_symbol_path(symbol),
                    symbol=symbol,
                )
            )
        return results

    def get_relationships(
        self,
        qualified_name: str,
        relationship: str,
        direction: str,
        limit: int,
    ) -> list[RelationshipRecord]:
        queries = {
            "outgoing": """
                MATCH (src {qualified_name: $qualified_name})-[r]->(dst)
                WHERE type(r) = $relationship
                RETURN type(r) AS relationship, 'outgoing' AS direction,
                       labels(dst) AS labels, properties(dst) AS properties
                ORDER BY coalesce(properties(dst).qualified_name, properties(dst).name, properties(dst).path, "")
                LIMIT $limit
            """,
            "incoming": """
                MATCH (src)-[r]->(dst {qualified_name: $qualified_name})
                WHERE type(r) = $relationship
                RETURN type(r) AS relationship, 'incoming' AS direction,
                       labels(src) AS labels, properties(src) AS properties
                ORDER BY coalesce(properties(src).qualified_name, properties(src).name, properties(src).path, "")
                LIMIT $limit
            """,
        }

        selected = ["outgoing", "incoming"] if direction == "both" else [direction]
        records: list[RelationshipRecord] = []
        params = {
            "qualified_name": qualified_name,
            "relationship": relationship,
            "limit": limit,
        }

        for key in selected:
            rows = self.run_query(queries[key], params)
            records.extend(
                RelationshipRecord(
                    relationship=row["relationship"],
                    direction=row["direction"],
                    other_node=SymbolRecord(
                        labels=row["labels"],
                        properties=row["properties"],
                    ),
                )
                for row in rows
            )
        return records

    def resolve_symbol_path(self, symbol: SymbolRecord) -> str | None:
        direct_path = _as_string(symbol.properties.get("path"))
        if direct_path:
            return direct_path

        qualified_name = _as_string(symbol.properties.get("qualified_name"))
        if not qualified_name:
            return None

        rows = self.run_query(
            """
            MATCH (module:Module)
            WHERE $qualified_name = module.qualified_name
               OR $qualified_name STARTS WITH (module.qualified_name + '.')
            RETURN module.path AS path, size(module.qualified_name) AS depth
            ORDER BY depth DESC
            LIMIT 1
            """,
            {"qualified_name": qualified_name},
        )
        if rows and isinstance(rows[0].get("path"), str):
            return rows[0]["path"]
        return None

    def analyze_impact(self, prompt: str, limit: int) -> AssistImpactResponse:
        seeds = self.search_symbols_ranked(prompt, SEARCHABLE_SYMBOL_LABELS, limit)
        if not seeds:
            return AssistImpactResponse(
                prompt=prompt,
                summary="No matching symbols were found in the current graph.",
                seeds=[],
                related_symbols=[],
                affected_files=[],
            )

        related_symbols: list[ImpactRelationshipRecord] = []
        file_reasons: dict[str, set[str]] = defaultdict(set)
        seen_relationships: set[tuple[str, str, str, str]] = set()

        for seed in seeds:
            seed_name = _symbol_display_value(seed.symbol)
            if seed.file_path:
                file_reasons[seed.file_path].add(f"direct match: {seed_name}")

            source_qualified_name = _as_string(seed.symbol.properties.get("qualified_name"))
            if not source_qualified_name:
                continue

            for relationship, direction in IMPACT_RELATIONSHIPS:
                items = self.get_relationships(source_qualified_name, relationship, direction, limit=4)
                for item in items:
                    target_name = _symbol_display_value(item.other_node)
                    relationship_key = (
                        source_qualified_name,
                        relationship,
                        direction,
                        target_name,
                    )
                    if relationship_key in seen_relationships:
                        continue
                    seen_relationships.add(relationship_key)

                    file_path = self.resolve_symbol_path(item.other_node)
                    reason = f"{direction} {relationship.lower()} edge with {seed_name}"
                    related_symbols.append(
                        ImpactRelationshipRecord(
                            source_qualified_name=source_qualified_name,
                            relationship=relationship,
                            direction=direction,
                            reason=reason,
                            file_path=file_path,
                            other_node=item.other_node,
                        )
                    )
                    if file_path:
                        file_reasons[file_path].add(reason)

        affected_files = [
            ImpactFileRecord(path=path, reasons=sorted(reasons))
            for path, reasons in sorted(
                file_reasons.items(),
                key=lambda item: (-len(item[1]), item[0]),
            )[:limit]
        ]

        top_files = ", ".join(file.path for file in affected_files[:3]) or "no concrete files yet"
        summary = (
            f"Matched {len(seeds)} seed symbols and {len(affected_files)} likely files for "
            f"'{prompt}'. Start with {top_files}."
        )
        return AssistImpactResponse(
            prompt=prompt,
            summary=summary,
            seeds=seeds,
            related_symbols=related_symbols[: limit * 4],
            affected_files=affected_files,
        )

    def get_structure(self, project_name: str) -> StructureNode:
        exists = self.run_query(
            "MATCH (project:Project {name: $project_name}) RETURN project.name AS name LIMIT 1",
            {"project_name": project_name},
        )
        if not exists:
            raise ValueError(f"Project not found: {project_name}")

        rows = self.run_query(
            """
            MATCH path = (:Project {name: $project_name})
              -[:CONTAINS_FOLDER|CONTAINS_FILE|CONTAINS_MODULE|DEFINES|DEFINES_METHOD*1..8]->
              ()
            UNWIND relationships(path) AS rel
            WITH DISTINCT
              labels(startNode(rel)) AS source_labels,
              properties(startNode(rel)) AS source_properties,
              type(rel) AS relationship,
              labels(endNode(rel)) AS target_labels,
              properties(endNode(rel)) AS target_properties
            RETURN source_labels, source_properties, relationship, target_labels, target_properties
            """,
            {"project_name": project_name},
        )

        node_index: dict[str, StructureNode] = {}
        child_index: dict[str, set[str]] = {}

        def ensure_node(labels: list[str], properties: dict[str, Any]) -> StructureNode:
            kind = _primary_kind(labels)
            identifier = _structure_node_id(kind, properties)
            if identifier not in node_index:
                node_index[identifier] = StructureNode(
                    id=identifier,
                    name=str(properties.get("name") or properties.get("qualified_name") or identifier),
                    kind=kind,
                    path=_as_string(properties.get("path")),
                    qualified_name=_as_string(properties.get("qualified_name")),
                )
            return node_index[identifier]

        root = ensure_node(["Project"], {"name": project_name, "qualified_name": project_name})

        for row in rows:
            source = ensure_node(row["source_labels"], row["source_properties"])
            target = ensure_node(row["target_labels"], row["target_properties"])
            child_index.setdefault(source.id, set()).add(target.id)

        return _build_structure_tree(root.id, node_index, child_index)


class IndexService:
    def __init__(self, store: StateStore) -> None:
        self.store = store
        self.lock = asyncio.Lock()
        self.task: asyncio.Task[None] | None = None

    def current_state(self) -> IndexJobState:
        payload = self.store.load()
        return IndexJobState.model_validate(payload["index_job"])

    def preview_command(self, repo_path: str, clean: bool) -> str:
        parts = [str(settings.cgr_binary), "start", "--repo-path", repo_path, "--update-graph"]
        if clean:
            parts.append("--clean")
        return " ".join(parts)

    async def start_index(self, repo_path: str, clean: bool) -> IndexJobState:
        async with self.lock:
            current = self.current_state()
            if current.status == "running":
                return current

            next_state = IndexJobState(
                status="running",
                repo_path=repo_path,
                started_at=_utc_now(),
                message="Indexing started",
            )
            self.store.save(
                {
                    "active_repo_path": repo_path,
                    "index_job": next_state.model_dump(mode="json"),
                }
            )
            logger.info("Starting index for %s", repo_path)
            self.task = asyncio.create_task(self._run_index(repo_path, clean))
            return next_state

    async def _run_index(self, repo_path: str, clean: bool) -> None:
        repo_dir = Path(repo_path)
        if clean:
            hash_cache = repo_dir / ".cgr-hash-cache.json"
            if hash_cache.exists():
                hash_cache.unlink()

        command = [str(settings.cgr_binary), "start", "--repo-path", repo_path, "--update-graph"]
        if clean:
            command.append("--clean")

        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await process.communicate()
        output = _clean_log_output(stdout.decode())

        final_state = IndexJobState(
            status="completed" if process.returncode == 0 else "failed",
            repo_path=repo_path,
            started_at=self.current_state().started_at,
            finished_at=_utc_now(),
            return_code=process.returncode,
            message=output or None,
        )
        self.store.save(
            {
                "active_repo_path": repo_path if process.returncode == 0 else None,
                "index_job": final_state.model_dump(mode="json"),
            }
        )
        logger.info(
            "Index job finished for %s with status=%s return_code=%s",
            repo_path,
            final_state.status,
            process.returncode,
        )


def _primary_kind(labels: list[str]) -> str:
    priority = [
        "Project",
        "Folder",
        "File",
        "Module",
        "Class",
        "Interface",
        "TypeAlias",
        "Function",
        "Method",
    ]
    for label in priority:
        if label in labels:
            return label
    return labels[0] if labels else "Node"


def _structure_node_id(kind: str, properties: dict[str, Any]) -> str:
    qualified_name = _as_string(properties.get("qualified_name"))
    path = _as_string(properties.get("path"))
    name = _as_string(properties.get("name")) or kind.lower()
    if qualified_name:
        return f"{kind}:{qualified_name}"
    if path:
        return f"{kind}:{path}"
    return f"{kind}:{name}"


def _build_structure_tree(
    node_id: str,
    node_index: dict[str, StructureNode],
    child_index: dict[str, set[str]],
) -> StructureNode:
    base = node_index[node_id]
    children = [
        _build_structure_tree(child_id, node_index, child_index)
        for child_id in sorted(
            child_index.get(node_id, set()),
            key=lambda current_id: (
                _kind_sort_key(node_index[current_id].kind),
                node_index[current_id].path
                or node_index[current_id].qualified_name
                or node_index[current_id].name,
            ),
        )
    ]
    return StructureNode(
        id=base.id,
        name=base.name,
        kind=base.kind,
        path=base.path,
        qualified_name=base.qualified_name,
        children=children,
    )


def _kind_sort_key(kind: str) -> int:
    order = {
        "Project": -1,
        "Folder": 0,
        "File": 1,
        "Module": 2,
        "Class": 3,
        "Interface": 4,
        "TypeAlias": 5,
        "Function": 6,
        "Method": 7,
    }
    return order.get(kind, 99)
