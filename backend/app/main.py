from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .canvas_service import CanvasService, CanvasStore
from .codex_service import CodexService
from .logging_utils import configure_logging
from .models import (
    AgentsDocumentResponse,
    AgentsDocumentUpdateRequest,
    AssistImpactRequest,
    AssistImpactResponse,
    CanvasEdgeCreateRequest,
    CanvasGenerateRequest,
    CanvasGenerateResponse,
    CanvasResponse,
    CanvasNodeCreateRequest,
    CanvasNodeUpdateRequest,
    CodexChangeRequest,
    CodexChangeResponse,
    IndexRequest,
    ProjectBuildRequest,
    ProjectBuildResponse,
    ProjectProfileResponse,
    ProjectProfileUpdateRequest,
    QueryRequest,
    QueryResponse,
    RelationshipsResponse,
    StatusResponse,
    StructureResponse,
    SymbolsResponse,
)
from .project_service import ProjectService, ProjectStore
from .services import GraphService, IndexService, SEARCHABLE_SYMBOL_LABELS, StateStore

configure_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title="Konceptura Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

state_store = StateStore(settings.state_path)
canvas_store = CanvasStore(settings.canvas_path)
project_store = ProjectStore(settings.project_path)
graph_service = GraphService()
index_service = IndexService(state_store)
canvas_service = CanvasService(canvas_store)
project_service = ProjectService(project_store)
codex_service = CodexService(graph_service)


@app.get("/")
def root() -> dict[str, object]:
    return {
        "name": "konceptura-backend",
        "version": "0.1.0",
        "endpoints": [
            "/index",
            "/status",
            "/symbols",
            "/relationships",
            "/structure",
            "/query",
            "/assist/impact",
            "/codex/change",
            "/project/build",
            "/canvas",
            "/project",
        ],
    }


@app.post("/index", response_model=StatusResponse)
async def index_repo(request: IndexRequest) -> StatusResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not settings.cgr_binary.exists():
        raise HTTPException(status_code=500, detail=f"Code-Graph-RAG binary not found: {settings.cgr_binary}")

    resolved_path = str(repo_path.resolve())
    if request.dry_run:
        preview = index_service.preview_command(resolved_path, request.clean)
        logger.info("Dry-run index request for %s", resolved_path)
        return build_status(preview=preview)

    await index_service.start_index(resolved_path, request.clean)
    canvas_service.set_repo_path(resolved_path)
    return build_status()


@app.get("/status", response_model=StatusResponse)
def get_status() -> StatusResponse:
    return build_status()


@app.get("/project", response_model=ProjectProfileResponse)
def get_project() -> ProjectProfileResponse:
    project = project_service.get_project()
    return ProjectProfileResponse(project=project, is_configured=project.is_configured)


@app.put("/project", response_model=ProjectProfileResponse)
def update_project(request: ProjectProfileUpdateRequest) -> ProjectProfileResponse:
    project = project_service.update_project(request)
    if project.repo_path:
        canvas_service.set_repo_path(project.repo_path)
    return ProjectProfileResponse(project=project, is_configured=project.is_configured)


@app.get("/project/agents", response_model=AgentsDocumentResponse)
def get_project_agents(repo_path: str | None = None) -> AgentsDocumentResponse:
    try:
        resolved_repo_path, path, content = project_service.read_agents_document(repo_path)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return AgentsDocumentResponse(repo_path=resolved_repo_path, path=str(path), content=content)


@app.put("/project/agents", response_model=AgentsDocumentResponse)
def update_project_agents(request: AgentsDocumentUpdateRequest) -> AgentsDocumentResponse:
    try:
        resolved_repo_path, path, content = project_service.write_agents_document(
            request.content,
            request.repo_path,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return AgentsDocumentResponse(repo_path=resolved_repo_path, path=str(path), content=content)


@app.get("/symbols", response_model=SymbolsResponse)
def get_symbols(
    q: str | None = Query(default=None),
    kind: list[str] | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=200),
) -> SymbolsResponse:
    labels = kind or SEARCHABLE_SYMBOL_LABELS
    invalid = [label for label in labels if label not in SEARCHABLE_SYMBOL_LABELS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unsupported symbol kinds: {', '.join(invalid)}")

    items = graph_service.list_symbols(q, labels, limit) if not q else [
        seed.symbol for seed in graph_service.search_symbols_ranked(q, labels, limit)
    ]
    return SymbolsResponse(total=len(items), items=items)


@app.get("/relationships", response_model=RelationshipsResponse)
def get_relationships(
    qualified_name: str,
    relationship: str = Query(default="CALLS"),
    direction: str = Query(default="outgoing", pattern="^(incoming|outgoing|both)$"),
    limit: int = Query(default=25, ge=1, le=200),
) -> RelationshipsResponse:
    items = graph_service.get_relationships(qualified_name, relationship, direction, limit)
    return RelationshipsResponse(qualified_name=qualified_name, total=len(items), items=items)


@app.get("/structure", response_model=StructureResponse)
def get_structure(project_name: str | None = None) -> StructureResponse:
    payload = state_store.load()
    active_repo_path = payload.get("active_repo_path")

    if project_name is None:
        active_path = active_repo_path or str(settings.default_repo_path)
        project_name = Path(active_path).name

    try:
        root = graph_service.get_structure(project_name)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    return StructureResponse(project_name=project_name, root=root)


@app.post("/query", response_model=QueryResponse)
def query_graph(request: QueryRequest) -> QueryResponse:
    if request.cypher:
        rows = graph_service.run_query(request.cypher)
        return QueryResponse(mode="cypher", results=rows[: request.limit])

    symbols = graph_service.search_symbols_ranked(request.text or "", SEARCHABLE_SYMBOL_LABELS, request.limit)
    return QueryResponse(
        mode="search",
        results=[item.symbol.model_dump() for item in symbols],
    )


@app.post("/assist/impact", response_model=AssistImpactResponse)
def assist_impact(request: AssistImpactRequest) -> AssistImpactResponse:
    logger.info("Impact analysis requested for prompt=%s", request.prompt)
    return graph_service.analyze_impact(request.prompt, request.limit)


@app.post("/codex/change", response_model=CodexChangeResponse)
def codex_change(request: CodexChangeRequest) -> CodexChangeResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {repo_path}")

    try:
        response = codex_service.run_change(
            repo_path=str(repo_path.resolve()),
            prompt=request.prompt,
            dry_run=request.dry_run,
            use_graph_context=request.use_graph_context,
            bypass_sandbox=request.bypass_sandbox,
            semantic_context=request.semantic_context,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    return response


@app.post("/project/build", response_model=ProjectBuildResponse)
def build_project(request: ProjectBuildRequest) -> ProjectBuildResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {repo_path}")

    resolved_repo_path = str(repo_path.resolve())
    canvas_service.set_repo_path(resolved_repo_path)

    try:
        change_response = codex_service.build_project(
            repo_path=resolved_repo_path,
            prompt=request.prompt,
            semantic_context=request.semantic_context,
        )
        generated_nodes, generated_edges, note_summary = codex_service.generate_architecture_notes(
            repo_path=resolved_repo_path,
            prompt=request.prompt,
        )
        document, notes_created = canvas_service.append_generated_map(generated_nodes, generated_edges)
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    modified_files = [item.path for item in change_response.changed_files]
    file_count = len(modified_files)
    if file_count > 0:
        summary_parts = [
            f"Updated {file_count} file{'s' if file_count != 1 else ''} in {resolved_repo_path}."
        ]
    else:
        summary_parts = [f"No project files were modified in {resolved_repo_path}."]
    if notes_created > 0:
        summary_parts.append(f"Added {notes_created} architecture note{'s' if notes_created != 1 else ''}.")
    else:
        summary_parts.append("Architecture notes refreshed with no new nodes added.")

    return ProjectBuildResponse(
        repo_path=resolved_repo_path,
        prompt=request.prompt,
        summary=" ".join(summary_parts),
        code_summary=change_response.summary,
        note_summary=note_summary,
        modified_files=modified_files,
        notes_created=notes_created,
        document=document,
    )


@app.get("/canvas", response_model=CanvasResponse)
def get_canvas(repo_path: str | None = None) -> CanvasResponse:
    if repo_path:
        resolved_path = Path(repo_path)
        if not resolved_path.exists():
            raise HTTPException(status_code=404, detail=f"Repository path does not exist: {resolved_path}")
        if not resolved_path.is_dir():
            raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {resolved_path}")
        return CanvasResponse(document=canvas_service.get_document_for_repo(str(resolved_path.resolve())))
    return CanvasResponse(document=canvas_service.get_document())


@app.post("/canvas/nodes", response_model=CanvasResponse)
def create_canvas_node(request: CanvasNodeCreateRequest) -> CanvasResponse:
    return CanvasResponse(document=canvas_service.create_node(request))


@app.patch("/canvas/nodes/{node_id}", response_model=CanvasResponse)
def update_canvas_node(node_id: str, request: CanvasNodeUpdateRequest) -> CanvasResponse:
    try:
        document = canvas_service.update_node(node_id, request)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return CanvasResponse(document=document)


@app.delete("/canvas/nodes/{node_id}", response_model=CanvasResponse)
def delete_canvas_node(node_id: str) -> CanvasResponse:
    try:
        document = canvas_service.delete_node(node_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return CanvasResponse(document=document)


@app.post("/canvas/edges", response_model=CanvasResponse)
def create_canvas_edge(request: CanvasEdgeCreateRequest) -> CanvasResponse:
    try:
        document = canvas_service.create_edge(request)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return CanvasResponse(document=document)


@app.delete("/canvas/edges/{edge_id}", response_model=CanvasResponse)
def delete_canvas_edge(edge_id: str) -> CanvasResponse:
    try:
        document = canvas_service.delete_edge(edge_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return CanvasResponse(document=document)


@app.post("/canvas/generate", response_model=CanvasGenerateResponse)
def generate_canvas_from_prompt(request: CanvasGenerateRequest) -> CanvasGenerateResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {repo_path}")

    try:
        canvas_service.set_repo_path(str(repo_path.resolve()))
        nodes, edges, summary = codex_service.generate_architecture_notes(
            repo_path=str(repo_path.resolve()),
            prompt=request.prompt,
        )
        document, created_count = canvas_service.append_generated_map(nodes, edges)
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    return CanvasGenerateResponse(
        document=document,
        summary=summary,
        created_count=created_count,
    )


def build_status(preview: str | None = None) -> StatusResponse:
    payload = state_store.load()
    return StatusResponse(
        memgraph_ok=graph_service.healthcheck(),
        cgr_ok=settings.cgr_binary.exists(),
        codex_ok=codex_service.is_available(),
        active_repo_path=payload.get("active_repo_path"),
        config_path=str(settings.config_path),
        log_path=str(settings.log_path),
        default_repo_path=str(settings.default_repo_path),
        sample_repos={name: str(path) for name, path in settings.sample_repos.items()},
        index_job=index_service.current_state(),
        preview=preview,
        codex_binary=str(settings.codex_binary) if settings.codex_binary else None,
        codex_model=settings.codex_model,
    )
