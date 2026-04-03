from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

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
    CommitCreateRequest,
    CommitCreateResponse,
    CommitStatusResponse,
    ConversationCreateRequest,
    ConversationListResponse,
    ConversationResponse,
    ConversationUpdateRequest,
    ExplorationSuggestionRequest,
    ExplorationSuggestionResponse,
    IndexRequest,
    ProjectBuildRequest,
    ProjectBuildResponse,
    ProjectAskRequest,
    ProjectAskResponse,
    ProjectRunStreamRequest,
    ProjectPlanRequest,
    ProjectPlanResponse,
    ProjectProfileResponse,
    ProjectTreeResponse,
    ProjectProfileUpdateRequest,
    ProjectWorkspaceStatusResponse,
    PushCreateRequest,
    PushCreateResponse,
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
            "/projects/tree",
            "/project/commit-status",
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


@app.get("/project/workspace-status", response_model=ProjectWorkspaceStatusResponse)
def get_project_workspace_status(repo_path: str) -> ProjectWorkspaceStatusResponse:
    resolved_repo_path = str(Path(repo_path).resolve())
    has_canvas_nodes = len(canvas_service.get_document_for_repo(resolved_repo_path).nodes) > 0
    return project_service.get_workspace_status(resolved_repo_path, has_canvas_nodes)


@app.get("/projects/tree", response_model=ProjectTreeResponse)
def get_projects_tree() -> ProjectTreeResponse:
    active_repo_path, projects = project_service.list_project_items()
    return ProjectTreeResponse(active_repo_path=active_repo_path, projects=projects)


@app.put("/project", response_model=ProjectProfileResponse)
def update_project(request: ProjectProfileUpdateRequest) -> ProjectProfileResponse:
    project = project_service.update_project(request)
    if project.repo_path:
        canvas_service.set_repo_path(project.repo_path)
    return ProjectProfileResponse(project=project, is_configured=project.is_configured)


@app.get("/project/conversations", response_model=ConversationListResponse)
def list_project_conversations(repo_path: str) -> ConversationListResponse:
    try:
        resolved_repo_path = str(Path(repo_path).resolve())
        conversations = project_service.list_conversations(resolved_repo_path)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return ConversationListResponse(repo_path=resolved_repo_path, conversations=conversations)


@app.get("/project/conversations/{conversation_id}", response_model=ConversationResponse)
def get_project_conversation(conversation_id: str, repo_path: str) -> ConversationResponse:
    try:
        resolved_repo_path = str(Path(repo_path).resolve())
        conversation = project_service.get_conversation(resolved_repo_path, conversation_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return ConversationResponse(repo_path=resolved_repo_path, conversation=conversation)


@app.post("/project/conversations", response_model=ConversationResponse)
def create_project_conversation(request: ConversationCreateRequest) -> ConversationResponse:
    try:
        conversation = project_service.create_conversation(request)
        resolved_repo_path = str(Path(request.repo_path).resolve())
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return ConversationResponse(repo_path=resolved_repo_path, conversation=conversation)


@app.patch("/project/conversations/{conversation_id}", response_model=ConversationResponse)
def update_project_conversation(conversation_id: str, request: ConversationUpdateRequest) -> ConversationResponse:
    try:
        conversation = project_service.update_conversation(conversation_id, request)
        resolved_repo_path = str(Path(request.repo_path).resolve())
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return ConversationResponse(repo_path=resolved_repo_path, conversation=conversation)


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


@app.get("/project/commit-status", response_model=CommitStatusResponse)
def get_project_commit_status(repo_path: str) -> CommitStatusResponse:
    resolved_repo_path = str(Path(repo_path).resolve())
    status = project_service.get_commit_status(resolved_repo_path)
    if status.is_git_repo and status.has_changes:
        diff_result = project_service._run_git(Path(resolved_repo_path), ["diff", "--stat"])
        suggested_message = codex_service.suggest_commit_message(
            resolved_repo_path,
            "\n".join(status.changed_files),
            diff_result.stdout,
        )
        return status.model_copy(update={"suggested_message": suggested_message})
    return status


@app.post("/project/commit", response_model=CommitCreateResponse)
def create_project_commit(request: CommitCreateRequest) -> CommitCreateResponse:
    resolved_repo_path = str(Path(request.repo_path).resolve())
    status = project_service.get_commit_status(resolved_repo_path)
    if not status.is_git_repo:
        raise HTTPException(status_code=400, detail="Repository is not a git repository.")
    if not status.has_changes:
        raise HTTPException(status_code=400, detail="There is nothing to commit.")

    try:
        diff_result = project_service._run_git(Path(resolved_repo_path), ["diff", "--stat"])
        message = (
            request.message.strip()
            if request.message and request.message.strip()
            else codex_service.suggest_commit_message(
                resolved_repo_path,
                "\n".join(status.changed_files),
                diff_result.stdout,
            )
        )
        return project_service.create_commit(resolved_repo_path, message)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/project/push", response_model=PushCreateResponse)
def push_project_commits(request: PushCreateRequest) -> PushCreateResponse:
    resolved_repo_path = str(Path(request.repo_path).resolve())
    status = project_service.get_commit_status(resolved_repo_path)
    if not status.is_git_repo:
        raise HTTPException(status_code=400, detail="Repository is not a git repository.")
    if not status.can_push:
        if not status.upstream_name:
            raise HTTPException(status_code=400, detail="Current branch has no upstream configured.")
        raise HTTPException(status_code=400, detail="There is nothing to push.")

    try:
        return project_service.push_commits(resolved_repo_path)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


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
            conversation_context=request.conversation_context,
        )
        generated_nodes, generated_edges, note_summary = codex_service.generate_architecture_notes(
            repo_path=resolved_repo_path,
            prompt=request.prompt,
        )
        document, notes_created, note_changes = canvas_service.append_generated_map(generated_nodes, generated_edges)
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
        note_changes_summary=note_changes.summary,
        modified_files=modified_files,
        notes_created=notes_created,
        document=document,
    )


@app.post("/project/plan", response_model=ProjectPlanResponse)
def plan_project(request: ProjectPlanRequest) -> ProjectPlanResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {repo_path}")

    resolved_repo_path = str(repo_path.resolve())
    canvas_service.set_repo_path(resolved_repo_path)

    try:
        summary, plan_text = codex_service.plan_project(
            repo_path=resolved_repo_path,
            prompt=request.prompt,
            semantic_context=request.semantic_context,
            conversation_context=request.conversation_context,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    return ProjectPlanResponse(
        repo_path=resolved_repo_path,
        prompt=request.prompt,
        summary=summary,
        plan_text=plan_text,
    )


@app.post("/project/ask", response_model=ProjectAskResponse)
def ask_project(request: ProjectAskRequest) -> ProjectAskResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {repo_path}")

    resolved_repo_path = str(repo_path.resolve())
    try:
        summary, answer_text = codex_service.ask_project(
            resolved_repo_path,
            request.prompt,
            request.semantic_context,
            conversation_context=request.conversation_context,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    return ProjectAskResponse(
        repo_path=resolved_repo_path,
        prompt=request.prompt,
        summary=summary,
        answer_text=answer_text,
    )


@app.post("/project/exploration-suggestions", response_model=ExplorationSuggestionResponse)
def project_exploration_suggestions(request: ExplorationSuggestionRequest) -> ExplorationSuggestionResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {repo_path}")

    resolved_repo_path = str(repo_path.resolve())
    try:
        suggestions = codex_service.generate_exploration_suggestions(
            resolved_repo_path,
            active_node=request.active_node,
            path_titles=request.path_titles,
            suggestion_count=request.suggestion_count,
            relation_query=request.relation_query,
            semantic_context=request.semantic_context,
            conversation_context=request.conversation_context,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    return ExplorationSuggestionResponse(
        repo_path=resolved_repo_path,
        suggestions=suggestions,
    )


@app.post("/project/run-stream")
def run_project_stream(request: ProjectRunStreamRequest) -> StreamingResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {repo_path}")

    resolved_repo_path = str(repo_path.resolve())
    canvas_service.set_repo_path(resolved_repo_path)

    def emit(event: dict[str, object]) -> bytes:
        return (json.dumps(event) + "\n").encode("utf-8")

    def stream_text_chunks(text: str) -> list[bytes]:
        chunk_size = 120
        chunks: list[bytes] = []
        for start in range(0, len(text), chunk_size):
            chunks.append(
                emit(
                    {
                        "type": "assistant.chunk",
                        "text": text[start : start + chunk_size],
                    }
                )
            )
        return chunks

    def generate():
        yield emit({"type": "phase", "phase": "starting", "label": "Preparing request..."})
        try:
            resolved_mode = request.mode
            if request.mode == "auto":
                yield emit({"type": "phase", "phase": "understanding", "label": "Understanding request..."})
                resolved_mode = codex_service.infer_project_run_mode(
                    resolved_repo_path,
                    request.prompt,
                    request.semantic_context,
                    conversation_context=request.conversation_context,
                    model=request.model,
                    reasoning_effort=request.reasoning_effort,
                )

            if resolved_mode == "ask":
                yield emit({"type": "phase", "phase": "answering", "label": "Answering question..."})
                summary, answer_text = codex_service.ask_project(
                    resolved_repo_path,
                    request.prompt,
                    request.semantic_context,
                    conversation_context=request.conversation_context,
                    model=request.model,
                    reasoning_effort=request.reasoning_effort,
                )
                for chunk in stream_text_chunks(answer_text):
                    yield chunk
                yield emit(
                    {
                        "type": "completed",
                        "mode": "ask",
                        "summary": summary,
                        "answer_text": answer_text,
                    }
                )
                return

            if resolved_mode == "plan":
                yield emit({"type": "phase", "phase": "planning", "label": "Preparing implementation plan..."})
                summary, plan_text = codex_service.plan_project(
                    repo_path=resolved_repo_path,
                    prompt=request.prompt,
                    semantic_context=request.semantic_context,
                    conversation_context=request.conversation_context,
                    model=request.model,
                    reasoning_effort=request.reasoning_effort,
                )
                for chunk in stream_text_chunks(plan_text):
                    yield chunk
                yield emit(
                    {
                        "type": "completed",
                        "mode": "plan",
                        "summary": summary,
                        "plan_text": plan_text,
                    }
                )
                return

            yield emit({"type": "phase", "phase": "building", "label": "Editing code..."})
            change_response = codex_service.build_project(
                repo_path=resolved_repo_path,
                prompt=request.prompt,
                semantic_context=request.semantic_context,
                conversation_context=request.conversation_context,
                model=request.model,
                reasoning_effort=request.reasoning_effort,
            )
            yield emit({"type": "phase", "phase": "updating_notes", "label": "Updating notes..."})
            generated_nodes, generated_edges, note_summary = codex_service.generate_architecture_notes(
                repo_path=resolved_repo_path,
                prompt=request.prompt,
            )
            document, notes_created, note_changes = canvas_service.append_generated_map(generated_nodes, generated_edges)

            modified_files = [item.path for item in change_response.changed_files]
            file_count = len(modified_files)
            summary_parts = (
                [f"Updated {file_count} file{'s' if file_count != 1 else ''} in {resolved_repo_path}."]
                if file_count > 0
                else [f"No project files were modified in {resolved_repo_path}."]
            )
            if notes_created > 0:
                summary_parts.append(f"Added {notes_created} architecture note{'s' if notes_created != 1 else ''}.")
            else:
                summary_parts.append("Architecture notes refreshed with no new nodes added.")
            summary = " ".join(summary_parts)
            assistant_text = "\n\n".join(
                item
                for item in [
                    change_response.summary,
                    note_summary,
                    f"Notes changes summary:\n{note_changes.summary}",
                ]
                if item
            )
            for chunk in stream_text_chunks(assistant_text):
                yield chunk
            yield emit(
                {
                    "type": "completed",
                    "mode": "build",
                    "summary": summary,
                    "code_summary": change_response.summary,
                    "note_summary": note_summary,
                    "note_changes_summary": note_changes.summary,
                    "modified_files": modified_files,
                    "notes_created": notes_created,
                    "document": document.model_dump(mode="json"),
                }
            )
        except RuntimeError as error:
            yield emit({"type": "error", "message": str(error)})

    return StreamingResponse(generate(), media_type="application/x-ndjson")


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


@app.delete("/canvas", response_model=CanvasResponse)
def reset_canvas(repo_path: str) -> CanvasResponse:
    resolved_path = Path(repo_path)
    if not resolved_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {resolved_path}")
    if not resolved_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {resolved_path}")
    return CanvasResponse(document=canvas_service.reset_repo_canvas(str(resolved_path.resolve())))


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
        document, created_count, note_changes = canvas_service.append_generated_map(nodes, edges)
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    return CanvasGenerateResponse(
        document=document,
        summary=f"{summary} {note_changes.summary}".strip(),
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
