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
  codex_ok: boolean;
  active_repo_path: string | null;
  config_path: string;
  log_path: string;
  default_repo_path: string;
  sample_repos: Record<string, string>;
  index_job: IndexJobState;
  preview: string | null;
  codex_binary: string | null;
  codex_model: string | null;
}

export interface ProjectProfile {
  name: string;
  repo_path: string;
  recent_projects: string[];
}

export interface ProjectProfileResponse {
  project: ProjectProfile;
  is_configured: boolean;
}

export interface ProjectWorkspaceStatusResponse {
  repo_path: string;
  has_project_files: boolean;
  visible_file_count: number;
  has_canvas_nodes: boolean;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  title?: string | null;
  content: string;
  created_at?: string | null;
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

export interface ProjectTreeItem {
  name: string;
  repo_path: string;
  conversations: ConversationSummary[];
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
  suggested_message: string | null;
  changed_files: string[];
}

export interface CommitCreateResponse {
  repo_path: string;
  commit_sha: string;
  message: string;
  summary: string;
}

export interface CodexCommandRecord {
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

export interface CodexChangeResponse {
  repo_path: string;
  prompt: string;
  summary: string;
  dry_run: boolean;
  used_graph_context: boolean;
  bypass_sandbox: boolean;
  codex_binary: string;
  codex_model: string | null;
  graph_context_summary: string | null;
  changed_files: ChangedFileRecord[];
  commands: CodexCommandRecord[];
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
}

export interface CanvasEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  label: string;
}

export interface CanvasDocument {
  repo_path: string | null;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasResponse {
  document: CanvasDocument;
}

export interface CanvasGenerateResponse {
  document: CanvasDocument;
  summary: string;
  created_count: number;
}

export interface ProjectBuildResponse {
  repo_path: string;
  prompt: string;
  summary: string;
  code_summary: string;
  note_summary: string;
  note_changes_summary: string;
  modified_files: string[];
  notes_created: number;
  document: CanvasDocument;
}

export interface ProjectPlanResponse {
  repo_path: string;
  prompt: string;
  summary: string;
  plan_text: string;
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
  type: "phase" | "assistant.chunk" | "completed" | "error";
  phase?: string;
  label?: string;
  text?: string;
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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

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
  return apiRequest<ProjectProfileResponse>("/project", { cache: "no-store" });
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

export function runCodexChange(
  repoPath: string,
  prompt: string,
  dryRun: boolean,
  useGraphContext: boolean,
  bypassSandbox: boolean,
  semanticContext?: string,
) {
  return apiRequest<CodexChangeResponse>("/codex/change", {
    method: "POST",
    body: JSON.stringify({
      repo_path: repoPath,
      prompt,
      dry_run: dryRun,
      use_graph_context: useGraphContext,
      bypass_sandbox: bypassSandbox,
      semantic_context: semanticContext,
    }),
  });
}

export function buildProjectFromPrompt(
  repoPath: string,
  prompt: string,
  semanticContext?: string,
  selectedNoteIds: string[] = [],
  conversationContext?: string,
) {
  return apiRequest<ProjectBuildResponse>("/project/build", {
    method: "POST",
    body: JSON.stringify({
      repo_path: repoPath,
      prompt,
      semantic_context: semanticContext,
      selected_note_ids: selectedNoteIds,
      conversation_context: conversationContext,
    }),
  });
}

export function planProjectFromPrompt(
  repoPath: string,
  prompt: string,
  semanticContext?: string,
  conversationContext?: string,
) {
  return apiRequest<ProjectPlanResponse>("/project/plan", {
    method: "POST",
    body: JSON.stringify({
      repo_path: repoPath,
      prompt,
      semantic_context: semanticContext,
      conversation_context: conversationContext,
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
  mode: "ask" | "plan" | "build" | "auto",
  prompt: string,
  semanticContext: string | undefined,
  conversationContext: string | undefined,
  model: string | undefined,
  reasoningEffort: "low" | "medium" | "high" | "xhigh" | undefined,
  onEvent: (event: ProjectRunStreamEvent) => void,
) {
  const response = await fetch(`${API_BASE_URL}/project/run-stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_path: repoPath,
      mode,
      prompt,
      semantic_context: semanticContext,
      conversation_context: conversationContext,
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

export function fetchCanvas(repoPath?: string) {
  const suffix = repoPath ? `?repo_path=${encodeURIComponent(repoPath)}` : "";
  return apiRequest<CanvasResponse>(`/canvas${suffix}`, { cache: "no-store" });
}

export function resetCanvas(repoPath: string) {
  return apiRequest<CanvasResponse>(`/canvas?repo_path=${encodeURIComponent(repoPath)}`, {
    method: "DELETE",
  });
}

export function createCanvasNode(payload: {
  title: string;
  description: string;
  tags?: string[];
  x: number;
  y: number;
  linked_files?: string[];
  linked_symbols?: string[];
}) {
  return apiRequest<CanvasResponse>("/canvas/nodes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateCanvasNode(
  nodeId: string,
  payload: Partial<{
    title: string;
    description: string;
    tags: string[];
    x: number;
    y: number;
    linked_files: string[];
    linked_symbols: string[];
  }>,
) {
  return apiRequest<CanvasResponse>(`/canvas/nodes/${encodeURIComponent(nodeId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCanvasNode(nodeId: string) {
  return apiRequest<CanvasResponse>(`/canvas/nodes/${encodeURIComponent(nodeId)}`, {
    method: "DELETE",
  });
}

export function createCanvasEdge(payload: {
  source_node_id: string;
  target_node_id: string;
  label?: string;
}) {
  return apiRequest<CanvasResponse>("/canvas/edges", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteCanvasEdge(edgeId: string) {
  return apiRequest<CanvasResponse>(`/canvas/edges/${encodeURIComponent(edgeId)}`, {
    method: "DELETE",
  });
}

export function generateCanvasFromPrompt(repoPath: string, prompt: string) {
  return apiRequest<CanvasGenerateResponse>("/canvas/generate", {
    method: "POST",
    body: JSON.stringify({ repo_path: repoPath, prompt }),
  });
}
