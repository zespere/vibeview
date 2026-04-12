from __future__ import annotations

import json
import logging
import mimetypes
import queue
import threading
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .agent_service import AgentService
from .agent_auth_service import AgentAuthService
from .config import settings
from .canvas_service import CanvasService, CanvasStore
from .logging_utils import configure_logging
from .models import (
    AgentChangeRequest,
    AgentChangeResponse,
    AgentAuthStatusResponse,
    AgentAuthUpdateRequest,
    AgentsDocumentResponse,
    AgentsDocumentUpdateRequest,
    AssistImpactRequest,
    AssistImpactResponse,
    CanvasEdgeCreateRequest,
    CanvasCreateRequest,
    CanvasCreateFromPromptRequest,
    CanvasCreateFromSnapshotRequest,
    CanvasDuplicateRequest,
    CanvasEditApplyRequest,
    CanvasEditApplyResponse,
    CanvasEditPreviewRequest,
    CanvasEditPreviewResponse,
    CanvasGenerateRequest,
    CanvasGenerateResponse,
    CanvasListResponse,
    CanvasSummary,
    CanvasResponse,
    CanvasNodeCreateRequest,
    CanvasNodeUpdateRequest,
    CanvasUpdateRequest,
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
    ProjectAskRequest,
    ProjectAskResponse,
    ProjectFolderPickResponse,
    ProjectImageUploadResponse,
    ProjectRunStreamRequest,
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
from .pi_client import PiClient
from .project_service import ProjectService, ProjectStore
from .services import GraphService, IndexService, SEARCHABLE_SYMBOL_LABELS, StateStore

configure_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title="Vibeview Backend", version="0.1.0")
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
agent_auth_service = AgentAuthService()
agent_service = AgentService(
    graph_service,
    PiClient(),
    provider_resolver=lambda: project_service.get_project().agent_provider or settings.agent_provider,
)


@app.get("/")
def root() -> dict[str, object]:
    return {
        "name": "vibeview-backend",
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
            "/agent/change",
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


@app.get("/agent/auth", response_model=AgentAuthStatusResponse)
def get_agent_auth_status() -> AgentAuthStatusResponse:
    project = project_service.get_project()
    return agent_auth_service.get_status(project.agent_provider or settings.agent_provider)


@app.put("/agent/auth", response_model=AgentAuthStatusResponse)
def update_agent_auth(request: AgentAuthUpdateRequest) -> AgentAuthStatusResponse:
    if request.api_key and request.api_key.strip():
        agent_auth_service.save_api_key(request.provider, request.api_key)
    if request.set_active:
        project_service.set_agent_provider(request.provider)
    project = project_service.get_project()
    return agent_auth_service.get_status(project.agent_provider or settings.agent_provider)


@app.get("/project", response_model=ProjectProfileResponse)
def get_project() -> ProjectProfileResponse:
    project = project_service.get_project()
    return ProjectProfileResponse(project=project, is_configured=project.is_configured)


@app.post("/project/pick-folder", response_model=ProjectFolderPickResponse)
def pick_project_folder() -> ProjectFolderPickResponse:
    try:
        repo_path = project_service.pick_project_folder()
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return ProjectFolderPickResponse(repo_path=repo_path)


@app.post("/project/attachments/image", response_model=ProjectImageUploadResponse)
async def upload_project_image(file: UploadFile = File(...)) -> ProjectImageUploadResponse:
    content_type = (file.content_type or "").strip().lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are supported.")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")
    if len(image_bytes) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Uploaded image is too large.")

    suffix = Path(file.filename or "").suffix.lower()
    if not suffix:
        suffix = mimetypes.guess_extension(content_type) or ".png"

    upload_dir = settings.state_path.parent / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    target_path = upload_dir / f"{uuid4().hex}{suffix}"
    target_path.write_bytes(image_bytes)

    return ProjectImageUploadResponse(
        file_path=str(target_path),
        file_name=file.filename or target_path.name,
        content_type=content_type,
        size_bytes=len(image_bytes),
    )


@app.get("/project/workspace-status", response_model=ProjectWorkspaceStatusResponse)
def get_project_workspace_status(repo_path: str) -> ProjectWorkspaceStatusResponse:
    resolved_repo_path = str(Path(repo_path).resolve())
    has_canvas_nodes = len(canvas_service.get_document_for_repo(resolved_repo_path).nodes) > 0
    return project_service.get_workspace_status(resolved_repo_path, has_canvas_nodes)


@app.get("/projects/tree", response_model=ProjectTreeResponse)
def get_projects_tree() -> ProjectTreeResponse:
    active_repo_path, projects = project_service.list_project_items()
    for item in projects:
        item.canvases = canvas_service.list_canvases_for_repo(item.repo_path)
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
        suggested_message = agent_service.suggest_commit_message(
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
            else agent_service.suggest_commit_message(
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


@app.post("/agent/change", response_model=AgentChangeResponse)
def agent_change(request: AgentChangeRequest) -> AgentChangeResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {repo_path}")

    try:
        response = agent_service.run_change(
            repo_path=str(repo_path.resolve()),
            prompt=request.prompt,
            dry_run=request.dry_run,
            use_graph_context=request.use_graph_context,
            semantic_context=request.semantic_context,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    return response


@app.post("/project/ask", response_model=ProjectAskResponse)
def ask_project(request: ProjectAskRequest) -> ProjectAskResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {repo_path}")

    resolved_repo_path = str(repo_path.resolve())
    try:
        summary, answer_text = agent_service.ask_project(
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
        suggestions = agent_service.generate_exploration_suggestions(
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
    active_canvas = canvas_service.get_document_for_repo(resolved_repo_path, request.canvas_id) if request.canvas_id else None
    collection_path = canvas_store.collection_path_for_repo(resolved_repo_path)
    pointer_path = canvas_store.pointer_path_for_repo(resolved_repo_path)
    backup_path = collection_path.with_suffix(f"{collection_path.suffix}.vibeview.bak")

    def emit(event: dict[str, object]) -> bytes:
        return (json.dumps(event) + "\n").encode("utf-8")

    def format_tool_label(tool_name: str, args: object) -> str:
        if tool_name == "bash" and isinstance(args, dict):
            command = str(args.get("command") or "").strip()
            if command:
                return command
        if tool_name in {"read", "write", "edit", "grep", "find", "ls"} and isinstance(args, dict):
            for key in ("path", "filePath", "pattern", "query"):
                value = str(args.get(key) or "").strip()
                if value:
                    return f"{tool_name} {value}"[:120]
        return tool_name or "tool"

    def extract_tool_summary(result: object) -> str | None:
        if not isinstance(result, dict):
            return None
        content = result.get("content")
        if not isinstance(content, list):
            return None
        parts: list[str] = []
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "text":
                continue
            text = str(block.get("text") or "").strip()
            if text:
                parts.append(text)
        if not parts:
            return None
        cleaned = " ".join(part.replace("\n", " ").strip() for part in parts).strip()
        return cleaned[:160] if cleaned else None

    def translate_pi_event(pi_event: dict[str, object]) -> list[dict[str, object]]:
        translated: list[dict[str, object]] = []
        event_type = str(pi_event.get("type") or "").strip()
        if event_type == "message_update":
            assistant_event = pi_event.get("assistantMessageEvent")
            if isinstance(assistant_event, dict) and assistant_event.get("type") == "text_delta":
                delta = str(assistant_event.get("delta") or "")
                if delta:
                    translated.append({"type": "assistant.chunk", "text": delta})
        elif event_type == "tool_execution_start":
            tool_name = str(pi_event.get("toolName") or "").strip() or "tool"
            translated.append(
                {
                    "type": "tool.start",
                    "tool_call_id": str(pi_event.get("toolCallId") or "").strip(),
                    "tool_name": tool_name,
                    "tool_label": format_tool_label(tool_name, pi_event.get("args")),
                }
            )
        elif event_type == "tool_execution_end":
            tool_name = str(pi_event.get("toolName") or "").strip() or "tool"
            translated.append(
                {
                    "type": "tool.end",
                    "tool_call_id": str(pi_event.get("toolCallId") or "").strip(),
                    "tool_name": tool_name,
                    "tool_label": format_tool_label(tool_name, pi_event.get("args")),
                    "tool_status": "error" if pi_event.get("isError") else "success",
                    "tool_summary": extract_tool_summary(pi_event.get("result")),
                }
            )
        elif event_type == "auto_retry_start":
            attempt = int(pi_event.get("attempt") or 1)
            max_attempts = int(pi_event.get("maxAttempts") or attempt)
            translated.append(
                {
                    "type": "retry.start",
                    "label": f"Retrying request ({attempt}/{max_attempts})...",
                }
            )
        elif event_type == "auto_retry_end":
            translated.append(
                {
                    "type": "retry.end",
                    "label": "Retry complete." if pi_event.get("success") else "Retry failed.",
                }
            )
        return translated

    def stream_agent_run(worker):
        event_queue: queue.Queue[dict[str, object] | None] = queue.Queue()
        outcome: dict[str, object] = {}

        def on_agent_event(event: dict[str, object]) -> None:
            for translated in translate_pi_event(event):
                event_queue.put(translated)

        def run_worker() -> None:
            try:
                outcome["result"] = worker(on_agent_event)
            except Exception as error:  # pragma: no cover - propagated into stream
                outcome["error"] = error
            finally:
                event_queue.put(None)

        thread = threading.Thread(target=run_worker, daemon=True)
        thread.start()
        while True:
            item = event_queue.get()
            if item is None:
                break
            yield emit(item)
        thread.join()
        error = outcome.get("error")
        if isinstance(error, Exception):
            raise error
        return outcome.get("result")

    def read_optional(path: Path) -> str | None:
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8")

    def snapshot_canvas_files() -> dict[str, str | None]:
        return {
            "collection": read_optional(collection_path),
            "pointer": read_optional(pointer_path),
        }

    def restore_canvas_files(snapshot: dict[str, str | None]) -> None:
        collection_content = snapshot.get("collection")
        pointer_content = snapshot.get("pointer")
        collection_path.parent.mkdir(parents=True, exist_ok=True)
        if collection_content is None:
            if collection_path.exists():
                collection_path.unlink()
        else:
            collection_path.write_text(collection_content, encoding="utf-8")
        if pointer_content is None:
            if pointer_path.exists():
                pointer_path.unlink()
        else:
            pointer_path.write_text(pointer_content, encoding="utf-8")

    def validate_and_canonicalize_canvas() -> dict[str, object] | None:
        if not collection_path.exists():
            return None
        document = canvas_service.canonicalize_collection_for_repo(resolved_repo_path, request.canvas_id)
        return document.model_dump(mode="json")

    def canvas_files_changed(paths: list[str]) -> bool:
        targets = {".vibeview/canvases.json", ".vibeview/canvas.json"}
        return any(path in targets for path in paths)

    def generate():
        yield emit({"type": "phase", "phase": "starting", "label": "Preparing request..."})
        try:
            canvas_snapshot = snapshot_canvas_files()
            yield emit({"type": "phase", "phase": "working", "label": "Working..."})
            yield emit(
                {
                    "type": "run.status",
                    "provider": project_service.get_project().agent_provider or settings.agent_provider,
                    "model": request.model or settings.agent_model,
                    "reasoning": request.reasoning_effort or settings.agent_reasoning_default,
                }
            )

            change_response = yield from stream_agent_run(
                lambda on_agent_event: agent_service.run_workspace_prompt(
                    repo_path=resolved_repo_path,
                    prompt=request.prompt,
                    semantic_context=request.semantic_context,
                    conversation_context=request.conversation_context,
                    image_paths=request.image_paths,
                    model=request.model,
                    reasoning_effort=request.reasoning_effort,
                    event_callback=on_agent_event,
                    canvas_id=request.canvas_id,
                    canvas_title=active_canvas.title if active_canvas else None,
                    canvas_file_path=str(collection_path),
                )
            )

            modified_files = [item.path for item in change_response.changed_files]
            document_payload = None
            repair_summary = None
            if canvas_files_changed(modified_files):
                try:
                    document_payload = validate_and_canonicalize_canvas()
                except Exception as validation_error:
                    if canvas_snapshot.get("collection") is not None:
                        backup_path.write_text(canvas_snapshot["collection"] or "", encoding="utf-8")
                    elif backup_path.exists():
                        backup_path.unlink()
                    yield emit({"type": "phase", "phase": "repairing_canvas", "label": "Repairing canvas JSON..."})
                    repair_summary = yield from stream_agent_run(
                        lambda on_agent_event: agent_service.repair_canvas_json(
                            repo_path=resolved_repo_path,
                            canvas_file_path=str(collection_path),
                            backup_file_path=str(backup_path) if backup_path.exists() else None,
                            validation_error=str(validation_error),
                            canvas_id=request.canvas_id,
                            canvas_title=active_canvas.title if active_canvas else None,
                            model=request.model,
                            reasoning_effort=request.reasoning_effort,
                            event_callback=on_agent_event,
                        )
                    )
                    try:
                        document_payload = validate_and_canonicalize_canvas()
                    except Exception:
                        restore_canvas_files(canvas_snapshot)
                        try:
                            document_payload = validate_and_canonicalize_canvas()
                        except Exception:
                            document_payload = None
                        repair_summary = "Canvas JSON was still invalid after repair, so the previous valid canvas was restored."
                    finally:
                        if backup_path.exists():
                            backup_path.unlink()
            elif request.canvas_id:
                try:
                    document_payload = canvas_service.get_document_for_repo(resolved_repo_path, request.canvas_id).model_dump(mode="json")
                except Exception:
                    document_payload = None

            summary_parts: list[str] = []
            if modified_files:
                summary_parts.append(
                    f"Updated {len(modified_files)} file{'s' if len(modified_files) != 1 else ''} in {resolved_repo_path}."
                )
            else:
                summary_parts.append(f"No files were modified in {resolved_repo_path}.")
            if repair_summary:
                summary_parts.append(repair_summary)
            summary = " ".join(summary_parts)
            yield emit(
                {
                    "type": "completed",
                    "summary": summary,
                    "code_summary": change_response.summary,
                    "modified_files": modified_files,
                    "document": document_payload,
                }
            )
        except RuntimeError as error:
            yield emit({"type": "error", "message": str(error)})

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@app.get("/canvases", response_model=CanvasListResponse)
def list_canvases(repo_path: str) -> CanvasListResponse:
    resolved_path = Path(repo_path)
    if not resolved_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {resolved_path}")
    if not resolved_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {resolved_path}")
    resolved_repo_path = str(resolved_path.resolve())
    return CanvasListResponse(repo_path=resolved_repo_path, canvases=canvas_service.list_canvases_for_repo(resolved_repo_path))


@app.post("/canvases", response_model=CanvasResponse)
def create_canvas(request: CanvasCreateRequest) -> CanvasResponse:
    resolved_repo_path = str(Path(request.repo_path).resolve())
    try:
        document = canvas_service.create_canvas(CanvasCreateRequest(repo_path=resolved_repo_path, title=request.title))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return CanvasResponse(document=document)


@app.post("/canvases/from-snapshot", response_model=CanvasResponse)
def create_canvas_from_snapshot(request: CanvasCreateFromSnapshotRequest) -> CanvasResponse:
    resolved_repo_path = str(Path(request.repo_path).resolve())
    try:
        document = canvas_service.create_canvas_from_snapshot(
            CanvasCreateFromSnapshotRequest(
                repo_path=resolved_repo_path,
                title=request.title,
                nodes=request.nodes,
                edges=request.edges,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return CanvasResponse(document=document)


@app.post("/canvases/from-prompt", response_model=CanvasGenerateResponse)
def create_canvas_from_prompt(request: CanvasCreateFromPromptRequest) -> CanvasGenerateResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {repo_path}")

    resolved_repo_path = str(repo_path.resolve())
    try:
        created_canvas = canvas_service.create_canvas(
            CanvasCreateRequest(
                repo_path=resolved_repo_path,
                title=request.title or "New canvas",
            )
        )
        nodes, edges, summary = agent_service.generate_architecture_notes(
            repo_path=resolved_repo_path,
            prompt=request.prompt,
        )
        document, created_count, note_changes = canvas_service.append_generated_map(
            resolved_repo_path,
            created_canvas.id,
            nodes,
            edges,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return CanvasGenerateResponse(
        document=document,
        summary=f"{summary} {note_changes.summary}".strip(),
        created_count=created_count,
    )


@app.patch("/canvases/{canvas_id}", response_model=CanvasResponse)
def update_canvas(canvas_id: str, request: CanvasUpdateRequest) -> CanvasResponse:
    resolved_repo_path = str(Path(request.repo_path).resolve())
    try:
        document = canvas_service.update_canvas(
            CanvasUpdateRequest(repo_path=resolved_repo_path, title=request.title),
            canvas_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return CanvasResponse(document=document)


@app.post("/canvases/{canvas_id}/duplicate", response_model=CanvasResponse)
def duplicate_canvas(canvas_id: str, request: CanvasDuplicateRequest) -> CanvasResponse:
    resolved_repo_path = str(Path(request.repo_path).resolve())
    try:
        document = canvas_service.duplicate_canvas(
            CanvasDuplicateRequest(repo_path=resolved_repo_path, title=request.title),
            canvas_id,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return CanvasResponse(document=document)


@app.delete("/canvases/{canvas_id}", response_model=CanvasListResponse)
def delete_canvas(canvas_id: str, repo_path: str) -> CanvasListResponse:
    resolved_repo_path = str(Path(repo_path).resolve())
    try:
        collection = canvas_service.delete_canvas(resolved_repo_path, canvas_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return CanvasListResponse(
        repo_path=resolved_repo_path,
        canvases=[
            CanvasSummary(id=canvas.id or f"canvas_{index}", title=canvas.title, node_count=len(canvas.nodes))
            for index, canvas in enumerate(collection.canvases)
        ],
    )


@app.get("/canvas", response_model=CanvasResponse)
def get_canvas(repo_path: str | None = None, canvas_id: str | None = None) -> CanvasResponse:
    if repo_path:
        resolved_path = Path(repo_path)
        if not resolved_path.exists():
            raise HTTPException(status_code=404, detail=f"Repository path does not exist: {resolved_path}")
        if not resolved_path.is_dir():
            raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {resolved_path}")
        try:
            return CanvasResponse(document=canvas_service.get_document_for_repo(str(resolved_path.resolve()), canvas_id))
        except ValueError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
    return CanvasResponse(document=canvas_service.get_document())


@app.delete("/canvas", response_model=CanvasResponse)
def reset_canvas(repo_path: str, canvas_id: str | None = None) -> CanvasResponse:
    resolved_path = Path(repo_path)
    if not resolved_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {resolved_path}")
    if not resolved_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {resolved_path}")
    try:
        return CanvasResponse(document=canvas_service.reset_repo_canvas(str(resolved_path.resolve()), canvas_id))
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@app.post("/canvas/nodes", response_model=CanvasResponse)
def create_canvas_node(request: CanvasNodeCreateRequest) -> CanvasResponse:
    return CanvasResponse(document=canvas_service.create_node(request))


@app.patch("/canvas/nodes/{node_id}", response_model=CanvasResponse)
def update_canvas_node(node_id: str, request: CanvasNodeUpdateRequest, repo_path: str, canvas_id: str | None = None) -> CanvasResponse:
    try:
        document = canvas_service.update_node(str(Path(repo_path).resolve()), canvas_id, node_id, request)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return CanvasResponse(document=document)


@app.delete("/canvas/nodes/{node_id}", response_model=CanvasResponse)
def delete_canvas_node(node_id: str, repo_path: str, canvas_id: str | None = None) -> CanvasResponse:
    try:
        document = canvas_service.delete_node(str(Path(repo_path).resolve()), canvas_id, node_id)
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
def delete_canvas_edge(edge_id: str, repo_path: str, canvas_id: str | None = None) -> CanvasResponse:
    try:
        document = canvas_service.delete_edge(str(Path(repo_path).resolve()), canvas_id, edge_id)
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
        nodes, edges, summary = agent_service.generate_architecture_notes(
            repo_path=str(repo_path.resolve()),
            prompt=request.prompt,
        )
        document, created_count, note_changes = canvas_service.append_generated_map(
            str(repo_path.resolve()),
            request.canvas_id,
            nodes,
            edges,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    return CanvasGenerateResponse(
        document=document,
        summary=f"{summary} {note_changes.summary}".strip(),
        created_count=created_count,
    )


@app.post("/canvas/edit-preview", response_model=CanvasEditPreviewResponse)
def preview_canvas_edits(request: CanvasEditPreviewRequest) -> CanvasEditPreviewResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {repo_path}")

    resolved_repo_path = str(repo_path.resolve())
    canvas_service.set_repo_path(resolved_repo_path)
    document = canvas_service.get_document_for_repo(resolved_repo_path, request.canvas_id)
    target_note_ids = [node_id for node_id in request.target_note_ids if node_id.strip()]
    if not target_note_ids:
        raise HTTPException(status_code=400, detail="Select or mention at least one note to edit.")

    target_nodes = [node for node in document.nodes if node.id in set(target_note_ids)]
    if not target_nodes:
        raise HTTPException(status_code=400, detail="No matching target notes were found on the current canvas.")

    impacted_map = canvas_service.find_impacted_notes(document, [node.id for node in target_nodes])
    impacted_notes = [(node, impacted_map[node.id]) for node in document.nodes if node.id in impacted_map]
    try:
        changes, summary = agent_service.draft_canvas_changes(
            repo_path=resolved_repo_path,
            prompt=request.prompt,
            target_nodes=target_nodes,
            impacted_notes=impacted_notes,
            semantic_context=request.semantic_context,
            conversation_context=request.conversation_context,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    return CanvasEditPreviewResponse(
        repo_path=resolved_repo_path,
        prompt=request.prompt,
        summary=summary,
        direct_count=sum(1 for change in changes if change.scope == "direct"),
        impacted_count=sum(1 for change in changes if change.scope == "impacted"),
        changes=changes,
    )


@app.post("/canvas/edit-apply", response_model=CanvasEditApplyResponse)
def apply_canvas_edits(request: CanvasEditApplyRequest) -> CanvasEditApplyResponse:
    repo_path = Path(request.repo_path)
    if not repo_path.exists():
        raise HTTPException(status_code=404, detail=f"Repository path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Repository path is not a directory: {repo_path}")

    resolved_repo_path = str(repo_path.resolve())
    canvas_service.set_repo_path(resolved_repo_path)
    try:
        document, note_changes, applied_change_ids, remaining_change_ids = canvas_service.apply_canvas_edit_changes(
            resolved_repo_path,
            request.canvas_id,
            request.changes,
            request.accepted_change_ids,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    summary = (
        f"Applied {len(applied_change_ids)} note change{'s' if len(applied_change_ids) != 1 else ''}."
        if applied_change_ids
        else "No note changes were applied."
    )
    return CanvasEditApplyResponse(
        repo_path=resolved_repo_path,
        summary=summary,
        note_changes_summary=note_changes.summary,
        applied_change_ids=applied_change_ids,
        remaining_change_ids=remaining_change_ids,
        document=document,
    )


def build_status(preview: str | None = None) -> StatusResponse:
    payload = state_store.load()
    project = project_service.get_project()
    active_provider = project.agent_provider or settings.agent_provider
    auth_status = agent_auth_service.get_status(active_provider)
    return StatusResponse(
        memgraph_ok=graph_service.healthcheck(),
        cgr_ok=settings.cgr_binary.exists(),
        agent_ok=agent_service.is_available(),
        active_repo_path=payload.get("active_repo_path"),
        config_path=str(settings.config_path),
        log_path=str(settings.log_path),
        default_repo_path=str(settings.default_repo_path),
        sample_repos={name: str(path) for name, path in settings.sample_repos.items()},
        index_job=index_service.current_state(),
        preview=preview,
        agent_name=settings.agent_name,
        agent_binary=str(settings.agent_binary) if settings.agent_binary else None,
        agent_provider=active_provider,
        agent_model=settings.agent_model,
        agent_auth_required=auth_status.auth_required,
    )
