export type QueryMode = "search" | "cypher";

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

export interface AgentsDocumentResponse {
  repo_path: string;
  path: string;
  content: string;
}

export interface SymbolRecord {
  labels: string[];
  properties: Record<string, unknown>;
}

export interface RelationshipRecord {
  relationship: string;
  direction: "incoming" | "outgoing";
  other_node: SymbolRecord;
}

export interface RelationshipsResponse {
  qualified_name: string;
  total: number;
  items: RelationshipRecord[];
}

export interface StructureNode {
  id: string;
  name: string;
  kind: string;
  path: string | null;
  qualified_name: string | null;
  children: StructureNode[];
}

export interface StructureResponse {
  project_name: string;
  root: StructureNode;
}

export interface QueryResponse {
  mode: QueryMode;
  results: Array<Record<string, unknown> | SymbolRecord>;
}

export interface ImpactSeed {
  score: number;
  reason: string;
  file_path: string | null;
  symbol: SymbolRecord;
}

export interface ImpactRelationshipRecord {
  source_qualified_name: string;
  relationship: string;
  direction: "incoming" | "outgoing";
  reason: string;
  file_path: string | null;
  other_node: SymbolRecord;
}

export interface ImpactFileRecord {
  path: string;
  reasons: string[];
}

export interface AssistImpactResponse {
  mode: "heuristic";
  prompt: string;
  summary: string;
  seeds: ImpactSeed[];
  related_symbols: ImpactRelationshipRecord[];
  affected_files: ImpactFileRecord[];
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
  modified_files: string[];
  notes_created: number;
  document: CanvasDocument;
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

export function updateProject(payload: ProjectProfile) {
  return apiRequest<ProjectProfileResponse>("/project", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchProjectAgents(repoPath?: string) {
  const suffix = repoPath ? `?repo_path=${encodeURIComponent(repoPath)}` : "";
  return apiRequest<AgentsDocumentResponse>(`/project/agents${suffix}`, { cache: "no-store" });
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

export function runQuery(input: string, mode: QueryMode) {
  return apiRequest<QueryResponse>("/query", {
    method: "POST",
    body: JSON.stringify(mode === "search" ? { text: input, limit: 20 } : { cypher: input, limit: 20 }),
  });
}

export function fetchRelationships(qualifiedName: string) {
  return apiRequest<RelationshipsResponse>(
    `/relationships?qualified_name=${encodeURIComponent(qualifiedName)}&relationship=CALLS&direction=outgoing`,
    { cache: "no-store" },
  );
}

export function fetchStructure(projectName?: string) {
  const suffix = projectName ? `?project_name=${encodeURIComponent(projectName)}` : "";
  return apiRequest<StructureResponse>(`/structure${suffix}`, { cache: "no-store" });
}

export function runImpactAnalysis(prompt: string, limit = 6) {
  return apiRequest<AssistImpactResponse>("/assist/impact", {
    method: "POST",
    body: JSON.stringify({ prompt, limit }),
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
) {
  return apiRequest<ProjectBuildResponse>("/project/build", {
    method: "POST",
    body: JSON.stringify({
      repo_path: repoPath,
      prompt,
      semantic_context: semanticContext,
      selected_note_ids: selectedNoteIds,
    }),
  });
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
