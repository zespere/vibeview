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
    repo_path: str = ""
    recent_projects: list[str] = Field(default_factory=list)

    @property
    def is_configured(self) -> bool:
        return bool(self.repo_path.strip())


class ProjectProfileUpdateRequest(BaseModel):
    name: str = Field(default="", max_length=120)
    repo_path: str = ""


class ProjectProfileResponse(BaseModel):
    project: ProjectProfile
    is_configured: bool


class ProjectFolderPickResponse(BaseModel):
    repo_path: str | None = None


class ProjectImageUploadResponse(BaseModel):
    file_path: str
    file_name: str
    content_type: str
    size_bytes: int


class ProjectWorkspaceStatusResponse(BaseModel):
    repo_path: str
    has_project_files: bool
    visible_file_count: int
    has_canvas_nodes: bool


class ConversationMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    title: str | None = None
    content: str
    created_at: datetime | None = None


class ConversationRecord(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[ConversationMessage] = Field(default_factory=list)


class ConversationSummary(BaseModel):
    id: str
    title: str
    updated_at: datetime | None = None
    message_count: int = 0
    placeholder: bool = False


class ProjectTreeItem(BaseModel):
    name: str
    repo_path: str
    conversations: list[ConversationSummary] = Field(default_factory=list)
    canvases: list["CanvasSummary"] = Field(default_factory=list)


class ProjectTreeResponse(BaseModel):
    active_repo_path: str | None = None
    projects: list[ProjectTreeItem] = Field(default_factory=list)


class ConversationDocument(BaseModel):
    repo_path: str
    conversations: list[ConversationRecord] = Field(default_factory=list)


class ConversationListResponse(BaseModel):
    repo_path: str
    conversations: list[ConversationSummary] = Field(default_factory=list)


class ConversationResponse(BaseModel):
    repo_path: str
    conversation: ConversationRecord


class ConversationCreateRequest(BaseModel):
    repo_path: str
    title: str = Field(default="New conversation", max_length=120)


class ConversationUpdateRequest(BaseModel):
    repo_path: str
    title: str | None = Field(default=None, max_length=120)
    messages: list[ConversationMessage] | None = None


class AgentsDocumentResponse(BaseModel):
    repo_path: str
    path: str
    content: str


class AgentsDocumentUpdateRequest(BaseModel):
    repo_path: str | None = None
    content: str = ""


class CommitStatusResponse(BaseModel):
    repo_path: str
    is_git_repo: bool
    has_changes: bool
    branch_name: str | None = None
    upstream_name: str | None = None
    ahead_count: int = 0
    behind_count: int = 0
    can_push: bool = False
    suggested_message: str | None = None
    changed_files: list[str] = Field(default_factory=list)


class CommitCreateRequest(BaseModel):
    repo_path: str
    message: str | None = None


class CommitCreateResponse(BaseModel):
    repo_path: str
    commit_sha: str
    message: str
    summary: str


class PushCreateRequest(BaseModel):
    repo_path: str


class PushCreateResponse(BaseModel):
    repo_path: str
    branch_name: str | None = None
    upstream_name: str | None = None
    summary: str


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


class ProjectBuildRequest(BaseModel):
    repo_path: str
    prompt: str = Field(min_length=4)
    selected_note_ids: list[str] = Field(default_factory=list)
    semantic_context: str | None = None
    conversation_context: str | None = None


class ProjectBuildResponse(BaseModel):
    repo_path: str
    prompt: str
    summary: str
    code_summary: str
    note_summary: str
    note_changes_summary: str
    modified_files: list[str]
    notes_created: int
    document: "CanvasDocument"


class NoteChangeSummary(BaseModel):
    summary: str
    created_titles: list[str] = Field(default_factory=list)
    updated_titles: list[str] = Field(default_factory=list)
    linked_titles: list[str] = Field(default_factory=list)


class ProjectPlanRequest(BaseModel):
    repo_path: str
    prompt: str = Field(min_length=4)
    semantic_context: str | None = None
    conversation_context: str | None = None


class ProjectPlanResponse(BaseModel):
    repo_path: str
    prompt: str
    summary: str
    plan_text: str


class ProjectAskRequest(BaseModel):
    repo_path: str
    prompt: str = Field(min_length=2)
    semantic_context: str | None = None
    conversation_context: str | None = None


class ProjectAskResponse(BaseModel):
    repo_path: str
    prompt: str
    summary: str
    answer_text: str


class ExplorationContextNode(BaseModel):
    title: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    linked_files: list[str] = Field(default_factory=list)
    linked_symbols: list[str] = Field(default_factory=list)


class ExplorationSuggestionRequest(BaseModel):
    repo_path: str
    active_node: ExplorationContextNode
    path_titles: list[str] = Field(default_factory=list)
    relation_query: str | None = None
    semantic_context: str | None = None
    conversation_context: str | None = None
    suggestion_count: int = Field(default=3, ge=1, le=6)


class ExplorationSuggestionRecord(BaseModel):
    title: str
    summary: str
    edge_label: str


class ExplorationSuggestionResponse(BaseModel):
    repo_path: str
    suggestions: list[ExplorationSuggestionRecord] = Field(default_factory=list)


class ProjectRunStreamRequest(BaseModel):
    repo_path: str
    prompt: str = Field(min_length=2)
    mode: Literal["ask", "plan", "build", "auto"]
    canvas_id: str | None = None
    semantic_context: str | None = None
    conversation_context: str | None = None
    image_paths: list[str] = Field(default_factory=list)
    model: str | None = None
    reasoning_effort: Literal["low", "medium", "high", "xhigh"] | None = None


class CanvasNode(BaseModel):
    id: str
    title: str
    description: str
    tags: list[str] = Field(default_factory=list)
    x: int
    y: int
    linked_files: list[str] = Field(default_factory=list)
    linked_symbols: list[str] = Field(default_factory=list)
    linked_canvas_id: str | None = None

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
    id: str | None = None
    title: str = "Canvas"
    repo_path: str | None = None
    nodes: list[CanvasNode] = Field(default_factory=list)
    edges: list[CanvasEdge] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def migrate_architecture_summary(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        if "nodes" in value or "edges" in value:
            return value

        project = value.get("project")
        features = value.get("features")
        files = value.get("files")
        if not isinstance(project, dict) and not isinstance(features, list):
            return value

        project_name = str(project.get("name", "Project")).strip() if isinstance(project, dict) else "Project"
        project_type = str(project.get("type", "")).strip() if isinstance(project, dict) else ""
        entry = str(project.get("entry", "")).strip() if isinstance(project, dict) else ""
        linked_files = [
            str(item).strip()
            for item in (files or [])
            if isinstance(item, str) and str(item).strip() and not str(item).startswith(".vibeview/")
        ]

        nodes: list[dict[str, Any]] = [
            {
                "id": "node_project",
                "title": project_name or "Project",
                "description": " ".join(
                    part for part in [
                        f"{project_name} is the current app workspace." if project_name else "",
                        f"It is a {project_type}." if project_type else "",
                        f"The main entry file is {entry}." if entry else "",
                    ] if part
                ).strip() or "Project workspace.",
                "tags": [tag for tag in ["project", project_type or None] if tag],
                "x": 120,
                "y": 120,
                "linked_files": linked_files,
                "linked_symbols": [entry] if entry else [],
            }
        ]
        edges: list[dict[str, Any]] = []

        for index, feature in enumerate(features or []):
            if not isinstance(feature, str) or not feature.strip():
                continue
            nodes.append(
                {
                    "id": f"node_feature_{index}",
                    "title": feature.strip(),
                    "description": f"{feature.strip()} is part of the current app behavior and should be preserved or extended during implementation.",
                    "tags": ["feature"],
                    "x": 120 + (index % 3) * 320,
                    "y": 340 + (index // 3) * 220,
                    "linked_files": linked_files,
                    "linked_symbols": [],
                }
            )
            edges.append(
                {
                    "id": f"edge_project_{index}",
                    "source_node_id": "node_project",
                    "target_node_id": f"node_feature_{index}",
                    "label": "includes",
                }
            )

        return {
            "id": "canvas_overview",
            "title": "Overview",
            "repo_path": value.get("repo_path"),
            "nodes": nodes,
            "edges": edges,
        }


class CanvasCollection(BaseModel):
    repo_path: str | None = None
    canvases: list[CanvasDocument] = Field(default_factory=list)


class CanvasSummary(BaseModel):
    id: str
    title: str
    node_count: int


class CanvasNodeCreateRequest(BaseModel):
    repo_path: str
    canvas_id: str | None = None
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    x: int = 80
    y: int = 80
    linked_files: list[str] = Field(default_factory=list)
    linked_symbols: list[str] = Field(default_factory=list)
    linked_canvas_id: str | None = None


class CanvasNodeUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    tags: list[str] | None = None
    x: int | None = None
    y: int | None = None
    linked_files: list[str] | None = None
    linked_symbols: list[str] | None = None
    linked_canvas_id: str | None = None


class CanvasEdgeCreateRequest(BaseModel):
    repo_path: str
    canvas_id: str | None = None
    source_node_id: str
    target_node_id: str
    label: str = ""


class CanvasCreateRequest(BaseModel):
    repo_path: str
    title: str | None = None


class CanvasCreateFromSnapshotRequest(BaseModel):
    repo_path: str
    title: str | None = None
    nodes: list[CanvasNode] = Field(default_factory=list)
    edges: list[CanvasEdge] = Field(default_factory=list)


class CanvasCreateFromPromptRequest(BaseModel):
    repo_path: str
    title: str | None = None
    prompt: str = Field(min_length=2, max_length=500)


class CanvasUpdateRequest(BaseModel):
    repo_path: str
    title: str = Field(min_length=1, max_length=120)


class CanvasDuplicateRequest(BaseModel):
    repo_path: str
    title: str | None = Field(default=None, min_length=1, max_length=120)


class GeneratedCanvasNode(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    linked_files: list[str] = Field(default_factory=list)
    linked_symbols: list[str] = Field(default_factory=list)


class GeneratedCanvasEdge(BaseModel):
    source_title: str = Field(min_length=1, max_length=120)
    target_title: str = Field(min_length=1, max_length=120)
    label: str = ""


class CanvasGenerateRequest(BaseModel):
    repo_path: str
    canvas_id: str | None = None
    prompt: str = Field(min_length=2, max_length=500)


class CanvasGenerateResponse(BaseModel):
    document: CanvasDocument
    summary: str
    created_count: int


class CanvasResponse(BaseModel):
    document: CanvasDocument


class CanvasListResponse(BaseModel):
    repo_path: str
    canvases: list[CanvasSummary] = Field(default_factory=list)


class CanvasEditPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    tags: list[str] | None = None
    linked_files: list[str] | None = None
    linked_symbols: list[str] | None = None
    linked_canvas_id: str | None = None


class CanvasEditChangeRecord(BaseModel):
    id: str
    kind: Literal["update_node", "create_node", "delete_node", "create_edge"]
    scope: Literal["direct", "impacted"]
    reason: str
    impact_basis: list[str] = Field(default_factory=list)
    depends_on_change_ids: list[str] = Field(default_factory=list)
    target_node_id: str | None = None
    target_title: str | None = None
    anchor_node_id: str | None = None
    before_node: CanvasNode | None = None
    after_node: CanvasNode | None = None
    before_edge: CanvasEdge | None = None
    after_edge: CanvasEdge | None = None


class CanvasEditPreviewRequest(BaseModel):
    repo_path: str
    canvas_id: str | None = None
    prompt: str = Field(min_length=3, max_length=1200)
    target_note_ids: list[str] = Field(default_factory=list)
    semantic_context: str | None = None
    conversation_context: str | None = None


class CanvasEditPreviewResponse(BaseModel):
    repo_path: str
    prompt: str
    summary: str
    direct_count: int
    impacted_count: int
    changes: list[CanvasEditChangeRecord] = Field(default_factory=list)


class CanvasEditApplyRequest(BaseModel):
    repo_path: str
    canvas_id: str | None = None
    accepted_change_ids: list[str] = Field(default_factory=list)
    changes: list[CanvasEditChangeRecord] = Field(default_factory=list)


class CanvasEditApplyResponse(BaseModel):
    repo_path: str
    summary: str
    note_changes_summary: str
    applied_change_ids: list[str] = Field(default_factory=list)
    remaining_change_ids: list[str] = Field(default_factory=list)
    document: CanvasDocument


StructureNode.model_rebuild()
