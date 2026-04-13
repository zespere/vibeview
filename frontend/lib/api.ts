export type IndexJobStatus = "idle" | "running" | "completed" | "failed";

export interface IndexJobState {
  status: IndexJobStatus;
  repo_path: string | null;
  started_at: string | null;
  finished_at: string | null;
  return_code: number | null;
  message: string | null;
}

export interface StatusResponse {
  memgraph_ok: boolean;
  cgr_ok: boolean;
  agent_ok: boolean;
  active_repo_path: string | null;
  config_path: string;
  log_path: string;
  default_repo_path: string;
  sample_repos: Record<string, string>;
  index_job: IndexJobState;
  preview: string | null;
  agent_name: string;
  agent_binary: string | null;
  agent_provider: string | null;
  agent_model: string | null;
  agent_auth_required: boolean;
}

export interface ProjectProfile {
  name: string;
  repo_path: string;
  recent_projects: string[];
  agent_provider: string | null;
}

export interface ProjectProfileResponse {
  project: ProjectProfile;
  is_configured: boolean;
}

export interface ProjectFolderPickResponse {
  repo_path: string | null;
}

export interface AgentProviderOption {
  id: string;
  label: string;
  env_var: string;
}

export interface AgentAuthStatusResponse {
  active_provider: string | null;
  auth_required: boolean;
  configured_providers: string[];
  providers: AgentProviderOption[];
}

export interface AgentModelCapability {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  supports_images: boolean;
  context_window: number | null;
  max_tokens: number | null;
}

export interface AgentProviderCapabilities {
  id: string;
  models: AgentModelCapability[];
}

export interface AgentCapabilitiesResponse {
  providers: AgentProviderCapabilities[];
}

export interface ProjectImageUploadResponse {
  file_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
}

export interface ProjectWorkspaceStatusResponse {
  repo_path: string;
  has_project_files: boolean;
  visible_file_count: number;
  has_canvas_nodes: boolean;
}

export interface ConversationRunTool {
  id: string;
  name: string;
  label: string;
  status: "running" | "success" | "error";
  summary?: string | null;
  command?: string | null;
  output?: string | null;
}

export interface ConversationRunState {
  provider?: string | null;
  model?: string | null;
  reasoning?: string | null;
  phase_label?: string | null;
  is_streaming?: boolean;
  tools?: ConversationRunTool[];
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  title?: string | null;
  content: string;
  created_at?: string | null;
  run_state?: ConversationRunState | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updated_at?: string | null;
  message_count: number;
  placeholder: boolean;
}

export interface ConversationRecord {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: ConversationMessage[];
}

export interface ConversationListResponse {
  repo_path: string;
  conversations: ConversationSummary[];
}

export interface ConversationResponse {
  repo_path: string;
  conversation: ConversationRecord;
}

export interface CanvasSummary {
  id: string;
  title: string;
  node_count: number;
}

export interface ProjectTreeItem {
  name: string;
  repo_path: string;
  conversations: ConversationSummary[];
  canvases: CanvasSummary[];
}

export interface ProjectTreeResponse {
  active_repo_path: string | null;
  projects: ProjectTreeItem[];
}

export interface AgentsDocumentResponse {
  repo_path: string;
  path: string;
  content: string;
}

export interface CommitStatusResponse {
  repo_path: string;
  is_git_repo: boolean;
  has_changes: boolean;
  branch_name: string | null;
  upstream_name: string | null;
  ahead_count: number;
  behind_count: number;
  can_push: boolean;
  suggested_message: string | null;
  changed_files: string[];
}

export interface CommitCreateResponse {
  repo_path: string;
  commit_sha: string;
  message: string;
  summary: string;
}

export interface PushCreateResponse {
  repo_path: string;
  branch_name: string | null;
  upstream_name: string | null;
  summary: string;
}

export interface AgentCommandRecord {
  command: string;
  status: string;
  exit_code: number | null;
  output: string | null;
}

export interface ChangedFileRecord {
  path: string;
  change_type: "added" | "modified" | "deleted";
  diff: string;
}

export interface AgentChangeResponse {
  repo_path: string;
  prompt: string;
  summary: string;
  dry_run: boolean;
  used_graph_context: boolean;
  agent_binary: string;
  agent_name: string;
  agent_provider: string | null;
  agent_model: string | null;
  graph_context_summary: string | null;
  changed_files: ChangedFileRecord[];
  commands: AgentCommandRecord[];
  raw_event_count: number;
}

export interface CanvasNode {
  id: string;
  title: string;
  description: string;
  tags: string[];
  x: number;
  y: number;
  linked_files: string[];
  linked_symbols: string[];
  linked_canvas_id: string | null;
}

export interface CanvasEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  label: string;
}

export interface CanvasDocument {
  id: string | null;
  title: string;
  repo_path: string | null;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasResponse {
  document: CanvasDocument;
}

export interface CanvasListResponse {
  repo_path: string;
  canvases: CanvasSummary[];
}

export interface CanvasEditChangeRecord {
  id: string;
  kind: "update_node" | "create_node" | "delete_node" | "create_edge";
  scope: "direct" | "impacted";
  reason: string;
  impact_basis: string[];
  depends_on_change_ids: string[];
  target_node_id?: string | null;
  target_title?: string | null;
  anchor_node_id?: string | null;
  before_node?: CanvasNode | null;
  after_node?: CanvasNode | null;
  before_edge?: CanvasEdge | null;
  after_edge?: CanvasEdge | null;
}

export interface CanvasEditPreviewResponse {
  repo_path: string;
  prompt: string;
  summary: string;
  direct_count: number;
  impacted_count: number;
  changes: CanvasEditChangeRecord[];
}

export interface CanvasEditApplyResponse {
  repo_path: string;
  summary: string;
  note_changes_summary: string;
  applied_change_ids: string[];
  remaining_change_ids: string[];
  document: CanvasDocument;
}

export interface CanvasGenerateResponse {
  document: CanvasDocument;
  summary: string;
  created_count: number;
}


export interface ProjectAskResponse {
  repo_path: string;
  prompt: string;
  summary: string;
  answer_text: string;
}

export interface ExplorationContextNode {
  title: string;
  description: string;
  tags: string[];
  linked_files: string[];
  linked_symbols: string[];
}

export interface ExplorationSuggestionRecord {
  title: string;
  summary: string;
  edge_label: string;
}

export interface ExplorationSuggestionResponse {
  repo_path: string;
  suggestions: ExplorationSuggestionRecord[];
}

export interface ProjectRunStreamEvent {
  type:
    | "phase"
    | "run.status"
    | "assistant.chunk"
    | "tool.start"
    | "tool.end"
    | "retry.start"
    | "retry.end"
    | "completed"
    | "error";
  phase?: string;
  label?: string;
  text?: string;
  provider?: string | null;
  model?: string | null;
  reasoning?: string | null;
  tool_call_id?: string;
  tool_name?: string;
  tool_label?: string;
  tool_status?: "success" | "error";
  tool_summary?: string | null;
  tool_command?: string | null;
  tool_output?: string | null;
  mode?: "ask" | "plan" | "build";
  summary?: string;
  answer_text?: string;
  plan_text?: string;
  code_summary?: string;
  note_summary?: string;
  note_changes_summary?: string;
  modified_files?: string[];
  notes_created?: number;
  document?: CanvasDocument;
  message?: string;
}

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const timeoutMs =
    typeof (init as RequestInit & { timeoutMs?: number } | undefined)?.timeoutMs === "number"
      ? ((init as RequestInit & { timeoutMs?: number }).timeoutMs as number)
      : null;
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId =
    timeoutMs && controller
      ? window.setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

  const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: init?.signal ?? controller?.signal,
      headers: isFormDataBody
        ? init?.headers
        : {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
          },
    });
  } catch (error) {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw error;
  }

  if (timeoutId !== null) {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export function fetchStatus() {
  return apiRequest<StatusResponse>("/status", { cache: "no-store" });
}

export function fetchProject() {
  return apiRequest<ProjectProfileResponse>("/project", { cache: "no-store", timeoutMs: 5000 } as RequestInit & { timeoutMs: number });
}

export function fetchAgentAuthStatus() {
  return apiRequest<AgentAuthStatusResponse>("/agent/auth", { cache: "no-store" });
}

export function fetchAgentCapabilities() {
  return apiRequest<AgentCapabilitiesResponse>("/agent/capabilities", { cache: "no-store" });
}

export function updateAgentAuth(provider: string, apiKey?: string) {
  return apiRequest<AgentAuthStatusResponse>("/agent/auth", {
    method: "PUT",
    body: JSON.stringify({
      provider,
      api_key: apiKey ?? null,
      set_active: true,
    }),
  });
}

export function fetchProjectWorkspaceStatus(repoPath: string) {
  return apiRequest<ProjectWorkspaceStatusResponse>(
    `/project/workspace-status?repo_path=${encodeURIComponent(repoPath)}`,
    { cache: "no-store" },
  );
}

export function fetchProjectsTree() {
  return apiRequest<ProjectTreeResponse>("/projects/tree", { cache: "no-store" });
}

export function updateProject(payload: ProjectProfile) {
  return apiRequest<ProjectProfileResponse>("/project", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function pickProjectFolder() {
  return apiRequest<ProjectFolderPickResponse>("/project/pick-folder", {
    method: "POST",
  });
}

export function fetchProjectConversations(repoPath: string) {
  return apiRequest<ConversationListResponse>(
    `/project/conversations?repo_path=${encodeURIComponent(repoPath)}`,
    { cache: "no-store" },
  );
}

export function fetchProjectConversation(repoPath: string, conversationId: string) {
  return apiRequest<ConversationResponse>(
    `/project/conversations/${encodeURIComponent(conversationId)}?repo_path=${encodeURIComponent(repoPath)}`,
    { cache: "no-store" },
  );
}

export function createProjectConversation(repoPath: string, title = "New conversation") {
  return apiRequest<ConversationResponse>("/project/conversations", {
    method: "POST",
    body: JSON.stringify({ repo_path: repoPath, title }),
  });
}

export function updateProjectConversation(
  repoPath: string,
  conversationId: string,
  payload: Partial<{
    title: string;
    messages: ConversationMessage[];
  }>,
) {
  return apiRequest<ConversationResponse>(`/project/conversations/${encodeURIComponent(conversationId)}`, {
    method: "PATCH",
    body: JSON.stringify({ repo_path: repoPath, ...payload }),
  });
}

export function fetchProjectAgents(repoPath?: string) {
  const suffix = repoPath ? `?repo_path=${encodeURIComponent(repoPath)}` : "";
  return apiRequest<AgentsDocumentResponse>(`/project/agents${suffix}`, { cache: "no-store" });
}

export function fetchCommitStatus(repoPath: string) {
  return apiRequest<CommitStatusResponse>(
    `/project/commit-status?repo_path=${encodeURIComponent(repoPath)}`,
    { cache: "no-store" },
  );
}

export function createProjectCommit(repoPath: string, message?: string) {
  return apiRequest<CommitCreateResponse>("/project/commit", {
    method: "POST",
    body: JSON.stringify({ repo_path: repoPath, message }),
  });
}

export function pushProjectCommits(repoPath: string) {
  return apiRequest<PushCreateResponse>("/project/push", {
    method: "POST",
    body: JSON.stringify({ repo_path: repoPath }),
  });
}

export function updateProjectAgents(content: string, repoPath?: string) {
  return apiRequest<AgentsDocumentResponse>("/project/agents", {
    method: "PUT",
    body: JSON.stringify({ content, repo_path: repoPath }),
  });
}

export function runIndex(repoPath: string, clean: boolean, dryRun: boolean) {
  return apiRequest<StatusResponse>("/index", {
    method: "POST",
    body: JSON.stringify({ repo_path: repoPath, clean, dry_run: dryRun }),
  });
}

export function runAgentChange(
  repoPath: string,
  prompt: string,
  dryRun: boolean,
  useGraphContext: boolean,
  semanticContext?: string,
) {
  return apiRequest<AgentChangeResponse>("/agent/change", {
    method: "POST",
    body: JSON.stringify({
      repo_path: repoPath,
      prompt,
      dry_run: dryRun,
      use_graph_context: useGraphContext,
      semantic_context: semanticContext,
    }),
  });
}


export function askProjectQuestion(
  repoPath: string,
  prompt: string,
  semanticContext?: string,
  conversationContext?: string,
) {
  return apiRequest<ProjectAskResponse>("/project/ask", {
    method: "POST",
    body: JSON.stringify({
      repo_path: repoPath,
      prompt,
      semantic_context: semanticContext,
      conversation_context: conversationContext,
    }),
  });
}

export function fetchExplorationSuggestions(
  repoPath: string,
  activeNode: ExplorationContextNode,
  pathTitles: string[],
  semanticContext?: string,
  conversationContext?: string,
  relationQuery?: string,
  suggestionCount = 3,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  return apiRequest<ExplorationSuggestionResponse>("/project/exploration-suggestions", {
    method: "POST",
    signal: controller.signal,
    body: JSON.stringify({
      repo_path: repoPath,
      active_node: activeNode,
      path_titles: pathTitles,
      relation_query: relationQuery,
      semantic_context: semanticContext,
      conversation_context: conversationContext,
      suggestion_count: suggestionCount,
    }),
  }).finally(() => window.clearTimeout(timeout));
}

export async function streamProjectRun(
  repoPath: string,
  prompt: string,
  canvasId: string | null | undefined,
  semanticContext: string | undefined,
  conversationContext: string | undefined,
  imagePaths: string[] | undefined,
  model: string | undefined,
  reasoningEffort: "low" | "medium" | "high" | "xhigh" | undefined,
  onEvent: (event: ProjectRunStreamEvent) => void,
) {
  const response = await fetch(`${API_BASE_URL}/project/run-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_path: repoPath,
      prompt,
      canvas_id: canvasId,
      semantic_context: semanticContext,
      conversation_context: conversationContext,
      image_paths: imagePaths,
      model,
      reasoning_effort: reasoningEffort,
    }),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text();
    throw new Error(detail || `Request failed with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      onEvent(JSON.parse(trimmed) as ProjectRunStreamEvent);
    }
  }

  const trailing = buffer.trim();
  if (trailing) {
    onEvent(JSON.parse(trailing) as ProjectRunStreamEvent);
  }
}

export async function uploadProjectImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiRequest<ProjectImageUploadResponse>("/project/attachments/image", {
    method: "POST",
    body: formData,
  });
}

export function fetchCanvases(repoPath: string) {
  return apiRequest<CanvasListResponse>(`/canvases?repo_path=${encodeURIComponent(repoPath)}`, {
    cache: "no-store",
  });
}

export function createProjectCanvas(repoPath: string, title?: string) {
  return apiRequest<CanvasResponse>("/canvases", {
    method: "POST",
    body: JSON.stringify({
      repo_path: repoPath,
      title,
    }),
  });
}

export function createProjectCanvasFromSnapshot(
  repoPath: string,
  title: string | undefined,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
) {
  return apiRequest<CanvasResponse>("/canvases/from-snapshot", {
    method: "POST",
    body: JSON.stringify({
      repo_path: repoPath,
      title,
      nodes,
      edges,
    }),
  });
}

export function createProjectCanvasFromPrompt(
  repoPath: string,
  prompt: string,
  title?: string,
) {
  return apiRequest<CanvasGenerateResponse>("/canvases/from-prompt", {
    method: "POST",
    body: JSON.stringify({
      repo_path: repoPath,
      prompt,
      title,
    }),
  });
}

export function renameProjectCanvas(repoPath: string, canvasId: string, title: string) {
  return apiRequest<CanvasResponse>(`/canvases/${encodeURIComponent(canvasId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      repo_path: repoPath,
      title,
    }),
  });
}

export function duplicateProjectCanvas(repoPath: string, canvasId: string, title?: string) {
  return apiRequest<CanvasResponse>(`/canvases/${encodeURIComponent(canvasId)}/duplicate`, {
    method: "POST",
    body: JSON.stringify({
      repo_path: repoPath,
      title,
    }),
  });
}

export function deleteProjectCanvas(repoPath: string, canvasId: string) {
  return apiRequest<CanvasListResponse>(`/canvases/${encodeURIComponent(canvasId)}?repo_path=${encodeURIComponent(repoPath)}`, {
    method: "DELETE",
  });
}

export function fetchCanvas(repoPath?: string, canvasId?: string | null) {
  const params = new URLSearchParams();
  if (repoPath) {
    params.set("repo_path", repoPath);
  }
  if (canvasId) {
    params.set("canvas_id", canvasId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiRequest<CanvasResponse>(`/canvas${suffix}`, { cache: "no-store" });
}

export function resetCanvas(repoPath: string, canvasId?: string | null) {
  const params = new URLSearchParams({ repo_path: repoPath });
  if (canvasId) {
    params.set("canvas_id", canvasId);
  }
  return apiRequest<CanvasResponse>(`/canvas?${params.toString()}`, {
    method: "DELETE",
  });
}

export function createCanvasNode(payload: {
  repo_path: string;
  canvas_id?: string | null;
  title: string;
  description: string;
  tags?: string[];
  x: number;
  y: number;
  linked_files?: string[];
  linked_symbols?: string[];
  linked_canvas_id?: string | null;
}) {
  return apiRequest<CanvasResponse>("/canvas/nodes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCanvasNode(
  nodeId: string,
  repoPath: string,
  canvasId: string | null | undefined,
  payload: Partial<{
    title: string;
    description: string;
    tags: string[];
    x: number;
    y: number;
    linked_files: string[];
    linked_symbols: string[];
    linked_canvas_id: string | null;
  }>,
) {
  const params = new URLSearchParams({ repo_path: repoPath });
  if (canvasId) {
    params.set("canvas_id", canvasId);
  }
  return apiRequest<CanvasResponse>(`/canvas/nodes/${encodeURIComponent(nodeId)}?${params.toString()}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCanvasNode(nodeId: string, repoPath: string, canvasId: string | null | undefined) {
  const params = new URLSearchParams({ repo_path: repoPath });
  if (canvasId) {
    params.set("canvas_id", canvasId);
  }
  return apiRequest<CanvasResponse>(`/canvas/nodes/${encodeURIComponent(nodeId)}?${params.toString()}`, {
    method: "DELETE",
  });
}

export function createCanvasEdge(payload: {
  repo_path: string;
  canvas_id?: string | null;
  source_node_id: string;
  target_node_id: string;
  label?: string;
}) {
  return apiRequest<CanvasResponse>("/canvas/edges", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteCanvasEdge(edgeId: string, repoPath: string, canvasId: string | null | undefined) {
  const params = new URLSearchParams({ repo_path: repoPath });
  if (canvasId) {
    params.set("canvas_id", canvasId);
  }
  return apiRequest<CanvasResponse>(`/canvas/edges/${encodeURIComponent(edgeId)}?${params.toString()}`, {
    method: "DELETE",
  });
}

export function generateCanvasFromPrompt(repoPath: string, prompt: string, canvasId?: string | null) {
  return apiRequest<CanvasGenerateResponse>("/canvas/generate", {
    method: "POST",
    body: JSON.stringify({ repo_path: repoPath, prompt, canvas_id: canvasId }),
  });
}

export function previewCanvasEdits(
  repoPath: string,
  canvasId: string | null | undefined,
  prompt: string,
  targetNoteIds: string[],
  semanticContext?: string,
  conversationContext?: string,
) {
  return apiRequest<CanvasEditPreviewResponse>("/canvas/edit-preview", {
    method: "POST",
    body: JSON.stringify({
      repo_path: repoPath,
      canvas_id: canvasId,
      prompt,
      target_note_ids: targetNoteIds,
      semantic_context: semanticContext,
      conversation_context: conversationContext,
    }),
  });
}

export function applyCanvasEdits(
  repoPath: string,
  canvasId: string | null | undefined,
  changes: CanvasEditChangeRecord[],
  acceptedChangeIds: string[],
) {
  return apiRequest<CanvasEditApplyResponse>("/canvas/edit-apply", {
    method: "POST",
    body: JSON.stringify({
      repo_path: repoPath,
      canvas_id: canvasId,
      changes,
      accepted_change_ids: acceptedChangeIds,
    }),
  });
}
