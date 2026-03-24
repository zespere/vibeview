from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class IndexRequest(BaseModel):
    repo_path: str
    clean: bool = True
    dry_run: bool = False


class IndexJobState(BaseModel):
    status: Literal["idle", "running", "completed", "failed"] = "idle"
    repo_path: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    return_code: int | None = None
    message: str | None = None


class StatusResponse(BaseModel):
    memgraph_ok: bool
    cgr_ok: bool
    codex_ok: bool
    active_repo_path: str | None
    config_path: str
    log_path: str
    default_repo_path: str
    sample_repos: dict[str, str]
    index_job: IndexJobState
    preview: str | None = None
    codex_binary: str | None = None
    codex_model: str | None = None


class ProjectProfile(BaseModel):
    name: str = ""
    description: str = ""
    repo_path: str = ""
    stack: str = ""
    goals: str = ""
    constraints: str = ""
    design_direction: str = ""

    @property
    def is_configured(self) -> bool:
        return bool(self.repo_path.strip())


class ProjectProfileUpdateRequest(BaseModel):
    name: str = Field(default="", max_length=120)
    description: str = ""
    repo_path: str = ""
    stack: str = ""
    goals: str = ""
    constraints: str = ""
    design_direction: str = ""


class ProjectProfileResponse(BaseModel):
    project: ProjectProfile
    is_configured: bool


class SymbolRecord(BaseModel):
    labels: list[str]
    properties: dict[str, Any]


class SymbolsResponse(BaseModel):
    total: int
    items: list[SymbolRecord]


class RelationshipRecord(BaseModel):
    relationship: str
    direction: Literal["incoming", "outgoing"]
    other_node: SymbolRecord


class RelationshipsResponse(BaseModel):
    qualified_name: str
    total: int
    items: list[RelationshipRecord]


class StructureNode(BaseModel):
    id: str
    name: str
    kind: str
    path: str | None = None
    qualified_name: str | None = None
    children: list["StructureNode"] = Field(default_factory=list)


class StructureResponse(BaseModel):
    project_name: str
    root: StructureNode


class QueryRequest(BaseModel):
    text: str | None = None
    cypher: str | None = None
    limit: int = Field(default=20, ge=1, le=200)

    @model_validator(mode="after")
    def validate_input(self) -> "QueryRequest":
        if not self.text and not self.cypher:
            raise ValueError("Provide either 'text' or 'cypher'.")
        return self


class QueryResponse(BaseModel):
    mode: Literal["search", "cypher"]
    results: list[dict[str, Any]]


class AssistImpactRequest(BaseModel):
    prompt: str = Field(min_length=2)
    limit: int = Field(default=6, ge=1, le=20)


class ImpactSeed(BaseModel):
    score: float
    reason: str
    file_path: str | None = None
    symbol: SymbolRecord


class ImpactRelationshipRecord(BaseModel):
    source_qualified_name: str
    relationship: str
    direction: Literal["incoming", "outgoing"]
    reason: str
    file_path: str | None = None
    other_node: SymbolRecord


class ImpactFileRecord(BaseModel):
    path: str
    reasons: list[str]


class AssistImpactResponse(BaseModel):
    mode: Literal["heuristic"] = "heuristic"
    prompt: str
    summary: str
    seeds: list[ImpactSeed]
    related_symbols: list[ImpactRelationshipRecord]
    affected_files: list[ImpactFileRecord]


class CodexChangeRequest(BaseModel):
    repo_path: str
    prompt: str = Field(min_length=4)
    dry_run: bool = False
    use_graph_context: bool = True
    bypass_sandbox: bool | None = None
    semantic_context: str | None = None


class CodexCommandRecord(BaseModel):
    command: str
    status: str
    exit_code: int | None = None
    output: str | None = None


class ChangedFileRecord(BaseModel):
    path: str
    change_type: Literal["added", "modified", "deleted"]
    diff: str


class CodexChangeResponse(BaseModel):
    repo_path: str
    prompt: str
    summary: str
    dry_run: bool
    used_graph_context: bool
    bypass_sandbox: bool
    codex_binary: str
    codex_model: str | None = None
    graph_context_summary: str | None = None
    changed_files: list[ChangedFileRecord]
    commands: list[CodexCommandRecord]
    raw_event_count: int


class CanvasNode(BaseModel):
    id: str
    title: str
    description: str
    tags: list[str] = Field(default_factory=list)
    x: int
    y: int
    linked_files: list[str] = Field(default_factory=list)
    linked_symbols: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def migrate_kind_to_tags(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value

        payload = dict(value)
        tags = payload.get("tags")
        if isinstance(tags, list):
            payload["tags"] = [str(item).strip() for item in tags if str(item).strip()]
            return payload

        kind = payload.pop("kind", None)
        if isinstance(kind, str) and kind.strip():
            payload["tags"] = [kind.strip()]
        elif tags is None:
            payload["tags"] = []
        return payload


class CanvasEdge(BaseModel):
    id: str
    source_node_id: str
    target_node_id: str
    label: str = ""


class CanvasDocument(BaseModel):
    repo_path: str | None = None
    nodes: list[CanvasNode] = Field(default_factory=list)
    edges: list[CanvasEdge] = Field(default_factory=list)


class CanvasNodeCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    x: int = 80
    y: int = 80
    linked_files: list[str] = Field(default_factory=list)
    linked_symbols: list[str] = Field(default_factory=list)


class CanvasNodeUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    tags: list[str] | None = None
    x: int | None = None
    y: int | None = None
    linked_files: list[str] | None = None
    linked_symbols: list[str] | None = None


class CanvasEdgeCreateRequest(BaseModel):
    source_node_id: str
    target_node_id: str
    label: str = ""


class CanvasResponse(BaseModel):
    document: CanvasDocument


StructureNode.model_rebuild()
