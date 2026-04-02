"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import styles from "./page.module.css";
import { CanvasBoard } from "@/components/canvas-board";
import { StructureTree } from "@/components/structure-tree";
import {
  API_BASE_URL,
  createCanvasNode,
  createProjectCommit,
  deleteCanvasNode,
  fetchCanvas,
  fetchCommitStatus,
  fetchProjectConversation,
  fetchProjectsTree,
  fetchProject,
  fetchProjectWorkspaceStatus,
  fetchProjectAgents,
  fetchRelationships,
  fetchStatus,
  fetchStructure,
  createProjectConversation,
  generateCanvasFromPrompt,
  runImpactAnalysis,
  runQuery,
  streamProjectRun,
  resetCanvas,
  updateProject,
  updateProjectConversation,
  updateProjectAgents,
  updateCanvasNode,
  type AgentsDocumentResponse,
  type AssistImpactResponse,
  type CanvasDocument,
  type CanvasNode,
  type CommitStatusResponse,
  type ConversationMessage,
  type ConversationSummary,
  type ProjectProfile,
  type ProjectTreeItem,
  type ProjectWorkspaceStatusResponse,
  type QueryMode,
  type QueryResponse,
  type RelationshipRecord,
  type StatusResponse,
  type StructureNode,
  type SymbolRecord,
  type ProjectRunStreamEvent,
} from "@/lib/api";

type WorkspaceView = "notes" | "inspect" | "project" | "chat";
type OpenTab =
  | { id: `view:${WorkspaceView}`; type: "view"; view: WorkspaceView; preview: boolean }
  | { id: `note:${string}`; type: "note"; nodeId: string }
  | { id: `explore:${string}`; type: "exploration"; explorationId: string };

const RAIL_VIEW_ITEMS: Array<{ id: Exclude<WorkspaceView, "chat">; label: string }> = [
  { id: "notes", label: "Notes" },
  { id: "inspect", label: "Inspect" },
  { id: "project", label: "Project" },
];

interface CommandPalettePosition {
  x: number;
  y: number;
}

interface CommandResultItem {
  id: string;
  title: string;
  subtitle?: string;
  group: "navigate" | "action" | "ask" | "execute";
  run: () => void;
}

interface ExplorationSession {
  id: string;
  rootNodeId: string;
  activeNodeId: string;
  pathNodeIds: string[];
  relationQuery: string;
}

interface ExplorationPresentation {
  activeNode: CanvasNode | null;
  customMatches: CanvasNode[];
  displayDocument: CanvasDocument | null;
  pathNodes: CanvasNode[];
  suggestedNodes: CanvasNode[];
  visibleNodeIds: string[];
}

export default function Home() {
  const [isRailExpanded, setIsRailExpanded] = useState(true);
  const [railWidth, setRailWidth] = useState(292);
  const [isRailResizing, setIsRailResizing] = useState(false);
  const [railResizeStartX, setRailResizeStartX] = useState<number | null>(null);
  const [railResizeStartWidth, setRailResizeStartWidth] = useState<number | null>(null);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([
    { id: "view:notes", type: "view", view: "notes", preview: false },
  ]);
  const [activeTabId, setActiveTabId] = useState<OpenTab["id"]>("view:notes");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [project, setProject] = useState<ProjectProfile | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<ProjectWorkspaceStatusResponse | null>(null);
  const [projectsTree, setProjectsTree] = useState<ProjectTreeItem[]>([]);
  const [isProjectsSectionExpanded, setIsProjectsSectionExpanded] = useState(true);
  const [expandedProjectPaths, setExpandedProjectPaths] = useState<Set<string>>(new Set());
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationRepoPath, setActiveConversationRepoPath] = useState<string | null>(null);
  const [agentsDocument, setAgentsDocument] = useState<AgentsDocumentResponse | null>(null);
  const [agentsContent, setAgentsContent] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [inspectView, setInspectView] = useState<"structure" | "search" | "impact">("structure");
  const [queryMode, setQueryMode] = useState<QueryMode>("search");
  const [queryInput, setQueryInput] = useState("create user");
  const [queryResults, setQueryResults] = useState<QueryResponse["results"]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolRecord | null>(null);
  const [relationships, setRelationships] = useState<RelationshipRecord[]>([]);
  const [structure, setStructure] = useState<StructureNode | null>(null);
  const [selectedTreeNode, setSelectedTreeNode] = useState<StructureNode | null>(null);
  const [expandedTreeNodeIds, setExpandedTreeNodeIds] = useState<Set<string>>(new Set());
  const [structureRelationships, setStructureRelationships] = useState<RelationshipRecord[]>([]);
  const [impactPrompt, setImpactPrompt] = useState("create user");
  const [impactResult, setImpactResult] = useState<AssistImpactResponse | null>(null);
  const [codexPrompt, setCodexPrompt] = useState("");
  const [isPlanMode, setIsPlanMode] = useState(false);
  const [composerStatus, setComposerStatus] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGeneratingCanvas, setIsGeneratingCanvas] = useState(false);
  const [commitStatus, setCommitStatus] = useState<CommitStatusResponse | null>(null);
  const [isConsoleExpanded, setIsConsoleExpanded] = useState(false);
  const [consoleMessages, setConsoleMessages] = useState<ConversationMessage[]>([]);
  const [pendingPlan, setPendingPlan] = useState<{
    messageId: string;
    prompt: string;
    planText: string;
    summary: string;
  } | null>(null);
  const [canvasDocument, setCanvasDocument] = useState<CanvasDocument | null>(null);
  const [selectedCanvasNodeId, setSelectedCanvasNodeId] = useState<string | null>(null);
  const [selectedCanvasNodeIds, setSelectedCanvasNodeIds] = useState<string[]>([]);
  const [notesExploration, setNotesExploration] = useState<ExplorationSession | null>(null);
  const [explorationTabs, setExplorationTabs] = useState<Record<string, ExplorationSession>>({});
  const [openCanvasNodeIds, setOpenCanvasNodeIds] = useState<string[]>([]);
  const [canvasDraftTitle, setCanvasDraftTitle] = useState("");
  const [canvasDraftDescription, setCanvasDraftDescription] = useState("");
  const [canvasDraftTags, setCanvasDraftTags] = useState("");
  const [canvasDraftFiles, setCanvasDraftFiles] = useState("");
  const [canvasDraftSymbols, setCanvasDraftSymbols] = useState("");
  const [pinnedCanvasNodeIds, setPinnedCanvasNodeIds] = useState<string[]>([]);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [commandPaletteMode, setCommandPaletteMode] = useState<"search" | "chat">("search");
  const [commandInput, setCommandInput] = useState("");
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
  const [commandPalettePosition, setCommandPalettePosition] = useState<CommandPalettePosition>({
    x: 360,
    y: 92,
  });
  const [isCommandDragging, setIsCommandDragging] = useState(false);
  const [commandDragOffset, setCommandDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const consoleMessagesRef = useRef<HTMLDivElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const expectedRepoPathRef = useRef("");

  const [statusPending, startStatusTransition] = useTransition();
  const [projectPending, startProjectTransition] = useTransition();
  const [agentsPending, startAgentsTransition] = useTransition();
  const [queryPending, startQueryTransition] = useTransition();
  const [relationshipsPending, startRelationshipsTransition] = useTransition();
  const [, startStructureTransition] = useTransition();
  const [impactPending, startImpactTransition] = useTransition();
  const [codexPending, startCodexTransition] = useTransition();
  const [, startCanvasTransition] = useTransition();

  const selectedCanvasNode = useMemo(
    () => canvasDocument?.nodes.find((item) => item.id === selectedCanvasNodeId) ?? null,
    [canvasDocument, selectedCanvasNodeId],
  );

  const activeTab = useMemo(
    () => openTabs.find((item) => item.id === activeTabId) ?? openTabs[0] ?? null,
    [activeTabId, openTabs],
  );

  const activeView = activeTab?.type === "view" ? activeTab.view : "notes";
  const activeExplorationSession =
    activeTab?.type === "exploration" ? explorationTabs[activeTab.explorationId] ?? null : null;
  const transientNotesExploration =
    activeTab?.type === "view" && activeTab.view === "notes" ? notesExploration : null;
  const currentExplorationSession = activeExplorationSession ?? transientNotesExploration;

  const openCanvasNodes = useMemo(() => {
    if (!canvasDocument) {
      return [];
    }
    return openCanvasNodeIds
      .map((nodeId) => canvasDocument.nodes.find((item) => item.id === nodeId) ?? null)
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [canvasDocument, openCanvasNodeIds]);

  const canvasOutgoingEdges =
    canvasDocument?.edges.filter((edge) => edge.source_node_id === selectedCanvasNodeId) ?? [];
  const canvasIncomingEdges =
    canvasDocument?.edges.filter((edge) => edge.target_node_id === selectedCanvasNodeId) ?? [];
  const sampleRepos = Object.entries(status?.sample_repos ?? {});
  const currentRailWidth = isRailExpanded ? railWidth : 72;
  const activeRepoPath = (project?.repo_path || repoPath).trim();
  const focusedCanvasNodeId =
    activeTab?.type === "note"
      ? activeTab.nodeId
      : currentExplorationSession?.activeNodeId ?? selectedCanvasNodeId;
  const activeProjectTreeItem = useMemo(
    () => projectsTree.find((item) => item.repo_path === activeRepoPath) ?? null,
    [activeRepoPath, projectsTree],
  );
  const visibleContextNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (focusedCanvasNodeId) {
      ids.add(focusedCanvasNodeId);
    }
    for (const nodeId of currentExplorationSession?.pathNodeIds ?? []) {
      ids.add(nodeId);
    }
    for (const nodeId of selectedCanvasNodeIds) {
      ids.add(nodeId);
    }
    for (const nodeId of pinnedCanvasNodeIds) {
      ids.add(nodeId);
    }
    return [...ids];
  }, [currentExplorationSession?.pathNodeIds, focusedCanvasNodeId, pinnedCanvasNodeIds, selectedCanvasNodeIds]);
  const pinnedCanvasNodes = useMemo(() => {
    if (!canvasDocument) {
      return [];
    }
    return pinnedCanvasNodeIds
      .map((nodeId) => canvasDocument.nodes.find((item) => item.id === nodeId) ?? null)
      .filter((item): item is CanvasNode => item !== null);
  }, [canvasDocument, pinnedCanvasNodeIds]);
  const shouldShowCanvasSetup =
    !!canvasDocument &&
    canvasDocument.nodes.length === 0 &&
    !!activeRepoPath &&
    workspaceStatus?.repo_path === activeRepoPath &&
    workspaceStatus.has_project_files;
  const commandMode = commandInput.startsWith("?")
    ? "ask"
    : commandInput.startsWith("!")
      ? "action"
      : "navigate";
  const activeConversationSummary = useMemo(
    () =>
      activeProjectTreeItem?.conversations.find(
        (item) => item.id === activeConversationId && activeConversationRepoPath === activeProjectTreeItem.repo_path,
      ) ?? null,
    [activeConversationId, activeConversationRepoPath, activeProjectTreeItem],
  );
  const latestConsoleSummary = useMemo(() => {
    if (isPlanning) {
      return "Preparing implementation plan...";
    }
    if (isBuilding) {
      return "Building the project and refreshing notes...";
    }
    if (composerStatus) {
      return composerStatus;
    }
    if (activeConversationSummary) {
      return activeConversationSummary.title;
    }
    return consoleMessages.at(-1)?.title ?? "Ready to build in this project.";
  }, [activeConversationSummary, composerStatus, consoleMessages, isBuilding, isPlanning]);
  const notesExplorationPresentation = useMemo(
    () => buildExplorationPresentation(canvasDocument, notesExploration),
    [canvasDocument, notesExploration],
  );
  const activeExplorationPresentation = useMemo(
    () => buildExplorationPresentation(canvasDocument, activeExplorationSession),
    [activeExplorationSession, canvasDocument],
  );

  useEffect(() => {
    expectedRepoPathRef.current = activeRepoPath;
  }, [activeRepoPath]);

  useEffect(() => {
    startStatusTransition(() => {
      void refreshStatus();
    });
    startProjectTransition(() => {
      void refreshProject();
    });
    startProjectTransition(() => {
      void refreshProjectsTree();
    });
    startStructureTransition(() => {
      void refreshStructure();
    });
    startQueryTransition(() => {
      void submitQuery("create user", "search");
    });
    startImpactTransition(() => {
      void submitImpact("create user");
    });
    startCanvasTransition(() => {
      void refreshCanvas();
    });
  }, []);

  useEffect(() => {
    if (!isRailResizing) {
      return;
    }

    function handleMouseMove(event: MouseEvent) {
      if (railResizeStartX === null || railResizeStartWidth === null) {
        return;
      }
      const nextWidth = railResizeStartWidth + (event.clientX - railResizeStartX);
      setRailWidth(Math.max(232, Math.min(420, nextWidth)));
    }

    function handleMouseUp() {
      setIsRailResizing(false);
      setRailResizeStartX(null);
      setRailResizeStartWidth(null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isRailResizing, railResizeStartWidth, railResizeStartX]);

  useEffect(() => {
    if (!project) {
      return;
    }
    setRepoPath((current) => current || project.repo_path || status?.active_repo_path || status?.default_repo_path || "");
  }, [project, status]);

  useEffect(() => {
    if (!project?.repo_path) {
      setAgentsDocument(null);
      setAgentsContent("");
      setActiveConversationId(null);
      setActiveConversationRepoPath(null);
      setConsoleMessages([]);
      setPendingPlan(null);
      setCommitStatus(null);
      setWorkspaceStatus(null);
      return;
    }
    startAgentsTransition(() => {
      void refreshAgentsDocument(project.repo_path);
    });
    startCanvasTransition(() => {
      void refreshCanvas(project.repo_path);
    });
    startProjectTransition(() => {
      void refreshProjectsTree();
    });
    void refreshCommitStatus(project.repo_path);
    void refreshWorkspaceStatus(project.repo_path);
  }, [project?.repo_path]);

  useEffect(() => {
    if (!project?.repo_path) {
      return;
    }
    setExpandedProjectPaths((current) => {
      if (current.has(project.repo_path)) {
        return current;
      }
      const next = new Set(current);
      next.add(project.repo_path);
      return next;
    });
  }, [project?.repo_path]);

  useEffect(() => {
    if (!selectedCanvasNode) {
      setCanvasDraftTitle("");
      setCanvasDraftDescription("");
      setCanvasDraftTags("");
      setCanvasDraftFiles("");
      setCanvasDraftSymbols("");
      return;
    }
    setCanvasDraftTitle(selectedCanvasNode.title);
    setCanvasDraftDescription(selectedCanvasNode.description);
    setCanvasDraftTags(selectedCanvasNode.tags.join(", "));
    setCanvasDraftFiles(selectedCanvasNode.linked_files.join("\n"));
    setCanvasDraftSymbols(selectedCanvasNode.linked_symbols.join("\n"));
  }, [selectedCanvasNode]);

  useEffect(() => {
    if (!isConsoleExpanded) {
      return;
    }
    const container = consoleMessagesRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [consoleMessages, isConsoleExpanded]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
        setCommandPaletteMode("search");
        window.setTimeout(() => {
          commandInputRef.current?.focus();
          commandInputRef.current?.select();
        }, 0);
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "n" &&
        activeTab?.type === "view" &&
        activeTab.view === "notes" &&
        notesExploration
      ) {
        event.preventDefault();
        promoteNotesExplorationToTab();
        return;
      }

      if (event.key === "Escape" && isCommandPaletteOpen) {
        setIsCommandPaletteOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, isCommandPaletteOpen, notesExploration]);

  useEffect(() => {
    if (!isCommandDragging || !commandDragOffset) {
      return;
    }

    const dragOffset = commandDragOffset;

    function handleMouseMove(event: MouseEvent) {
      const nextX = Math.max(20, Math.min(window.innerWidth - 560, event.clientX - dragOffset.x));
      const nextY = Math.max(20, Math.min(window.innerHeight - 280, event.clientY - dragOffset.y));
      setCommandPalettePosition({ x: nextX, y: nextY });
    }

    function handleMouseUp() {
      setIsCommandDragging(false);
      setCommandDragOffset(null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [commandDragOffset, isCommandDragging]);

  useEffect(() => {
    setCommandSelectedIndex(0);
  }, [commandInput, isCommandPaletteOpen]);

  useEffect(() => {
    if (!canvasDocument) {
      return;
    }

    const validNodeIds = new Set(canvasDocument.nodes.map((node) => node.id));
    setPinnedCanvasNodeIds((current) => current.filter((nodeId) => validNodeIds.has(nodeId)));
    setOpenCanvasNodeIds((current) => current.filter((nodeId) => validNodeIds.has(nodeId)));
    setOpenTabs((current) =>
      current.filter((tab) => {
        if (tab.type === "view") {
          return true;
        }
        if (tab.type === "note") {
          return validNodeIds.has(tab.nodeId);
        }
        return true;
      }),
    );
    setNotesExploration((current) => normalizeExplorationSession(current, validNodeIds));
    setExplorationTabs((current) => {
      const nextEntries = Object.entries(current)
        .map(([id, session]) => [id, normalizeExplorationSession(session, validNodeIds)] as const)
        .filter((entry): entry is readonly [string, ExplorationSession] => Boolean(entry[1]));
      return Object.fromEntries(nextEntries);
    });

    if (selectedCanvasNodeId && !validNodeIds.has(selectedCanvasNodeId)) {
      const fallbackNodeId = canvasDocument.nodes[0]?.id ?? null;
      setSelectedCanvasNodeId(fallbackNodeId);
      setSelectedCanvasNodeIds(fallbackNodeId ? [fallbackNodeId] : []);
      if (fallbackNodeId) {
        setOpenCanvasNodeIds((current) =>
          current.includes(fallbackNodeId) ? current : [fallbackNodeId, ...current],
        );
      }
    }
  }, [canvasDocument, selectedCanvasNodeId]);

  useEffect(() => {
    if (
      !canvasDocument ||
      activeTab?.type !== "view" ||
      activeTab.view !== "notes"
    ) {
      return;
    }

    if (selectedCanvasNodeIds.length !== 1) {
      setNotesExploration((current) => (current ? null : current));
      return;
    }

    const nextNodeId = selectedCanvasNodeIds[0];
    if (!canvasDocument.nodes.some((node) => node.id === nextNodeId)) {
      return;
    }

    setNotesExploration((current) => {
      if (!current) {
        return createExplorationSession(nextNodeId);
      }
      return advanceExplorationSession(current, nextNodeId);
    });
  }, [activeTab, canvasDocument, selectedCanvasNodeIds]);

  useEffect(() => {
    if (status?.index_job.status === "completed") {
      startStructureTransition(() => {
        void refreshStructure();
      });
    }
  }, [status?.index_job.status, startStructureTransition]);

  useEffect(() => {
    if (status?.index_job.status !== "running") {
      return;
    }
    const timer = window.setTimeout(() => {
      startStatusTransition(() => {
        void refreshStatus();
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [status, startStatusTransition]);

  async function refreshStatus() {
    try {
      setErrorMessage(null);
      const nextStatus = await fetchStatus();
      setStatus(nextStatus);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function refreshProject() {
    try {
      setErrorMessage(null);
      const response = await fetchProject();
      setProject(response.project);
      if (response.project.repo_path) {
        void refreshCommitStatus(response.project.repo_path);
      } else {
        setCommitStatus(null);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function refreshProjectsTree() {
    try {
      setErrorMessage(null);
      const response = await fetchProjectsTree();
      setProjectsTree(response.projects);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function refreshWorkspaceStatus(nextRepoPath: string) {
    try {
      const targetRepoPath = nextRepoPath.trim();
      if (!targetRepoPath) {
        setWorkspaceStatus(null);
        return;
      }
      const response = await fetchProjectWorkspaceStatus(targetRepoPath);
      if (expectedRepoPathRef.current && expectedRepoPathRef.current !== targetRepoPath) {
        return;
      }
      setWorkspaceStatus(response);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function refreshAgentsDocument(nextRepoPath?: string) {
    try {
      setErrorMessage(null);
      const targetRepoPath = (nextRepoPath ?? activeRepoPath).trim();
      const response = await fetchProjectAgents(targetRepoPath || undefined);
      if (targetRepoPath && expectedRepoPathRef.current && expectedRepoPathRef.current !== targetRepoPath) {
        return;
      }
      setAgentsDocument(response);
      setAgentsContent(response.content);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function loadConversation(repoPath: string, conversation: ConversationSummary) {
    const resolvedRepoPath = repoPath.trim();
    setActiveConversationRepoPath(resolvedRepoPath);
    setActiveConversationId(conversation.id);

    if (conversation.placeholder || conversation.id === "default") {
      setConsoleMessages([]);
      setPendingPlan(null);
      setComposerStatus(`Ready in ${PathLabel(resolvedRepoPath)}.`);
      return;
    }

    try {
      setErrorMessage(null);
      const response = await fetchProjectConversation(resolvedRepoPath, conversation.id);
      if (expectedRepoPathRef.current && expectedRepoPathRef.current !== resolvedRepoPath) {
        return;
      }
      setConsoleMessages(response.conversation.messages);
      setPendingPlan(null);
      setComposerStatus(`Opened ${response.conversation.title}.`);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function createConversationForProject(
    nextRepoPath: string,
    title = "New conversation",
    options?: { preserveActiveView?: boolean },
  ) {
    try {
      setErrorMessage(null);
      const response = await createProjectConversation(nextRepoPath, title);
      setActiveConversationRepoPath(response.repo_path);
      setActiveConversationId(response.conversation.id);
      setConsoleMessages(response.conversation.messages);
      setPendingPlan(null);
      setComposerStatus(`Created ${response.conversation.title}.`);
      await refreshProjectsTree();
      if (!options?.preserveActiveView) {
        openViewTab("notes");
      }
      return response.conversation.id;
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      return null;
    }
  }

  async function persistConversationMessages(
    nextRepoPath: string,
    conversationId: string,
    messages: ConversationMessage[],
  ) {
    try {
      const response = await updateProjectConversation(nextRepoPath, conversationId, {
        messages,
      });
      setActiveConversationRepoPath(response.repo_path);
      setActiveConversationId(response.conversation.id);
      setConsoleMessages(response.conversation.messages);
      await refreshProjectsTree();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function refreshCanvas(nextRepoPath?: string) {
    try {
      setErrorMessage(null);
      const targetRepoPath = (nextRepoPath ?? activeRepoPath).trim() || undefined;
      const response = await fetchCanvas(targetRepoPath);
      if (targetRepoPath && expectedRepoPathRef.current && expectedRepoPathRef.current !== targetRepoPath) {
        return;
      }
      setCanvasDocument(response.document);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleGenerateCanvas() {
    const targetRepoPath = activeRepoPath;
    if (!targetRepoPath) {
      return;
    }

    startCanvasTransition(() => {
      void (async () => {
        try {
          setIsGeneratingCanvas(true);
          setErrorMessage(null);
          setComposerStatus("Generating project canvas...");
          const response = await generateCanvasFromPrompt(
            targetRepoPath,
            buildCanvasSetupPrompt(targetRepoPath, workspaceStatus?.visible_file_count ?? 0),
          );
          setCanvasDocument(response.document);
          setComposerStatus(response.summary?.trim() ? response.summary : "Canvas ready.");
          await Promise.all([
            refreshCanvas(targetRepoPath),
            refreshWorkspaceStatus(targetRepoPath),
          ]);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
          setComposerStatus("Canvas generation failed.");
        } finally {
          setIsGeneratingCanvas(false);
        }
      })();
    });
  }

  async function refreshCommitStatus(nextRepoPath?: string) {
    const targetRepoPath = (nextRepoPath ?? activeRepoPath).trim();
    if (!targetRepoPath) {
      setCommitStatus(null);
      return;
    }
    try {
      const response = await fetchCommitStatus(targetRepoPath);
      if (expectedRepoPathRef.current && expectedRepoPathRef.current !== targetRepoPath) {
        return;
      }
      setCommitStatus(response);
    } catch (error) {
      setCommitStatus(null);
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function refreshStructure() {
    try {
      setErrorMessage(null);
      const response = await fetchStructure();
      setStructure(response.root);
      setSelectedTreeNode(response.root);
      setExpandedTreeNodeIds(new Set([response.root.id]));
      setStructureRelationships([]);
    } catch (error) {
      setStructure(null);
      setSelectedTreeNode(null);
      setStructureRelationships([]);
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function submitQuery(input: string, mode: QueryMode) {
    try {
      setErrorMessage(null);
      const response = await runQuery(input, mode);
      setQueryResults(response.results);
      setSelectedSymbol(null);
      setRelationships([]);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleSubmitQuery() {
    startQueryTransition(() => {
      void submitQuery(queryInput, queryMode);
    });
  }

  async function submitImpact(prompt: string) {
    try {
      setErrorMessage(null);
      const response = await runImpactAnalysis(prompt);
      setImpactResult(response);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleSubmitImpact() {
    startImpactTransition(() => {
      void submitImpact(impactPrompt);
    });
  }

  async function submitBuildPrompt(
    promptValue = codexPrompt.trim(),
    options?: { preserveActiveView?: boolean },
  ) {
    const prompt = promptValue.trim();
    if (!prompt) {
      return;
    }

    const userMessage: ConversationMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt,
      created_at: new Date().toISOString(),
    };
    const pendingMessages = [...consoleMessages, userMessage];
    setConsoleMessages(pendingMessages);
    setIsBuilding(true);
    if (promptValue === codexPrompt.trim()) {
      setCodexPrompt("");
    }
    setPendingPlan(null);
    let ensuredConversationId: string | null = null;
    try {
      setErrorMessage(null);
      setComposerStatus("Building the project and refreshing notes...");
      ensuredConversationId =
        activeConversationId && activeConversationRepoPath === activeRepoPath && activeConversationId !== "default"
          ? activeConversationId
          : await createConversationForProject(activeRepoPath, deriveConversationTitle(prompt), options);
      if (!ensuredConversationId) {
        setIsBuilding(false);
        return;
      }
      await persistConversationMessages(activeRepoPath, ensuredConversationId, pendingMessages);
      let assistantContent = "";
      const assistantId = `assistant-${Date.now()}`;
      setConsoleMessages([
        ...pendingMessages,
        {
          id: assistantId,
          role: "assistant",
          title: "Building...",
          content: "",
          created_at: new Date().toISOString(),
        },
      ]);

      let finalSummary = "Build complete.";
      await streamProjectRun(
        activeRepoPath,
        "build",
        prompt,
        buildSelectedNoteContext(canvasDocument, visibleContextNodeIds),
        buildConversationContext(pendingMessages),
        (event) => {
          handleProjectRunEvent(event, {
            assistantId,
            onChunk: (text) => {
              assistantContent += text;
              setConsoleMessages((current) =>
                current.map((message) =>
                  message.id === assistantId ? { ...message, content: assistantContent } : message,
                ),
              );
            },
            onCompleted: (completedEvent) => {
              finalSummary = completedEvent.summary ?? finalSummary;
              if (completedEvent.document) {
                setCanvasDocument(completedEvent.document);
              }
              setComposerStatus(finalSummary);
              setConsoleMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        title: completedEvent.summary ?? "Build complete.",
                        content:
                          assistantContent ||
                          [
                            completedEvent.code_summary,
                            completedEvent.note_summary,
                            completedEvent.note_changes_summary
                              ? `Notes changes summary:\n${completedEvent.note_changes_summary}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join("\n\n"),
                      }
                    : message,
                ),
              );
            },
          });
        },
      );

      const nextMessages = [
        ...pendingMessages,
        {
          id: assistantId,
          role: "assistant" as const,
          title: finalSummary,
          content: assistantContent,
          created_at: new Date().toISOString(),
        },
      ];
      setConsoleMessages(nextMessages);
      await persistConversationMessages(activeRepoPath, ensuredConversationId, nextMessages);
      await refreshCommitStatus(activeRepoPath);
    } catch (error) {
      setComposerStatus("Build failed.");
      setErrorMessage(getErrorMessage(error));
      const nextMessages = [
        ...pendingMessages,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant" as const,
          title: "Build failed.",
          content: getErrorMessage(error),
          created_at: new Date().toISOString(),
        },
      ];
      setConsoleMessages(nextMessages);
      if (ensuredConversationId) {
        await persistConversationMessages(activeRepoPath, ensuredConversationId, nextMessages);
      }
    } finally {
      setIsBuilding(false);
    }
  }

  async function handleSubmitArchitecturePrompt() {
    startCodexTransition(() => {
      void (isPlanMode ? submitPlanPrompt() : submitBuildPrompt());
    });
  }

  async function submitPlanPrompt(
    promptValue = codexPrompt.trim(),
    options?: { preserveActiveView?: boolean },
  ) {
    const prompt = promptValue.trim();
    if (!prompt) {
      return;
    }

    const userMessage: ConversationMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt,
      created_at: new Date().toISOString(),
    };
    const pendingMessages = [...consoleMessages, userMessage];
    setConsoleMessages(pendingMessages);
    if (promptValue === codexPrompt.trim()) {
      setCodexPrompt("");
    }
    setIsPlanning(true);
    if (promptValue === codexPrompt.trim()) {
      setIsConsoleExpanded(true);
    }
    let ensuredConversationId: string | null = null;

    try {
      setErrorMessage(null);
      setComposerStatus("Preparing implementation plan...");
      ensuredConversationId =
        activeConversationId && activeConversationRepoPath === activeRepoPath && activeConversationId !== "default"
          ? activeConversationId
          : await createConversationForProject(activeRepoPath, deriveConversationTitle(prompt), options);
      if (!ensuredConversationId) {
        setIsPlanning(false);
        return;
      }
      await persistConversationMessages(activeRepoPath, ensuredConversationId, pendingMessages);

      let assistantContent = "";
      const assistantId = `assistant-plan-${Date.now()}`;
      setConsoleMessages([
        ...pendingMessages,
        {
          id: assistantId,
          role: "assistant",
          title: "Planning...",
          content: "",
          created_at: new Date().toISOString(),
        },
      ]);
      let finalSummary = "Plan ready.";
      await streamProjectRun(
        activeRepoPath,
        "plan",
        prompt,
        buildSelectedNoteContext(canvasDocument, visibleContextNodeIds),
        buildConversationContext(pendingMessages),
        (event) => {
          handleProjectRunEvent(event, {
            assistantId,
            onChunk: (text) => {
              assistantContent += text;
              setConsoleMessages((current) =>
                current.map((message) =>
                  message.id === assistantId ? { ...message, content: assistantContent } : message,
                ),
              );
            },
            onCompleted: (completedEvent) => {
              finalSummary = completedEvent.summary ?? finalSummary;
              setPendingPlan({
                messageId: assistantId,
                prompt,
                planText: completedEvent.plan_text ?? assistantContent,
                summary: finalSummary,
              });
              setComposerStatus("Plan ready.");
              setConsoleMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, title: finalSummary, content: completedEvent.plan_text ?? assistantContent }
                    : message,
                ),
              );
            },
          });
        },
      );
      const nextMessages = [
        ...pendingMessages,
        {
          id: assistantId,
          role: "assistant" as const,
          title: finalSummary,
          content: assistantContent,
          created_at: new Date().toISOString(),
        },
      ];
      setConsoleMessages(nextMessages);
      await persistConversationMessages(activeRepoPath, ensuredConversationId, nextMessages);
    } catch (error) {
      setComposerStatus("Plan failed.");
      setErrorMessage(getErrorMessage(error));
      const nextMessages = [
        ...pendingMessages,
        {
          id: `assistant-plan-error-${Date.now()}`,
          role: "assistant" as const,
          title: "Plan failed.",
          content: getErrorMessage(error),
          created_at: new Date().toISOString(),
        },
      ];
      setConsoleMessages(nextMessages);
      if (ensuredConversationId) {
        await persistConversationMessages(activeRepoPath, ensuredConversationId, nextMessages);
      }
    } finally {
      setIsPlanning(false);
    }
  }

  async function submitAskPrompt(promptValue: string, options?: { preserveActiveView?: boolean }) {
    const prompt = promptValue.trim();
    if (!prompt || !activeRepoPath) {
      return;
    }

    const userMessage: ConversationMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt,
      created_at: new Date().toISOString(),
    };
    const pendingMessages = [...consoleMessages, userMessage];
    setConsoleMessages(pendingMessages);
    setComposerStatus("Answering your question...");
    let ensuredConversationId: string | null = null;

    try {
      setErrorMessage(null);
      ensuredConversationId =
        activeConversationId && activeConversationRepoPath === activeRepoPath && activeConversationId !== "default"
          ? activeConversationId
          : await createConversationForProject(activeRepoPath, deriveConversationTitle(prompt), options);
      if (!ensuredConversationId) {
        return;
      }
      await persistConversationMessages(activeRepoPath, ensuredConversationId, pendingMessages);
      let assistantContent = "";
      const assistantId = `assistant-ask-${Date.now()}`;
      setConsoleMessages([
        ...pendingMessages,
        {
          id: assistantId,
          role: "assistant",
          title: "Answering...",
          content: "",
          created_at: new Date().toISOString(),
        },
      ]);
      let finalSummary = "Answer ready.";
      await streamProjectRun(
        activeRepoPath,
        "ask",
        prompt,
        buildSelectedNoteContext(canvasDocument, visibleContextNodeIds),
        buildConversationContext(pendingMessages),
        (event) => {
          handleProjectRunEvent(event, {
            assistantId,
            onChunk: (text) => {
              assistantContent += text;
              setConsoleMessages((current) =>
                current.map((message) =>
                  message.id === assistantId ? { ...message, content: assistantContent } : message,
                ),
              );
            },
            onCompleted: (completedEvent) => {
              finalSummary = completedEvent.summary ?? finalSummary;
              setComposerStatus(finalSummary);
              setConsoleMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, title: finalSummary, content: completedEvent.answer_text ?? assistantContent }
                    : message,
                ),
              );
            },
          });
        },
      );
      const nextMessages = [
        ...pendingMessages,
        {
          id: assistantId,
          role: "assistant" as const,
          title: finalSummary,
          content: assistantContent,
          created_at: new Date().toISOString(),
        },
      ];
      setConsoleMessages(nextMessages);
      await persistConversationMessages(activeRepoPath, ensuredConversationId, nextMessages);
    } catch (error) {
      setComposerStatus("Question failed.");
      setErrorMessage(getErrorMessage(error));
      const nextMessages = [
        ...pendingMessages,
        {
          id: `assistant-ask-error-${Date.now()}`,
          role: "assistant" as const,
          title: "Question failed.",
          content: getErrorMessage(error),
          created_at: new Date().toISOString(),
        },
      ];
      setConsoleMessages(nextMessages);
      if (ensuredConversationId) {
        await persistConversationMessages(activeRepoPath, ensuredConversationId, nextMessages);
      }
    }
  }

  function handleApprovePlan() {
    if (!pendingPlan || isBuilding || !activeRepoPath) {
      return;
    }
    setIsPlanMode(false);
    setCodexPrompt("");
    startCodexTransition(() => {
      void submitApprovedPlan(pendingPlan);
    });
  }

  async function submitApprovedPlan(plan: NonNullable<typeof pendingPlan>) {
    const approvalMessage: ConversationMessage = {
      id: `user-approve-${Date.now()}`,
      role: "user",
      title: "Approved plan",
      content: "Approve and implement the current plan.",
      created_at: new Date().toISOString(),
    };
    const pendingMessages = [...consoleMessages, approvalMessage];
    setConsoleMessages(pendingMessages);
    setPendingPlan(null);
    setIsBuilding(true);
    let ensuredConversationId: string | null =
      activeConversationId && activeConversationRepoPath === activeRepoPath && activeConversationId !== "default"
        ? activeConversationId
        : null;

    try {
      setErrorMessage(null);
      setComposerStatus("Building the approved plan and refreshing notes...");
      if (!ensuredConversationId) {
        ensuredConversationId = await createConversationForProject(activeRepoPath, deriveConversationTitle(plan.prompt));
      }
      if (!ensuredConversationId) {
        setIsBuilding(false);
        return;
      }
      await persistConversationMessages(activeRepoPath, ensuredConversationId, pendingMessages);
      let assistantContent = "";
      const assistantId = `assistant-${Date.now()}`;
      setConsoleMessages([
        ...pendingMessages,
        {
          id: assistantId,
          role: "assistant",
          title: "Building...",
          content: "",
          created_at: new Date().toISOString(),
        },
      ]);
      let finalSummary = "Build complete.";
      await streamProjectRun(
        activeRepoPath,
        "build",
        [
          "Implement this approved plan.",
          `Original request:\n${plan.prompt}`,
          `Approved plan:\n${plan.planText}`,
        ].join("\n\n"),
        buildSelectedNoteContext(canvasDocument, visibleContextNodeIds),
        buildConversationContext(pendingMessages),
        (event) => {
          handleProjectRunEvent(event, {
            assistantId,
            onChunk: (text) => {
              assistantContent += text;
              setConsoleMessages((current) =>
                current.map((message) =>
                  message.id === assistantId ? { ...message, content: assistantContent } : message,
                ),
              );
            },
            onCompleted: (completedEvent) => {
              finalSummary = completedEvent.summary ?? finalSummary;
              if (completedEvent.document) {
                setCanvasDocument(completedEvent.document);
              }
              setComposerStatus(finalSummary);
              setConsoleMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        title: finalSummary,
                        content:
                          assistantContent ||
                          [
                            completedEvent.code_summary,
                            completedEvent.note_summary,
                            completedEvent.note_changes_summary
                              ? `Notes changes summary:\n${completedEvent.note_changes_summary}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join("\n\n"),
                      }
                    : message,
                ),
              );
            },
          });
        },
      );
      const nextMessages = [
        ...pendingMessages,
        {
          id: assistantId,
          role: "assistant" as const,
          title: finalSummary,
          content: assistantContent,
          created_at: new Date().toISOString(),
        },
      ];
      setConsoleMessages(nextMessages);
      await persistConversationMessages(activeRepoPath, ensuredConversationId, nextMessages);
      await refreshCommitStatus(activeRepoPath);
    } catch (error) {
      setComposerStatus("Build failed.");
      setErrorMessage(getErrorMessage(error));
      const nextMessages = [
        ...pendingMessages,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant" as const,
          title: "Build failed.",
          content: getErrorMessage(error),
          created_at: new Date().toISOString(),
        },
      ];
      setConsoleMessages(nextMessages);
      if (ensuredConversationId) {
        await persistConversationMessages(activeRepoPath, ensuredConversationId, nextMessages);
      }
    } finally {
      setIsBuilding(false);
    }
  }

  function handleCommitClick() {
    if (!activeRepoPath || !commitStatus?.has_changes || isCommitting) {
      return;
    }
    startCodexTransition(() => {
      void (async () => {
        try {
          setIsCommitting(true);
          setErrorMessage(null);
          setComposerStatus("Creating commit...");
          const response = await createProjectCommit(activeRepoPath, commitStatus.suggested_message ?? undefined);
          setComposerStatus(response.summary);
          await refreshCommitStatus(activeRepoPath);
          setConsoleMessages((current) => [
            ...current,
            {
              id: `assistant-commit-${Date.now()}`,
              role: "assistant",
              title: response.message,
              content: response.summary,
              created_at: new Date().toISOString(),
            },
          ]);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
          setComposerStatus("Commit failed.");
        } finally {
          setIsCommitting(false);
        }
      })();
    });
  }

  async function inspectSymbol(symbol: SymbolRecord) {
    const qualifiedName =
      typeof symbol.properties.qualified_name === "string"
        ? symbol.properties.qualified_name
        : null;
    if (!qualifiedName) {
      setSelectedSymbol(symbol);
      setRelationships([]);
      return;
    }

    startRelationshipsTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await fetchRelationships(qualifiedName);
          setSelectedSymbol(symbol);
          setRelationships(response.items);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  async function inspectTreeNode(node: StructureNode) {
    setSelectedTreeNode(node);
    const qualifiedName = node.qualified_name;
    if (!qualifiedName) {
      setStructureRelationships([]);
      return;
    }

    startRelationshipsTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await fetchRelationships(qualifiedName);
          setStructureRelationships(response.items);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  function toggleTreeNode(nodeId: string) {
    setExpandedTreeNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  function applySampleRepo(nextPath: string) {
    setRepoPath(nextPath);
    if (nextPath.includes("react-crud-app")) {
      setQueryInput("create user");
      setImpactPrompt("create user");
      setCodexPrompt("");
      return;
    }
    setQueryInput("user");
    setImpactPrompt("user");
    setCodexPrompt("");
  }

  async function openProjectConversation(repoPathToOpen: string, conversation?: ConversationSummary) {
    const normalizedRepoPath = repoPathToOpen.trim();
    if (!normalizedRepoPath) {
      return;
    }
    const isProjectSwitch = (project?.repo_path ?? "").trim() !== normalizedRepoPath;
    expectedRepoPathRef.current = normalizedRepoPath;

    try {
      setErrorMessage(null);
      if (isProjectSwitch) {
        const response = await updateProject({
          repo_path: normalizedRepoPath,
          name: "",
          recent_projects: [],
        });
        setProject(response.project);
        void refreshProjectsTree();
        setWorkspaceStatus(null);
        setCanvasDocument(null);
        setSelectedCanvasNodeId(null);
        setSelectedCanvasNodeIds([]);
        setNotesExploration(null);
        setExplorationTabs({});
        setOpenCanvasNodeIds([]);
        setOpenTabs((current) => current.filter((tab) => tab.type === "view"));
        setActiveTabId("view:notes");
        setComposerStatus(`Opened ${PathLabel(normalizedRepoPath)}.`);
      }
      setRepoPath(normalizedRepoPath);
      openViewTab("notes");
      if (conversation) {
        await loadConversation(normalizedRepoPath, conversation);
      } else {
        setActiveConversationRepoPath(normalizedRepoPath);
        setActiveConversationId(null);
        setConsoleMessages([]);
        setPendingPlan(null);
        setComposerStatus(`Opened ${PathLabel(normalizedRepoPath)}.`);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleSaveProject() {
    startProjectTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await updateProject({
            repo_path: repoPath.trim(),
            name: "",
            recent_projects: [],
          });
          setProject(response.project);
          void refreshProjectsTree();
          setWorkspaceStatus(null);
          setCanvasDocument(null);
          setSelectedCanvasNodeId(null);
          setSelectedCanvasNodeIds([]);
          setNotesExploration(null);
          setExplorationTabs({});
          setOpenCanvasNodeIds([]);
          setOpenTabs((current) => current.filter((tab) => tab.type === "view"));
          setActiveTabId("view:notes");
          setActiveConversationId(null);
          setActiveConversationRepoPath(response.project.repo_path || null);
          setConsoleMessages([]);
          openViewTab("notes");
          if (response.project.repo_path) {
            expectedRepoPathRef.current = response.project.repo_path;
          }
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  async function handleSaveAgentsDocument() {
    startAgentsTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await updateProjectAgents(agentsContent, activeRepoPath || undefined);
          setAgentsDocument(response);
          if (!project?.repo_path && response.repo_path) {
            const nextProject = await updateProject({ name: "", repo_path: response.repo_path, recent_projects: [] });
            setProject(nextProject.project);
          }
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  async function handleResetCanvas() {
    startCanvasTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const targetRepoPath = activeRepoPath;
          if (!targetRepoPath) {
            return;
          }
          const response = await resetCanvas(targetRepoPath);
          setCanvasDocument(response.document);
          setSelectedCanvasNodeId(null);
          setSelectedCanvasNodeIds([]);
          setNotesExploration(null);
          setExplorationTabs({});
          setOpenCanvasNodeIds([]);
          setOpenTabs((current) => current.filter((tab) => tab.type === "view"));
          setActiveTabId("view:notes");
          setComposerStatus("Canvas reset.");
          await Promise.all([
            refreshCanvas(targetRepoPath),
            refreshWorkspaceStatus(targetRepoPath),
          ]);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  function handleProjectRunEvent(
    event: ProjectRunStreamEvent,
    handlers: {
      assistantId: string;
      onChunk: (text: string) => void;
      onCompleted: (event: ProjectRunStreamEvent) => void;
    },
  ) {
    if (event.type === "phase") {
      if (event.label) {
        setComposerStatus(event.label);
      }
      return;
    }

    if (event.type === "assistant.chunk") {
      if (event.text) {
        handlers.onChunk(event.text);
      }
      return;
    }

    if (event.type === "completed") {
      handlers.onCompleted(event);
      return;
    }

    if (event.type === "error") {
      throw new Error(event.message || "Run failed.");
    }
  }

  function pinCanvasNode(nodeId: string) {
    setPinnedCanvasNodeIds((current) => (current.includes(nodeId) ? current : [...current, nodeId]));
    const title = canvasDocument?.nodes.find((node) => node.id === nodeId)?.title ?? "note";
    setComposerStatus(`Pinned ${title}.`);
  }

  function unpinCanvasNode(nodeId: string) {
    setPinnedCanvasNodeIds((current) => current.filter((item) => item !== nodeId));
  }

  function clearPinnedCanvasNodes() {
    setPinnedCanvasNodeIds([]);
    setComposerStatus("Cleared pinned context.");
  }

  function openCanvasNode(nodeId: string) {
    setSelectedCanvasNodeId((current) => (current === nodeId ? current : nodeId));
    setSelectedCanvasNodeIds((current) =>
      current.length === 1 && current[0] === nodeId ? current : [nodeId],
    );
    setOpenCanvasNodeIds((current) => (current.includes(nodeId) ? current : [...current, nodeId]));
    setOpenTabs((current) =>
      current.some((tab) => tab.id === `note:${nodeId}`)
        ? current
        : [...current, { id: `note:${nodeId}`, type: "note", nodeId }],
    );
    setActiveTabId(`note:${nodeId}`);
  }

  function promoteNotesExplorationToTab() {
    if (!notesExploration || !canvasDocument) {
      return;
    }

    const promotedSession = {
      ...notesExploration,
      id: `saved-${Date.now()}`,
      pathNodeIds: [...notesExploration.pathNodeIds],
    };

    setExplorationTabs((current) => ({
      ...current,
      [promotedSession.id]: promotedSession,
    }));
    setOpenTabs((current) =>
      current.some((tab) => tab.id === `explore:${promotedSession.id}`)
        ? current
        : [...current, { id: `explore:${promotedSession.id}`, type: "exploration", explorationId: promotedSession.id }],
    );
    setActiveTabId(`explore:${promotedSession.id}`);
    setComposerStatus(`Opened an exploration tab for ${findCanvasNodeTitle(canvasDocument, promotedSession.rootNodeId)}.`);
  }

  function handleExplorationSelection(
    session: ExplorationSession,
    nodeIds: string[],
    options?: { persistent?: boolean },
  ) {
    if (nodeIds.length === 0) {
      if (options?.persistent) {
        return;
      }
      setNotesExploration(null);
      setSelectedCanvasNodeId(null);
      setSelectedCanvasNodeIds([]);
      return;
    }

    if (nodeIds.length !== 1) {
      return;
    }

    const nextNodeId = nodeIds[0];
    const nextSession = advanceExplorationSession(session, nextNodeId);
    setSelectedCanvasNodeId((current) => (current === nextNodeId ? current : nextNodeId));
    setSelectedCanvasNodeIds((current) =>
      current.length === 1 && current[0] === nextNodeId ? current : [nextNodeId],
    );

    if (options?.persistent) {
      setExplorationTabs((current) => ({
        ...current,
        [session.id]: nextSession,
      }));
    } else {
      setNotesExploration(nextSession);
    }
  }

  function handleExplorationRelationQueryChange(
    sessionId: string,
    value: string,
    options?: { persistent?: boolean },
  ) {
    if (options?.persistent) {
      setExplorationTabs((current) => {
        const session = current[sessionId];
        if (!session) {
          return current;
        }
        return {
          ...current,
          [sessionId]: { ...session, relationQuery: value },
        };
      });
      return;
    }

    setNotesExploration((current) => (current && current.id === sessionId ? { ...current, relationQuery: value } : current));
  }

  function clearExplorationRelationQuery(sessionId: string, options?: { persistent?: boolean }) {
    handleExplorationRelationQueryChange(sessionId, "", options);
  }

  function openChatViewTab() {
    openViewTab("chat");
    setIsCommandPaletteOpen(false);
  }

  function returnChatToFloatingContainer() {
    setIsCommandPaletteOpen(true);
    setCommandPaletteMode("chat");
    closeTab("view:chat");
  }

  function handleCloseCanvasTab(nodeId: string) {
    setOpenCanvasNodeIds((current) => {
      const next = current.filter((item) => item !== nodeId);
      if (selectedCanvasNodeId === nodeId) {
        setSelectedCanvasNodeId(next.at(-1) ?? null);
        setSelectedCanvasNodeIds(next.at(-1) ? [next.at(-1) as string] : []);
      }
      return next;
    });
    setOpenTabs((current) => {
      const next = current.filter((item) => item.id !== `note:${nodeId}`);
      if (activeTabId === `note:${nodeId}`) {
        setActiveTabId(next.at(-1)?.id ?? "view:notes");
      }
      return next;
    });
  }

  function openViewTab(view: WorkspaceView) {
    const id = `view:${view}` as const;
    if (view === "notes") {
      setOpenTabs((current) =>
        current.some((tab) => tab.id === id)
          ? current
          : [...current, { id, type: "view", view, preview: false }],
      );
      setActiveTabId(id);
      return;
    }

    setOpenTabs((current) => {
      const existingTab = current.find((tab) => tab.id === id);
      if (existingTab) {
        return current;
      }

      const previewIndex = current.findIndex(
        (tab) => tab.type === "view" && tab.view !== "notes" && tab.preview,
      );
      const nextTab: OpenTab = { id, type: "view", view, preview: true };

      if (previewIndex === -1) {
        return [...current, nextTab];
      }

      const next = [...current];
      next[previewIndex] = nextTab;
      return next;
    });
    setActiveTabId(id);
  }

  function handleSelectCanvasNodes(nodeIds: string[]) {
    const normalized = [...nodeIds].sort();
    setSelectedCanvasNodeIds((current) => {
      const currentNormalized = [...current].sort();
      if (
        currentNormalized.length === normalized.length &&
        currentNormalized.every((nodeId, index) => nodeId === normalized[index])
      ) {
        return current;
      }
      return nodeIds;
    });
    setSelectedCanvasNodeId((current) => {
      const nextPrimary = nodeIds[0] ?? null;
      return current === nextPrimary ? current : nextPrimary;
    });
  }

  const commandResults = useMemo<CommandResultItem[]>(() => {
    const trimmed = commandInput.trim();

    if (commandMode === "ask") {
      const question = trimmed.slice(1).trim();
      if (!question) {
        return [];
      }
      return [
        {
          id: "ask-current-context",
          title: `Ask AI: ${question}`,
          subtitle: visibleContextNodeIds.length
            ? `Uses ${visibleContextNodeIds.length} visible/pinned note context item${visibleContextNodeIds.length === 1 ? "" : "s"}`
            : "Uses the current project and visible screen context",
          group: "ask",
          run: () => {
            setCommandInput("");
            startCodexTransition(() => {
              void submitAskPrompt(question, { preserveActiveView: true });
            });
            setCommandPaletteMode("chat");
          },
        },
      ];
    }

    if (commandMode === "action") {
      const rawAction = trimmed.slice(1).trim();
      const loweredAction = rawAction.toLowerCase();
      const buildPrompt = loweredAction.startsWith("build ") ? rawAction.slice(6).trim() : "";
      const planPrompt = loweredAction.startsWith("plan ") ? rawAction.slice(5).trim() : "";

      if (buildPrompt) {
        return [
          {
            id: "execute-build",
            title: `Build: ${buildPrompt}`,
            subtitle: "Runs a real build/edit pass and refreshes notes afterward",
            group: "execute",
            run: () => {
              setCommandInput("");
              setIsCommandPaletteOpen(true);
              setCommandPaletteMode("chat");
              startCodexTransition(() => {
                void submitBuildPrompt(buildPrompt, { preserveActiveView: true });
              });
            },
          },
        ];
      }

      if (planPrompt) {
        return [
          {
            id: "execute-plan",
            title: `Plan: ${planPrompt}`,
            subtitle: "Creates an implementation plan in the current conversation",
            group: "execute",
            run: () => {
              setCommandInput("");
              setIsCommandPaletteOpen(true);
              setCommandPaletteMode("chat");
              startCodexTransition(() => {
                void submitPlanPrompt(planPrompt, { preserveActiveView: true });
              });
            },
          },
        ];
      }

      const currentNode = canvasDocument?.nodes.find((node) => node.id === focusedCanvasNodeId) ?? null;
      const actionItems: Array<CommandResultItem & { keywords: string[]; enabled?: boolean }> = [
        {
          id: "action-create-note",
          title: "Create note",
          subtitle: "Adds a new note to the current canvas",
          group: "action",
          keywords: ["create", "note", "new"],
          enabled: !!activeRepoPath,
          run: () => {
            setCommandInput("");
            setIsCommandPaletteOpen(false);
            startCanvasTransition(() => {
              void handleCreateCanvasNodeAt();
            });
          },
        },
        {
          id: "action-setup-canvas",
          title: canvasDocument?.nodes.length ? "Regenerate canvas" : "Set up canvas",
          subtitle: "Maps the current project into notes on the canvas",
          group: "action",
          keywords: ["canvas", "map", "generate", "setup", "regenerate"],
          enabled: !!activeRepoPath,
          run: () => {
            setCommandInput("");
            startCanvasTransition(() => {
              void handleGenerateCanvas();
            });
          },
        },
        {
          id: "action-reset-canvas",
          title: "Reset canvas",
          subtitle: "Clears all notes for the current project",
          group: "action",
          keywords: ["canvas", "reset", "clear"],
          enabled: !!activeRepoPath,
          run: () => {
            setCommandInput("");
            startCanvasTransition(() => {
              void handleResetCanvas();
            });
          },
        },
        {
          id: "action-commit",
          title: "Commit changes",
          subtitle: commitStatus?.suggested_message ?? "Create a git commit for the current repo",
          group: "action",
          keywords: ["commit", "git", "save"],
          enabled: !!activeRepoPath && !!commitStatus?.has_changes,
          run: () => {
            setCommandInput("");
            handleCommitClick();
          },
        },
        {
          id: "action-new-conversation",
          title: "New conversation",
          subtitle: "Starts a new project conversation",
          group: "action",
          keywords: ["conversation", "chat", "new"],
          enabled: !!activeRepoPath,
          run: () => {
            setCommandInput("");
            startProjectTransition(() => {
              void createConversationForProject(activeRepoPath);
            });
          },
        },
        {
          id: "action-open-chat-page",
          title: "Open chat page",
          subtitle: "Turns the current conversation into a regular workspace tab",
          group: "action",
          keywords: ["chat", "page", "open", "conversation", "tab"],
          enabled: true,
          run: () => {
            setCommandInput("");
          openChatViewTab();
        },
      },
        {
          id: "action-open-notes",
          title: "Open Notes",
          subtitle: "Switches to the Notes workspace",
          group: "action",
          keywords: ["open", "notes", "view"],
          enabled: true,
          run: () => {
            setCommandInput("");
            setIsCommandPaletteOpen(false);
            openViewTab("notes");
          },
        },
        {
          id: "action-open-inspect",
          title: "Open Inspect",
          subtitle: "Switches to the Inspect workspace",
          group: "action",
          keywords: ["open", "inspect", "view"],
          enabled: true,
          run: () => {
            setCommandInput("");
            setIsCommandPaletteOpen(false);
            openViewTab("inspect");
          },
        },
        {
          id: "action-open-project",
          title: "Open Project",
          subtitle: "Switches to the Project workspace",
          group: "action",
          keywords: ["open", "project", "view", "settings"],
          enabled: true,
          run: () => {
            setCommandInput("");
            setIsCommandPaletteOpen(false);
            openViewTab("project");
          },
        },
      ];

      if (currentNode && !pinnedCanvasNodeIds.includes(currentNode.id)) {
        actionItems.push({
          id: "action-pin-current-note",
          title: `Pin ${currentNode.title}`,
          subtitle: "Keeps this note in context while you move around the project",
          group: "action",
          keywords: ["pin", "current", "note", currentNode.title.toLowerCase()],
          enabled: true,
          run: () => {
            setCommandInput("");
            pinCanvasNode(currentNode.id);
          },
        });
      }

      if (currentNode && pinnedCanvasNodeIds.includes(currentNode.id)) {
        actionItems.push({
          id: "action-unpin-current-note",
          title: `Unpin ${currentNode.title}`,
          subtitle: "Removes this note from persistent context",
          group: "action",
          keywords: ["unpin", "current", "note", currentNode.title.toLowerCase()],
          enabled: true,
          run: () => {
            setCommandInput("");
            unpinCanvasNode(currentNode.id);
          },
        });
      }

      if (pinnedCanvasNodeIds.length > 0) {
        actionItems.push({
          id: "action-clear-pinned",
          title: "Clear pinned context",
          subtitle: `Removes ${pinnedCanvasNodeIds.length} pinned note${pinnedCanvasNodeIds.length === 1 ? "" : "s"}`,
          group: "action",
          keywords: ["clear", "pinned", "context", "unpin"],
          enabled: true,
          run: () => {
            setCommandInput("");
            clearPinnedCanvasNodes();
          },
        });
      }

      return actionItems
        .filter((item) => item.enabled !== false)
        .filter((item) => {
          if (!rawAction) {
            return true;
          }
          const haystack = [item.title, item.subtitle ?? "", ...item.keywords].join(" ").toLowerCase();
          return haystack.includes(loweredAction);
        });
    }

    const query = trimmed.toLowerCase();
    const noteItems = (canvasDocument?.nodes ?? [])
      .filter((node) => {
        if (!query) {
          return true;
        }
        const haystack = [node.title, node.description, node.tags.join(" ")].join(" ").toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 8)
      .map<CommandResultItem>((node) => ({
        id: `note:${node.id}`,
        title: node.title,
        subtitle: node.tags.join(", ") || "note",
        group: "navigate",
        run: () => {
          setCommandInput("");
          setIsCommandPaletteOpen(false);
          openCanvasNode(node.id);
        },
      }));

    const projectItems = projectsTree
      .filter((item) => {
        if (!query) {
          return true;
        }
        return [item.name, item.repo_path].join(" ").toLowerCase().includes(query);
      })
      .slice(0, 6)
      .map<CommandResultItem>((item) => ({
        id: `project:${item.repo_path}`,
        title: item.name,
        subtitle: item.repo_path,
        group: "navigate",
        run: () => {
          setCommandInput("");
          setIsCommandPaletteOpen(false);
          startProjectTransition(() => {
            void openProjectConversation(item.repo_path);
          });
        },
      }));

    const conversationItems = projectsTree
      .flatMap((item) =>
        item.conversations.map((conversation) => ({
          projectName: item.name,
          repoPath: item.repo_path,
          conversation,
        })),
      )
      .filter((item) => {
        if (!query) {
          return false;
        }
        return [item.conversation.title, item.projectName, item.repoPath].join(" ").toLowerCase().includes(query);
      })
      .slice(0, 8)
      .map<CommandResultItem>((item) => ({
        id: `conversation:${item.repoPath}:${item.conversation.id}`,
        title: item.conversation.title,
        subtitle: `${item.projectName} · ${item.conversation.message_count} msg${item.conversation.message_count === 1 ? "" : "s"}`,
        group: "navigate",
        run: () => {
          setCommandInput("");
          setIsCommandPaletteOpen(false);
          startProjectTransition(() => {
            void openProjectConversation(item.repoPath, item.conversation);
          });
        },
      }));

    const viewItems = (["notes", "inspect", "project", "chat"] as WorkspaceView[])
      .filter((view) => !query || viewLabel(view).toLowerCase().includes(query))
      .map<CommandResultItem>((view) => ({
        id: `view:${view}`,
        title: viewLabel(view),
        subtitle: "workspace view",
        group: "navigate",
        run: () => {
          setCommandInput("");
          setIsCommandPaletteOpen(false);
          openViewTab(view);
        },
      }));

    return [...noteItems, ...projectItems, ...conversationItems, ...viewItems].slice(0, 14);
  }, [
    activeRepoPath,
    canvasDocument,
    commandInput,
    commandMode,
    commitStatus,
    focusedCanvasNodeId,
    pinnedCanvasNodeIds,
    projectsTree,
    visibleContextNodeIds,
  ]);

  function pinPreviewTab(tabId: OpenTab["id"]) {
    setOpenTabs((current) =>
      current.map((tab) => {
        if (tab.id !== tabId || tab.type !== "view" || !tab.preview) {
          return tab;
        }
        return { ...tab, preview: false };
      }),
    );
  }

  function handleSelectTab(tab: OpenTab) {
    if (tab.type === "view" && tab.preview && activeTabId === tab.id) {
      pinPreviewTab(tab.id);
    }
    if (tab.type === "note") {
      setSelectedCanvasNodeId((current) => (current === tab.nodeId ? current : tab.nodeId));
      setSelectedCanvasNodeIds((current) =>
        current.length === 1 && current[0] === tab.nodeId ? current : [tab.nodeId],
      );
    }
    if (tab.type === "exploration") {
      const session = explorationTabs[tab.explorationId] ?? null;
      const activeNodeId = session?.activeNodeId ?? null;
      setSelectedCanvasNodeId((current) => (current === activeNodeId ? current : activeNodeId));
      setSelectedCanvasNodeIds((current) =>
        activeNodeId && current.length === 1 && current[0] === activeNodeId ? current : activeNodeId ? [activeNodeId] : [],
      );
    }
    setActiveTabId(tab.id);
  }

  function closeTab(tabId: OpenTab["id"]) {
    if (tabId === "view:notes") {
      return;
    }
    const tab = openTabs.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }
    if (tab.type === "note") {
      handleCloseCanvasTab(tab.nodeId);
      return;
    }
    if (tab.type === "exploration") {
      setExplorationTabs((current) => {
        const next = { ...current };
        delete next[tab.explorationId];
        return next;
      });
    }
    setOpenTabs((current) => {
      const next = current.filter((item) => item.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(next.at(-1)?.id ?? "view:notes");
      }
      return next;
    });
  }

  async function handlePersistCanvasNodePosition(nodeId: string, x: number, y: number) {
    try {
      const response = await updateCanvasNode(nodeId, { x, y });
      setCanvasDocument(response.document);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleCreateCanvasNodeAt(x = 96, y = 96) {
    startCanvasTransition(() => {
      void (async () => {
        try {
          const response = await createCanvasNode({
            title: buildNewCanvasNodeTitle(selectedSymbol, selectedTreeNode),
            description: buildNewCanvasNodeDescription(selectedSymbol, selectedTreeNode),
            tags: buildNewCanvasNodeTags(selectedSymbol, selectedTreeNode),
            x,
            y,
            linked_files: buildLinkedFiles(selectedSymbol, selectedTreeNode),
            linked_symbols: buildLinkedSymbols(selectedSymbol, selectedTreeNode),
          });
          setCanvasDocument(response.document);
          const createdNode = response.document.nodes.at(-1) ?? null;
          if (createdNode) {
            openCanvasNode(createdNode.id);
          }
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  async function handleDeleteCanvasNode(nodeId: string) {
    startCanvasTransition(() => {
      void (async () => {
        try {
          const response = await deleteCanvasNode(nodeId);
          setCanvasDocument(response.document);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  async function handleSaveCanvasNode() {
    if (!selectedCanvasNode) {
      return;
    }
    startCanvasTransition(() => {
      void (async () => {
        try {
          const response = await updateCanvasNode(selectedCanvasNode.id, {
            title: canvasDraftTitle.trim(),
            description: canvasDraftDescription,
            tags: parseTagList(canvasDraftTags),
            x: selectedCanvasNode.x,
            y: selectedCanvasNode.y,
            linked_files: parseLineList(canvasDraftFiles),
            linked_symbols: parseLineList(canvasDraftSymbols),
          });
          setCanvasDocument(response.document);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  function renderExplorationSurface(
    session: ExplorationSession,
    presentation: ExplorationPresentation,
    options?: { persistent?: boolean },
  ) {
    const isPersistent = options?.persistent ?? false;
    const activeNode = presentation.activeNode;
    const relationQuery = session.relationQuery;

    return (
      <div className={styles.explorationWorkspace}>
        <aside className={styles.explorationPanel}>
          <div className={styles.explorationPanelHeader}>
            <div>
              <strong className={styles.resultTitle}>{activeNode?.title ?? "Explore concept"}</strong>
              <p className={styles.resultMeta}>
                {isPersistent
                  ? "Saved exploration tab"
                  : "Transient exploration from the overview canvas"}
              </p>
            </div>
            <div className={styles.explorationHeaderActions}>
              {!isPersistent ? (
                <>
                  <button className={styles.secondaryButton} onClick={promoteNotesExplorationToTab} type="button">
                    Open as tab
                  </button>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => {
                      setNotesExploration(null);
                      setSelectedCanvasNodeId(null);
                      setSelectedCanvasNodeIds([]);
                    }}
                    type="button"
                  >
                    Back to overview
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div className={styles.explorationSection}>
            <span className={styles.fieldLabel}>Path</span>
            <div className={styles.explorationPath}>
              {presentation.pathNodes.map((node) => (
                <button
                  className={node.id === session.activeNodeId ? styles.explorationPathChipActive : styles.explorationPathChip}
                  key={node.id}
                  onClick={() => handleExplorationSelection(session, [node.id], { persistent: isPersistent })}
                  type="button"
                >
                  {node.title}
                </button>
              ))}
            </div>
          </div>

          {activeNode ? (
            <div className={styles.explorationSection}>
              <span className={styles.fieldLabel}>What this concept does</span>
              <p className={styles.explorationDescription}>{activeNode.description || "No description yet."}</p>
              <div className={styles.explorationMetaGrid}>
                <div>
                  <span className={styles.fieldLabel}>Tags</span>
                  <div className={styles.tagRow}>
                    {activeNode.tags.length === 0 ? <span className={styles.tagChip}>untagged</span> : null}
                    {activeNode.tags.map((tag) => (
                      <span className={styles.tagChip} key={tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <span className={styles.fieldLabel}>Grounded in</span>
                  <ul className={styles.explorationList}>
                    {activeNode.linked_files.length === 0 ? (
                      <li className={styles.helperText}>No linked files</li>
                    ) : (
                      activeNode.linked_files.slice(0, 6).map((file) => <li key={file}>{file}</li>)
                    )}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}

          <div className={styles.explorationSection}>
            <span className={styles.fieldLabel}>Suggested next concepts</span>
            <div className={styles.explorationSuggestionList}>
              {presentation.suggestedNodes.length === 0 ? (
                <p className={styles.helperText}>No strong next concepts from the current focus.</p>
              ) : (
                presentation.suggestedNodes.map((node) => (
                  <button
                    className={styles.explorationSuggestion}
                    key={node.id}
                    onClick={() => handleExplorationSelection(session, [node.id], { persistent: isPersistent })}
                    type="button"
                  >
                    <strong>{node.title}</strong>
                    <span>{summarizeNote(node.description)}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className={styles.explorationSection}>
            <div className={styles.explorationRelationHeader}>
              <span className={styles.fieldLabel}>Custom relation</span>
              {relationQuery ? (
                <button
                  className={styles.inlineLink}
                  onClick={() => clearExplorationRelationQuery(session.id, { persistent: isPersistent })}
                  type="button"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <input
              className={styles.input}
              onChange={(event) =>
                handleExplorationRelationQueryChange(session.id, event.target.value, { persistent: isPersistent })
              }
              placeholder="Show related state, workflow, persistence..."
              value={relationQuery}
            />
            {relationQuery ? (
              <div className={styles.explorationSuggestionList}>
                {presentation.customMatches.length === 0 ? (
                  <p className={styles.helperText}>No nearby concepts matched that relation yet.</p>
                ) : (
                  presentation.customMatches.map((node) => (
                    <button
                      className={styles.explorationSuggestion}
                      key={node.id}
                      onClick={() => handleExplorationSelection(session, [node.id], { persistent: isPersistent })}
                      type="button"
                    >
                      <strong>{node.title}</strong>
                      <span>{summarizeNote(node.description)}</span>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <p className={styles.helperText}>Type a relation or angle to surface a different branch of the architecture.</p>
            )}
          </div>
        </aside>

        <div className={styles.explorationCanvasStage}>
          <CanvasBoard
            document={presentation.displayDocument}
            edgeNodeIds={presentation.visibleNodeIds}
            onCreateNodeAt={(x, y) => {
              startCanvasTransition(() => {
                void handleCreateCanvasNodeAt(x, y);
              });
            }}
            onDeleteNode={handleDeleteCanvasNode}
            onMoveNodeEnd={(nodeId, x, y) => {
              startCanvasTransition(() => {
                void handlePersistCanvasNodePosition(nodeId, x, y);
              });
            }}
            onOpenNode={openCanvasNode}
            onPaneClick={
              isPersistent
                ? undefined
                : () => {
                    setNotesExploration(null);
                    setSelectedCanvasNodeId(null);
                    setSelectedCanvasNodeIds([]);
                  }
            }
            onSelectNode={(nodeId) => handleExplorationSelection(session, [nodeId], { persistent: isPersistent })}
            onSelectNodes={(nodeIds) => handleExplorationSelection(session, nodeIds, { persistent: isPersistent })}
            selectedNodeIds={session.activeNodeId ? [session.activeNodeId] : []}
          />
        </div>
      </div>
    );
  }

  function renderNotesView() {
    return (
      <div className={styles.notesWorkspace}>
        <div className={styles.notesConsoleShell}>
          <div className={styles.notesConsoleDock}>
            {isConsoleExpanded ? (
              <div className={styles.notesConsolePanel}>
                <div className={styles.notesConsoleMessages} ref={consoleMessagesRef}>
                  {consoleMessages.length === 0 ? (
                    <p className={styles.helperText}>Describe what to build. The console will show your prompt and the latest architectural summary from the run.</p>
                  ) : (
                    consoleMessages.map((message) => (
                      <article
                        className={message.role === "user" ? styles.consoleMessageUser : styles.consoleMessageAssistant}
                        key={message.id}
                      >
                        <span className={styles.consoleMessageRole}>{message.role === "user" ? "You" : "Konceptura"}</span>
                        {message.title ? <strong className={styles.consoleMessageTitle}>{message.title}</strong> : null}
                        <div className={styles.consoleMessageBody}>
                          {renderConsoleMessageContent(
                            message.content,
                            message.role === "assistant" ? canvasDocument : null,
                            openCanvasNode,
                          )}
                        </div>
                        {pendingPlan?.messageId === message.id ? (
                          <div className={styles.consoleMessageActions}>
                            <button
                              className={styles.secondaryButton}
                              disabled={isBuilding}
                              onClick={handleApprovePlan}
                              type="button"
                            >
                              Approve
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            <button
              className={isConsoleExpanded ? styles.notesConsoleBarExpanded : styles.notesConsoleBar}
              onClick={() => setIsConsoleExpanded((current) => !current)}
              type="button"
            >
              <span className={styles.notesConsoleBarLabel}>Console</span>
              <span className={styles.notesConsoleBarSummary}>{latestConsoleSummary}</span>
              <span className={styles.notesConsoleBarAction}>{isConsoleExpanded ? "Hide" : "Show"}</span>
            </button>

            <label className={styles.consoleComposer}>
              <textarea
                className={styles.consoleComposerInput}
                disabled={isBuilding || isPlanning}
                onChange={(event) => setCodexPrompt(event.target.value)}
                placeholder={isPlanMode ? "Describe what to plan in this project." : "Describe what to build in this project."}
                rows={3}
                value={codexPrompt}
              />
              <div className={styles.consoleComposerActions}>
                <div className={styles.consoleComposerLeft}>
                  <button
                    className={styles.commitButton}
                    disabled={isCommitting || !commitStatus?.has_changes}
                    onClick={handleCommitClick}
                    title={
                      !commitStatus?.is_git_repo
                        ? "Repository is not a git repository"
                        : !commitStatus?.has_changes
                          ? "Nothing to commit"
                          : commitStatus.suggested_message ?? "Create commit"
                    }
                    type="button"
                  >
                    Commit
                  </button>
                  <span className={styles.buildComposerMeta}>
                    {canvasDocument?.nodes.length
                      ? `Using top ${Math.min(canvasDocument.nodes.length, 12)} notes automatically`
                      : "No notes available"}
                  </span>
                </div>
                <div className={styles.consoleComposerRight}>
                  <label className={styles.planModeToggle}>
                    <input
                      checked={isPlanMode}
                      disabled={isBuilding || isPlanning}
                      onChange={(event) => setIsPlanMode(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Plan mode</span>
                  </label>
                  <button
                    className={styles.primaryButton}
                    disabled={isBuilding || isPlanning || codexPending || !activeRepoPath || !codexPrompt.trim()}
                    onClick={handleSubmitArchitecturePrompt}
                    type="button"
                  >
                    {isPlanning ? (
                      <>
                        <span aria-hidden="true" className={styles.buttonSpinner} />
                        <span>Planning...</span>
                      </>
                    ) : isBuilding ? (
                      <>
                        <span aria-hidden="true" className={styles.buttonSpinner} />
                        <span>Building...</span>
                      </>
                    ) : (
                      isPlanMode ? "Plan" : "Build"
                    )}
                  </button>
                </div>
              </div>
            </label>
          </div>
        </div>

        <div
          className={`${styles.canvasFrame} ${
            isConsoleExpanded ? styles.canvasFrameWithConsoleExpanded : styles.canvasFrameWithConsoleCollapsed
          }`}
        >
          {!canvasDocument ? (
            <EmptyState message="Load or create a canvas for this repo. Double-click empty space to add a node." />
          ) : shouldShowCanvasSetup ? (
            <div className={styles.canvasSetupCard}>
              <strong className={styles.resultTitle}>Do you want to set up the canvas?</strong>
              <p className={styles.resultMeta}>
                This project already has {workspaceStatus.visible_file_count} file
                {workspaceStatus.visible_file_count === 1 ? "" : "s"}, but the canvas is blank.
              </p>
              <div className={styles.actionsRow}>
                <button
                  className={styles.primaryButton}
                  disabled={isGeneratingCanvas}
                  onClick={handleGenerateCanvas}
                  type="button"
                >
                  {isGeneratingCanvas ? "Generating..." : "Set up canvas"}
                </button>
              </div>
            </div>
          ) : notesExploration && notesExplorationPresentation.displayDocument ? (
            renderExplorationSurface(notesExploration, notesExplorationPresentation)
          ) : (
            <CanvasBoard
              onDeleteNode={handleDeleteCanvasNode}
              document={canvasDocument}
              edgeNodeIds={selectedCanvasNodeIds}
              onCreateNodeAt={(x, y) => {
                startCanvasTransition(() => {
                  void handleCreateCanvasNodeAt(x, y);
                });
              }}
              onMoveNodeEnd={(nodeId, x, y) => {
                startCanvasTransition(() => {
                  void handlePersistCanvasNodePosition(nodeId, x, y);
                });
              }}
              onOpenNode={openCanvasNode}
              onPaneClick={() => {
                setNotesExploration(null);
              }}
              onSelectNode={(nodeId) => handleSelectCanvasNodes([nodeId])}
              onSelectNodes={handleSelectCanvasNodes}
              selectedNodeIds={selectedCanvasNodeIds}
            />
          )}
        </div>
      </div>
    );
  }

  function renderExplorationTab(session: ExplorationSession | null) {
    if (!session || !activeExplorationPresentation.displayDocument) {
      return <EmptyState message="This exploration is no longer available." />;
    }

    return (
      <div className={styles.notesWorkspace}>
        <div className={styles.notesConsoleShell}>
          <div className={styles.notesConsoleDock}>
            {isConsoleExpanded ? (
              <div className={styles.notesConsolePanel}>
                <div className={styles.notesConsoleMessages} ref={consoleMessagesRef}>
                  {consoleMessages.length === 0 ? (
                    <p className={styles.helperText}>Ask about the current exploration, its path, or the surrounding architecture.</p>
                  ) : (
                    consoleMessages.map((message) => (
                      <article
                        className={message.role === "user" ? styles.consoleMessageUser : styles.consoleMessageAssistant}
                        key={message.id}
                      >
                        <span className={styles.consoleMessageRole}>{message.role === "user" ? "You" : "Konceptura"}</span>
                        {message.title ? <strong className={styles.consoleMessageTitle}>{message.title}</strong> : null}
                        <div className={styles.consoleMessageBody}>
                          {renderConsoleMessageContent(
                            message.content,
                            message.role === "assistant" ? canvasDocument : null,
                            openCanvasNode,
                          )}
                        </div>
                        {pendingPlan?.messageId === message.id ? (
                          <div className={styles.consoleMessageActions}>
                            <button
                              className={styles.secondaryButton}
                              disabled={isBuilding}
                              onClick={handleApprovePlan}
                              type="button"
                            >
                              Approve
                            </button>
                          </div>
                        ) : null}
                      </article>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            <button
              className={isConsoleExpanded ? styles.notesConsoleBarExpanded : styles.notesConsoleBar}
              onClick={() => setIsConsoleExpanded((current) => !current)}
              type="button"
            >
              <span className={styles.notesConsoleBarLabel}>Console</span>
              <span className={styles.notesConsoleBarSummary}>{latestConsoleSummary}</span>
              <span className={styles.notesConsoleBarAction}>{isConsoleExpanded ? "Hide" : "Show"}</span>
            </button>

            <label className={styles.consoleComposer}>
              <textarea
                className={styles.consoleComposerInput}
                disabled={isBuilding || isPlanning}
                onChange={(event) => setCodexPrompt(event.target.value)}
                placeholder={isPlanMode ? "Describe what to plan in this project." : "Ask or build from this exploration."}
                rows={3}
                value={codexPrompt}
              />
              <div className={styles.consoleComposerActions}>
                <div className={styles.consoleComposerLeft}>
                  <button
                    className={styles.commitButton}
                    disabled={isCommitting || !commitStatus?.has_changes}
                    onClick={handleCommitClick}
                    title={
                      !commitStatus?.is_git_repo
                        ? "Repository is not a git repository"
                        : !commitStatus?.has_changes
                          ? "Nothing to commit"
                          : commitStatus.suggested_message ?? "Create commit"
                    }
                    type="button"
                  >
                    Commit
                  </button>
                  <span className={styles.buildComposerMeta}>
                    {visibleContextNodeIds.length
                      ? `Using ${visibleContextNodeIds.length} focused/pinned notes`
                      : "Using project context"}
                  </span>
                </div>
                <div className={styles.consoleComposerRight}>
                  <label className={styles.planModeToggle}>
                    <input
                      checked={isPlanMode}
                      disabled={isBuilding || isPlanning}
                      onChange={(event) => setIsPlanMode(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Plan mode</span>
                  </label>
                  <button
                    className={styles.primaryButton}
                    disabled={isBuilding || isPlanning || codexPending || !activeRepoPath || !codexPrompt.trim()}
                    onClick={handleSubmitArchitecturePrompt}
                    type="button"
                  >
                    {isPlanning ? (
                      <>
                        <span aria-hidden="true" className={styles.buttonSpinner} />
                        <span>Planning...</span>
                      </>
                    ) : isBuilding ? (
                      <>
                        <span aria-hidden="true" className={styles.buttonSpinner} />
                        <span>Building...</span>
                      </>
                    ) : (
                      isPlanMode ? "Plan" : "Build"
                    )}
                  </button>
                </div>
              </div>
            </label>
          </div>
        </div>

        <div
          className={`${styles.canvasFrame} ${
            isConsoleExpanded ? styles.canvasFrameWithConsoleExpanded : styles.canvasFrameWithConsoleCollapsed
          }`}
        >
          {renderExplorationSurface(session, activeExplorationPresentation, { persistent: true })}
        </div>
      </div>
    );
  }

  function renderNoteTabView(nodeId: string) {
    const node = canvasDocument?.nodes.find((item) => item.id === nodeId) ?? null;

    if (!node) {
      return <EmptyState message="This note no longer exists." />;
    }

    return (
      <div className={styles.workspaceSingle}>
        <div className={styles.noteEditorLayout}>
          <div className={styles.noteEditorMain}>
            <div className={styles.noteEditorHeader}>
              <div className={styles.tagRow}>
                {node.tags.length === 0 ? (
                  <span className={styles.tagChip}>untagged</span>
                ) : (
                  node.tags.map((tag) => (
                    <span className={styles.tagChip} key={tag}>
                      {tag}
                    </span>
                  ))
                )}
              </div>

              <input
                className={styles.noteTitleInput}
                onChange={(event) => setCanvasDraftTitle(event.target.value)}
                placeholder="Untitled note"
                value={canvasDraftTitle}
              />

              <div className={styles.noteMetaBar}>
                <span>{node.linked_files.length} linked files</span>
                <span>{node.linked_symbols.length} linked symbols</span>
                <span>{canvasOutgoingEdges.length} outgoing</span>
                <span>{canvasIncomingEdges.length} incoming</span>
              </div>
            </div>

            <label className={styles.noteField}>
              <span className={styles.fieldLabel}>Description</span>
              <textarea
                className={styles.noteBodyInput}
                onChange={(event) => setCanvasDraftDescription(event.target.value)}
                rows={18}
                value={canvasDraftDescription}
              />
            </label>

            <div className={styles.noteActions}>
              <button className={styles.primaryButton} onClick={handleSaveCanvasNode} type="button">
                Save note
              </button>
            </div>
          </div>

            <div className={styles.noteEditorSidebar}>
              <div className={styles.noteSidebarSection}>
                <span className={styles.fieldLabel}>Tags</span>
                <input
                  className={styles.noteSidebarInput}
                  onChange={(event) => setCanvasDraftTags(event.target.value)}
                  placeholder="screen, users, crud"
                  value={canvasDraftTags}
                />
              </div>

              <div className={styles.noteSidebarSection}>
                <span className={styles.fieldLabel}>Linked files</span>
                <textarea
                  className={styles.noteSidebarTextarea}
                  onChange={(event) => setCanvasDraftFiles(event.target.value)}
                  rows={6}
                  value={canvasDraftFiles}
                />
              </div>

              <div className={styles.noteSidebarSection}>
                <span className={styles.fieldLabel}>Linked symbols</span>
                <textarea
                  className={styles.noteSidebarTextarea}
                  onChange={(event) => setCanvasDraftSymbols(event.target.value)}
                  rows={6}
                  value={canvasDraftSymbols}
                />
              </div>

            <div className={styles.noteSidebarSection}>
              <span className={styles.fieldLabel}>Connections</span>
              <ul className={styles.noteRelationshipList}>
                {canvasOutgoingEdges.map((edge) => (
                  <li className={styles.noteRelationshipItem} key={edge.id}>
                    <span className={styles.relationshipDirection}>{edge.label || "out"}</span>
                    <button
                      className={styles.inlineLink}
                      onClick={() => openCanvasNode(edge.target_node_id)}
                      type="button"
                    >
                      {findCanvasNodeTitle(canvasDocument, edge.target_node_id)}
                    </button>
                  </li>
                ))}
                {canvasIncomingEdges.map((edge) => (
                  <li className={styles.noteRelationshipItem} key={edge.id}>
                    <span className={styles.relationshipDirection}>{edge.label || "in"}</span>
                    <button
                      className={styles.inlineLink}
                      onClick={() => openCanvasNode(edge.source_node_id)}
                      type="button"
                    >
                      {findCanvasNodeTitle(canvasDocument, edge.source_node_id)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderStructureView() {
    return (
      <div className={styles.workspaceSplit}>
        <div className={styles.workspacePrimary}>
          <div className={styles.panelSurface}>
            {!structure ? (
              <EmptyState message="Index a repository first, then load the structural tree." />
            ) : (
              <StructureTree
                expandedIds={expandedTreeNodeIds}
                onSelect={inspectTreeNode}
                onToggle={toggleTreeNode}
                selectedNodeId={selectedTreeNode?.id ?? null}
                tree={structure}
              />
            )}
          </div>
        </div>

        <div className={styles.workspaceSidebar}>
          <div className={styles.panelSurface}>
            {!selectedTreeNode ? (
              <EmptyState message="Select a node in the tree to inspect it." />
            ) : (
              <div className={styles.inspectorPane}>
                <strong className={styles.resultTitle}>{selectedTreeNode.name}</strong>
                <p className={styles.resultMeta}>
                  {selectedTreeNode.qualified_name ?? selectedTreeNode.path ?? "No metadata"}
                </p>
                <div className={styles.detailGrid}>
                  <DetailRow label="Kind" value={selectedTreeNode.kind} />
                  <DetailRow label="Children" value={String(selectedTreeNode.children.length)} />
                </div>
                <div className={styles.actionsRow}>
                  <button
                    className={styles.primaryButton}
                    onClick={() => {
                      startCanvasTransition(() => {
                        void handleCreateCanvasNodeAt();
                      });
                    }}
                    type="button"
                  >
                    Create note
                  </button>
                </div>
                <div>
                  <span className={styles.fieldLabel}>Outgoing calls</span>
                  {relationshipsPending ? (
                    <p className={styles.helperText}>Loading...</p>
                  ) : structureRelationships.length === 0 ? (
                    <p className={styles.helperText}>No outgoing calls for this selection.</p>
                  ) : (
                    <ul className={styles.relationshipList}>
                      {structureRelationships.map((item, index) => (
                        <li className={styles.relationshipItem} key={`${item.relationship}-${index}`}>
                          <span className={styles.relationshipDirection}>{item.relationship}</span>
                          <span>{displaySymbol(item.other_node)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderSearchView() {
    return (
      <div className={styles.workspaceSplit}>
        <div className={styles.workspacePrimary}>
          <div className={styles.panelSurface}>
            <div className={styles.inlineTabs}>
              <button
                className={queryMode === "search" ? styles.activeTab : styles.tab}
                onClick={() => setQueryMode("search")}
                type="button"
              >
                Search
              </button>
              <button
                className={queryMode === "cypher" ? styles.activeTab : styles.tab}
                onClick={() => setQueryMode("cypher")}
                type="button"
              >
                Cypher
              </button>
            </div>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{queryMode === "search" ? "Query" : "Cypher"}</span>
              <textarea
                className={styles.textarea}
                onChange={(event) => setQueryInput(event.target.value)}
                rows={queryMode === "search" ? 3 : 10}
                value={queryInput}
              />
            </label>

            <div className={styles.actionsRow}>
              <button className={styles.primaryButton} disabled={queryPending} onClick={handleSubmitQuery} type="button">
                {queryPending ? "Running..." : "Run query"}
              </button>
            </div>

            <div className={styles.resultsPane}>
              {queryResults.length === 0 ? (
                <EmptyState message="Run a query to inspect the graph." />
              ) : queryMode === "search" ? (
                <ul className={styles.resultList}>
                  {queryResults.map((item, index) =>
                    isSymbolRecord(item) ? (
                      <li key={`${displaySymbol(item)}-${index}`}>
                        <button className={styles.resultButton} onClick={() => inspectSymbol(item)} type="button">
                          <span className={styles.resultLabel}>{item.labels.join(", ")}</span>
                          <strong className={styles.resultTitle}>{displaySymbol(item)}</strong>
                          <span className={styles.resultMeta}>{String(item.properties.path ?? item.properties.name ?? "")}</span>
                        </button>
                      </li>
                    ) : null,
                  )}
                </ul>
              ) : (
                <pre className={styles.codeBlock}>{JSON.stringify(queryResults, null, 2)}</pre>
              )}
            </div>
          </div>
        </div>

        <div className={styles.workspaceSidebar}>
          <div className={styles.panelSurface}>
            {!selectedSymbol ? (
              <EmptyState message="Select a search result to inspect its relationships." />
            ) : (
              <div className={styles.inspectorPane}>
                <strong className={styles.resultTitle}>{displaySymbol(selectedSymbol)}</strong>
                <p className={styles.resultMeta}>{selectedSymbol.labels.join(", ")}</p>
                {relationshipsPending ? <p className={styles.helperText}>Loading...</p> : null}
                {relationships.length === 0 ? (
                  <p className={styles.helperText}>No outgoing CALLS edges were found.</p>
                ) : (
                  <ul className={styles.relationshipList}>
                    {relationships.map((item, index) => (
                      <li className={styles.relationshipItem} key={`${item.relationship}-${index}`}>
                        <span className={styles.relationshipDirection}>{item.relationship}</span>
                        <span>{displaySymbol(item.other_node)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderImpactView() {
    return (
      <div className={styles.workspaceSplit}>
        <div className={styles.workspacePrimary}>
          <div className={styles.panelSurface}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Change request</span>
              <textarea
                className={styles.textarea}
                onChange={(event) => setImpactPrompt(event.target.value)}
                rows={4}
                value={impactPrompt}
              />
            </label>

            <div className={styles.actionsRow}>
              <button className={styles.primaryButton} disabled={impactPending} onClick={handleSubmitImpact} type="button">
                {impactPending ? "Analyzing..." : "Analyze impact"}
              </button>
            </div>

            <div className={styles.resultsPane}>
              {!impactResult || impactResult.affected_files.length === 0 ? (
                <EmptyState message="Run impact analysis to see likely files." />
              ) : (
                <ul className={styles.resultList}>
                  {impactResult.affected_files.map((item) => (
                    <li key={item.path}>
                      <div className={styles.resultCard}>
                        <span className={styles.resultLabel}>File</span>
                        <strong className={styles.resultTitle}>{item.path}</strong>
                        <ul className={styles.simpleList}>
                          {item.reasons.map((reason) => (
                            <li key={`${item.path}-${reason}`}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className={styles.workspaceSidebar}>
          <div className={styles.panelSurface}>
            {!impactResult ? (
              <EmptyState message="Run impact analysis to inspect matching symbols." />
            ) : (
              <div className={styles.inspectorPane}>
                <p className={styles.helperText}>{impactResult.summary}</p>
                <div className={styles.actionsRow}>
                  <button
                    className={styles.secondaryButton}
                    onClick={() => {
                      startCanvasTransition(() => {
                        void handleCreateCanvasNodeAt();
                      });
                    }}
                    type="button"
                  >
                    Capture as note
                  </button>
                </div>
                <ul className={styles.resultList}>
                  {impactResult.seeds.map((seed, index) => (
                    <li key={`${displaySymbol(seed.symbol)}-${index}`}>
                      <button className={styles.resultButton} onClick={() => inspectSymbol(seed.symbol)} type="button">
                        <span className={styles.resultLabel}>score {seed.score.toFixed(2)}</span>
                        <strong className={styles.resultTitle}>{displaySymbol(seed.symbol)}</strong>
                        <span className={styles.resultMeta}>
                          {seed.reason}
                          {seed.file_path ? ` • ${seed.file_path}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderProjectView() {
    return (
      <div className={styles.settingsPane}>
        <div className={styles.panelSurface}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Repository path</span>
            <input className={styles.input} onChange={(event) => setRepoPath(event.target.value)} value={repoPath} />
          </label>

          {project?.recent_projects.length ? (
            <div className={styles.sampleRepoList}>
              {project.recent_projects.map((path) => (
                <button className={styles.secondaryButton} key={path} onClick={() => setRepoPath(path)} type="button">
                  {PathLabel(path)}
                </button>
              ))}
            </div>
          ) : null}

          <div className={styles.actionsRow}>
            <button className={styles.primaryButton} disabled={projectPending} onClick={handleSaveProject} type="button">
              {projectPending ? "Saving..." : "Open project"}
            </button>
            <button
              className={styles.secondaryButton}
              disabled={!activeRepoPath || isGeneratingCanvas}
              onClick={handleGenerateCanvas}
              type="button"
            >
              {isGeneratingCanvas
                ? "Generating..."
                : canvasDocument?.nodes.length
                  ? "Regenerate canvas"
                  : "Set up canvas"}
            </button>
            <button className={styles.secondaryButton} disabled={!activeRepoPath} onClick={handleResetCanvas} type="button">
              Reset canvas
            </button>
          </div>
        </div>

        <div className={styles.panelSurface}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>AGENTS.md</span>
            <textarea className={styles.textarea} onChange={(event) => setAgentsContent(event.target.value)} rows={18} value={agentsContent} />
          </label>

          <div className={styles.actionsRow}>
            <button className={styles.primaryButton} disabled={agentsPending || !activeRepoPath} onClick={handleSaveAgentsDocument} type="button">
              {agentsPending ? "Saving..." : "Save AGENTS.md"}
            </button>
            {agentsDocument?.path ? <span className={styles.helperText}>{agentsDocument.path}</span> : null}
          </div>
        </div>

        <div className={styles.panelSurface}>
          <dl className={styles.statusList}>
            <StatusRow label="API" tone={statusPending ? "muted" : "ok"} value={API_BASE_URL} />
            <StatusRow
              label="Memgraph"
              tone={status?.memgraph_ok ? "ok" : "error"}
              value={status?.memgraph_ok ? "connected" : "unreachable"}
            />
            <StatusRow
              label="Code graph"
              tone={status?.cgr_ok ? "ok" : "error"}
              value={status?.cgr_ok ? "ready" : "missing"}
            />
            <StatusRow
              label="Codex"
              tone={status?.codex_ok ? "ok" : "error"}
              value={status?.codex_ok ? "ready" : "missing"}
            />
            <StatusRow
              label="Index job"
              tone={statusTone(status?.index_job.status)}
              value={status?.index_job.status ?? "idle"}
            />
          </dl>
        </div>
      </div>
    );
  }

  function renderChatView() {
    return (
      <div className={styles.chatWorkspace}>
        <div className={styles.chatPageSurface}>
          <div className={styles.chatPageHeader}>
            <div>
              <strong className={styles.resultTitle}>
                {activeConversationSummary?.title ?? "Conversation"}
              </strong>
              <p className={styles.resultMeta}>
                {latestConsoleSummary}
              </p>
            </div>
            <button className={styles.secondaryButton} onClick={returnChatToFloatingContainer} type="button">
              Floating container
            </button>
          </div>

          <div className={styles.chatPageMessages}>
            {consoleMessages.length === 0 ? (
              <p className={styles.helperText}>Ask about the current project, notes, or visible context.</p>
            ) : (
              consoleMessages.map((message) => (
                <article
                  className={message.role === "user" ? styles.consoleMessageUser : styles.consoleMessageAssistant}
                  key={message.id}
                >
                  <span className={styles.consoleMessageRole}>{message.role === "user" ? "You" : "Konceptura"}</span>
                  {message.title ? <strong className={styles.consoleMessageTitle}>{message.title}</strong> : null}
                  <div className={styles.consoleMessageBody}>
                    {renderConsoleMessageContent(
                      message.content,
                      message.role === "assistant" ? canvasDocument : null,
                      openCanvasNode,
                    )}
                  </div>
                  {pendingPlan?.messageId === message.id ? (
                    <div className={styles.consoleMessageActions}>
                      <button
                        className={styles.secondaryButton}
                        disabled={isBuilding}
                        onClick={handleApprovePlan}
                        type="button"
                      >
                        Approve
                      </button>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>

          <label className={styles.chatComposer}>
            <textarea
              className={styles.consoleComposerInput}
              disabled={isBuilding || isPlanning}
              onChange={(event) => setCodexPrompt(event.target.value)}
              placeholder={isPlanMode ? "Describe what to plan in this project." : "Describe what to build in this project."}
              rows={4}
              value={codexPrompt}
            />
            <div className={styles.consoleComposerActions}>
              <div className={styles.consoleComposerLeft}>
                <button
                  className={styles.commitButton}
                  disabled={isCommitting || !commitStatus?.has_changes}
                  onClick={handleCommitClick}
                  type="button"
                >
                  Commit
                </button>
                <span className={styles.buildComposerMeta}>
                  {visibleContextNodeIds.length
                    ? `Using ${visibleContextNodeIds.length} focused/pinned notes`
                    : "Using project context"}
                </span>
              </div>
              <div className={styles.consoleComposerRight}>
                <label className={styles.planModeToggle}>
                  <input
                    checked={isPlanMode}
                    disabled={isBuilding || isPlanning}
                    onChange={(event) => setIsPlanMode(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Plan mode</span>
                </label>
                <button
                  className={styles.primaryButton}
                  disabled={isBuilding || isPlanning || codexPending || !activeRepoPath || !codexPrompt.trim()}
                  onClick={handleSubmitArchitecturePrompt}
                  type="button"
                >
                  {isPlanning ? "Planning..." : isBuilding ? "Building..." : isPlanMode ? "Plan" : "Build"}
                </button>
              </div>
            </div>
          </label>
        </div>
      </div>
    );
  }

  function renderInspectView() {
    return (
      <div className={styles.inspectPane}>
        <div className={styles.inlineTabs}>
          <button className={inspectView === "structure" ? styles.activeTab : styles.tab} onClick={() => setInspectView("structure")} type="button">
            Structure
          </button>
          <button className={inspectView === "search" ? styles.activeTab : styles.tab} onClick={() => setInspectView("search")} type="button">
            Search
          </button>
          <button className={inspectView === "impact" ? styles.activeTab : styles.tab} onClick={() => setInspectView("impact")} type="button">
            Impact
          </button>
        </div>
        {inspectView === "structure" ? renderStructureView() : null}
        {inspectView === "search" ? renderSearchView() : null}
        {inspectView === "impact" ? renderImpactView() : null}
      </div>
    );
  }

  function renderCommandPalette() {
    if (!isCommandPaletteOpen) {
      return null;
    }

    const selectedResult = commandResults[commandSelectedIndex] ?? null;

    return (
      <div
        className={styles.commandPalette}
        style={{ left: commandPalettePosition.x, top: commandPalettePosition.y }}
      >
        <div
          className={styles.commandPaletteBar}
          onMouseDown={(event) => {
            setIsCommandDragging(true);
            setCommandDragOffset({
              x: event.clientX - commandPalettePosition.x,
              y: event.clientY - commandPalettePosition.y,
            });
          }}
        >
          <div className={styles.commandPaletteBarTitle}>
            <strong>{commandPaletteMode === "chat" ? "Chat" : "Command Bar"}</strong>
            <span>{viewLabel(activeView)}</span>
          </div>
          <div className={styles.commandPaletteBarActions}>
            <button
              className={styles.commandPaletteBarButton}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => setCommandPaletteMode((current) => (current === "chat" ? "search" : "chat"))}
              type="button"
            >
              {commandPaletteMode === "chat" ? "Search" : "Chat"}
            </button>
            <button
              className={styles.commandPaletteBarButton}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={openChatViewTab}
              type="button"
            >
              Open page
            </button>
            <button
              className={styles.commandPaletteBarButton}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => setIsCommandPaletteOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>
        </div>

        <div className={styles.commandPaletteContext}>
          <span className={styles.commandContextChip}>{PathLabel(activeRepoPath || "No project")}</span>
          <span className={styles.commandContextChip}>{viewLabel(activeView)}</span>
          {focusedCanvasNodeId ? (
            <span className={styles.commandContextChip}>
              {findCanvasNodeTitle(canvasDocument, focusedCanvasNodeId)}
            </span>
          ) : null}
          {pinnedCanvasNodes.map((node) => (
            <button
              className={styles.commandContextChipButton}
              key={node.id}
              onClick={() => unpinCanvasNode(node.id)}
              type="button"
            >
              {node.title} ×
            </button>
          ))}
        </div>

        {commandPaletteMode === "search" ? (
          <>
            <div className={styles.commandPaletteInputWrap}>
              <input
                className={styles.commandPaletteInput}
                onChange={(event) => setCommandInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setCommandSelectedIndex((current) =>
                      commandResults.length === 0 ? 0 : Math.min(current + 1, commandResults.length - 1),
                    );
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setCommandSelectedIndex((current) => Math.max(current - 1, 0));
                    return;
                  }
                  if (event.key === "Enter") {
                    if (!selectedResult) {
                      return;
                    }
                    event.preventDefault();
                    selectedResult.run();
                  }
                }}
                placeholder="Search notes, projects, chats...  ? ask  ! action"
                ref={commandInputRef}
                value={commandInput}
              />
            </div>

            <div className={styles.commandPaletteBodySingle}>
              <div className={styles.commandResults}>
                {commandResults.length === 0 ? (
                  <p className={styles.helperText}>
                    {commandMode === "ask"
                      ? "Type a question after ? to ask about the current context."
                      : commandMode === "action"
                        ? "Type an action after ! or use !build / !plan with a prompt."
                        : "Search notes, projects, chats, or views."}
                  </p>
                ) : (
                  commandResults.map((item, index) => (
                    <button
                      className={index === commandSelectedIndex ? styles.commandResultActive : styles.commandResult}
                      key={item.id}
                      onClick={item.run}
                      type="button"
                    >
                      <span className={styles.commandResultTitle}>{item.title}</span>
                      {item.subtitle ? <span className={styles.commandResultMeta}>{item.subtitle}</span> : null}
                    </button>
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          <div className={styles.commandChatBody}>
            <div className={styles.commandChatMessages}>
              {consoleMessages.length === 0 ? (
                <p className={styles.helperText}>Ask about the current project, notes, or visible context.</p>
              ) : (
                consoleMessages.map((message) => (
                  <article
                    className={message.role === "user" ? styles.consoleMessageUser : styles.consoleMessageAssistant}
                    key={message.id}
                  >
                    <span className={styles.consoleMessageRole}>{message.role === "user" ? "You" : "Konceptura"}</span>
                    {message.title ? <strong className={styles.consoleMessageTitle}>{message.title}</strong> : null}
                    <div className={styles.consoleMessageBody}>
                      {renderConsoleMessageContent(
                        message.content,
                        message.role === "assistant" ? canvasDocument : null,
                        openCanvasNode,
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>

            <label className={styles.commandChatComposer}>
              <textarea
                className={styles.consoleComposerInput}
                disabled={isBuilding || isPlanning}
                onChange={(event) => setCodexPrompt(event.target.value)}
                placeholder={isPlanMode ? "Describe what to plan in this project." : "Describe what to build or ask in this project."}
                rows={4}
                value={codexPrompt}
              />
              <div className={styles.consoleComposerActions}>
                <div className={styles.consoleComposerLeft}>
                  <button
                    className={styles.commitButton}
                    disabled={isCommitting || !commitStatus?.has_changes}
                    onClick={handleCommitClick}
                    type="button"
                  >
                    Commit
                  </button>
                  <span className={styles.buildComposerMeta}>
                    {visibleContextNodeIds.length
                      ? `Using ${visibleContextNodeIds.length} focused/pinned notes`
                      : "Using project context"}
                  </span>
                </div>
                <div className={styles.consoleComposerRight}>
                  <label className={styles.planModeToggle}>
                    <input
                      checked={isPlanMode}
                      disabled={isBuilding || isPlanning}
                      onChange={(event) => setIsPlanMode(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Plan mode</span>
                  </label>
                  <button
                    className={styles.primaryButton}
                    disabled={isBuilding || isPlanning || codexPending || !activeRepoPath || !codexPrompt.trim()}
                    onClick={handleSubmitArchitecturePrompt}
                    type="button"
                  >
                    {isPlanning ? "Planning..." : isBuilding ? "Building..." : isPlanMode ? "Plan" : "Build"}
                  </button>
                </div>
              </div>
            </label>
          </div>
        )}
      </div>
    );
  }

  function renderProjectSetup() {
    return (
      <div className={styles.setupShell}>
        <div className={styles.setupPanel}>
          <div className={styles.setupHeader}>
            <strong className={styles.setupTitle}>Open your project</strong>
            <p className={styles.setupText}>
              Start with the local folder for your app. You can fill in goals, stack, and design direction later inside the project.
            </p>
          </div>
          <div className={styles.setupCard}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Project folder</span>
              <input className={styles.input} onChange={(event) => setRepoPath(event.target.value)} value={repoPath} />
            </label>

            {project?.recent_projects.length ? (
              <div className={styles.sampleRepoList}>
                {project.recent_projects.map((path) => (
                  <button className={styles.secondaryButton} key={path} onClick={() => setRepoPath(path)} type="button">
                    {PathLabel(path)}
                  </button>
                ))}
              </div>
            ) : null}

            {sampleRepos.length > 0 ? (
              <div className={styles.sampleRepoList}>
                {sampleRepos.map(([name, path]) => (
                  <button className={styles.secondaryButton} key={name} onClick={() => applySampleRepo(path)} type="button">
                    {name}
                  </button>
                ))}
              </div>
            ) : null}

            <div className={styles.actionsRow}>
              <button className={styles.primaryButton} disabled={projectPending || !repoPath.trim()} onClick={handleSaveProject} type="button">
                {projectPending ? "Opening..." : "Open project"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderProjectsTree() {
    return (
      <div className={styles.projectTreeSection}>
        <button
          className={styles.projectTreeHeaderButton}
          onClick={() => setIsProjectsSectionExpanded((current) => !current)}
          type="button"
        >
          <span className={styles.projectTreeLabel}>
            <span className={styles.projectTreeChevron}>
              <ChevronIcon expanded={isProjectsSectionExpanded} />
            </span>
            <span className={styles.railIcon}>
              <FolderIcon />
            </span>
            {isRailExpanded ? <span>Projects</span> : null}
          </span>
        </button>

        {isRailExpanded && isProjectsSectionExpanded ? (
          <div className={styles.projectTreeList}>
            {projectsTree.length === 0 ? (
              <p className={styles.railMeta}>No recent projects yet.</p>
            ) : (
              projectsTree.map((item) => {
                const isActiveProject = item.repo_path === (project?.repo_path ?? repoPath.trim());
                const isActiveConversationProject = item.repo_path === activeConversationRepoPath;
                const isProjectExpanded = expandedProjectPaths.has(item.repo_path);
                return (
                  <div className={styles.projectTreeItem} key={item.repo_path}>
                    <div className={styles.projectTreeRow}>
                      <button
                        className={isActiveProject ? styles.projectTreeProjectActive : styles.projectTreeProject}
                        onClick={() => {
                          setExpandedProjectPaths((current) => {
                            const next = new Set(current);
                            if (next.has(item.repo_path)) {
                              next.delete(item.repo_path);
                            } else {
                              next.add(item.repo_path);
                            }
                            return next;
                          });
                          startProjectTransition(() => {
                            void openProjectConversation(item.repo_path);
                          });
                        }}
                        type="button"
                      >
                        <span className={styles.projectTreeProjectChevron}>
                          <ChevronIcon expanded={isProjectExpanded} />
                        </span>
                        <span className={styles.projectTreeProjectTitle}>{item.name}</span>
                      </button>
                      <button
                        className={styles.projectTreeAddButton}
                        onClick={() => {
                          startProjectTransition(() => {
                            void createConversationForProject(item.repo_path);
                          });
                        }}
                        title={`New conversation in ${item.name}`}
                        type="button"
                      >
                        +
                      </button>
                    </div>

                    {isProjectExpanded ? (
                      <div className={styles.projectTreeConversations}>
                        {item.conversations.map((conversation) => {
                          const isActiveConversation =
                            isActiveConversationProject && activeConversationId === conversation.id;
                          return (
                            <button
                              className={
                                isActiveConversation
                                  ? styles.projectTreeConversationActive
                                  : styles.projectTreeConversation
                              }
                              key={`${item.repo_path}:${conversation.id}`}
                              onClick={() => {
                                startProjectTransition(() => {
                                  void openProjectConversation(item.repo_path, conversation);
                                });
                              }}
                              type="button"
                            >
                              <span className={styles.projectTreeConversationTitle}>{conversation.title}</span>
                              <span className={styles.projectTreeConversationMeta}>
                                {conversation.message_count} msg{conversation.message_count === 1 ? "" : "s"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </div>
    );
  }

  function renderActiveView() {
    if (activeTab?.type === "note") {
      return renderNoteTabView(activeTab.nodeId);
    }
    if (activeTab?.type === "exploration") {
      return renderExplorationTab(explorationTabs[activeTab.explorationId] ?? null);
    }

    switch (activeView) {
      case "notes":
        return renderNotesView();
      case "inspect":
        return renderInspectView();
      case "project":
        return renderProjectView();
      case "chat":
        return renderChatView();
      default:
        return null;
    }
  }

  if (!project) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingShell}>Loading project...</div>
      </div>
    );
  }

  if (!repoPath.trim()) {
    return (
      <div className={styles.page}>
        {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}
        {renderProjectSetup()}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={isRailExpanded ? styles.shellExpanded : styles.shell}>
        <aside className={isRailExpanded ? styles.leftRailExpanded : styles.leftRail} style={{ width: currentRailWidth }}>
          <nav className={styles.railNav}>
            {RAIL_VIEW_ITEMS.map((item) => (
              <button
                className={activeView === item.id ? styles.railButtonActive : styles.railButton}
                key={item.id}
                onClick={() => openViewTab(item.id)}
                type="button"
                title={!isRailExpanded ? item.label : undefined}
              >
                <span className={styles.railIcon}><ViewIcon view={item.id} /></span>
                {isRailExpanded ? <span className={styles.railLabel}>{item.label}</span> : null}
              </button>
            ))}
            <div className={styles.railSectionDivider} />
            {renderProjectsTree()}
          </nav>

          <div className={styles.railFooter}>
            {isRailExpanded ? (
              <>
                <span className={styles.railMeta}>Nodes {canvasDocument?.nodes.length ?? 0}</span>
                <span className={styles.railMeta}>Open {openCanvasNodes.length}</span>
              </>
            ) : null}
            <button
              className={styles.railToggle}
              onClick={() => setIsRailExpanded((current) => !current)}
              type="button"
              title={isRailExpanded ? "Collapse toolbar" : "Expand toolbar"}
            >
              <span className={styles.railIcon}>
                <ToggleIcon collapsed={!isRailExpanded} />
              </span>
              {isRailExpanded ? <span className={styles.railLabel}>Collapse</span> : null}
            </button>
          </div>
          {isRailExpanded ? (
            <div
              className={styles.railResizeHandle}
              onMouseDown={(event) => {
                event.preventDefault();
                setRailResizeStartX(event.clientX);
                setRailResizeStartWidth(currentRailWidth);
                setIsRailResizing(true);
              }}
            />
          ) : null}
        </aside>

        <main className={styles.workspace} style={{ marginLeft: currentRailWidth }}>
          <div className={styles.tabStrip}>
            {openTabs.map((tab) => (
              <div className={activeTabId === tab.id ? styles.documentTabActive : styles.documentTab} key={tab.id}>
                <button
                  className={tab.type === "view" && tab.preview ? styles.documentTabButtonPreview : styles.documentTabButton}
                  onClick={() => handleSelectTab(tab)}
                  type="button"
                >
                  {tab.type === "view"
                    ? viewLabel(tab.view)
                    : tab.type === "note"
                      ? canvasDocument?.nodes.find((node) => node.id === tab.nodeId)?.title ?? "Note"
                      : explorationTabTitle(canvasDocument, explorationTabs[tab.explorationId] ?? null)}
                </button>
                {tab.id !== "view:notes" ? (
                  <button className={styles.documentTabClose} onClick={() => closeTab(tab.id)} type="button">
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}

          <section className={activeView === "notes" ? styles.workspaceStageFlush : styles.workspaceStage}>
            {renderActiveView()}
          </section>

          {renderCommandPalette()}
        </main>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "ok" | "error" | "muted";
  value: string;
}) {
  return (
    <div className={styles.statusRow}>
      <dt className={styles.statusLabel}>{label}</dt>
      <dd className={tone === "error" ? styles.statusValueError : tone === "ok" ? styles.statusValueOk : styles.statusValueMuted}>
        {value}
      </dd>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{value}</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className={styles.helperText}>{message}</p>;
}

function viewLabel(view: WorkspaceView) {
  switch (view) {
    case "notes":
      return "Notes";
    case "inspect":
      return "Inspect";
    case "project":
      return "Project";
    case "chat":
      return "Chat";
    default:
      return view;
  }
}

function ViewIcon({ view }: { view: WorkspaceView }) {
  switch (view) {
    case "notes":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M4 4.5h8M4 8h8M4 11.5h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "inspect":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <rect x="2.5" y="2.5" width="4" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="11.5" cy="4.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="m9.9 9.8 2.7 2.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="7" cy="11" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      );
    case "project":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 13.2h10M4 11V4.6a1.6 1.6 0 0 1 1.6-1.6h4.8L12 4.6V11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M10.4 3v2h2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
    case "chat":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3.4 4.1h9.2a1.3 1.3 0 0 1 1.3 1.3v4.7a1.3 1.3 0 0 1-1.3 1.3H8.1l-2.6 2.2v-2.2H3.4a1.3 1.3 0 0 1-1.3-1.3V5.4a1.3 1.3 0 0 1 1.3-1.3Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

function ToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      {collapsed ? (
        <path d="m6 3.5 4 4.5-4 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="m10 3.5-4 4.5 4 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path
        d="M2.8 4.3h3l1.2 1.3h6.2v6.2a1.2 1.2 0 0 1-1.2 1.2H3.9a1.2 1.2 0 0 1-1.1-1.2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      {expanded ? (
        <path
          d="m4 6 4 4 4-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      ) : (
        <path
          d="m6 4 4 4-4 4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
}

function PathLabel(value: string) {
  const normalized = value.trim().replace(/\/+$/, "");
  const segments = normalized.split("/");
  return segments.at(-1) || normalized || value;
}

function deriveConversationTitle(prompt: string) {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "New conversation";
  }
  return cleaned.length > 42 ? `${cleaned.slice(0, 42).trim()}...` : cleaned;
}

function isSymbolRecord(value: Record<string, unknown> | SymbolRecord): value is SymbolRecord {
  return Array.isArray((value as SymbolRecord).labels) && typeof (value as SymbolRecord).properties === "object";
}

function displaySymbol(symbol: SymbolRecord) {
  return String(symbol.properties.qualified_name ?? symbol.properties.path ?? symbol.properties.name);
}

function parseLineList(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTagList(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) {
        return false;
      }
      const lowered = item.toLowerCase();
      if (seen.has(lowered)) {
        return false;
      }
      seen.add(lowered);
      return true;
    });
}

function buildLinkedFiles(symbol: SymbolRecord | null, treeNode: StructureNode | null) {
  const values = new Set<string>();
  const symbolPath = symbol?.properties.path;
  if (typeof symbolPath === "string") {
    values.add(symbolPath);
  }
  if (treeNode?.path) {
    values.add(treeNode.path);
  }
  return [...values];
}

function buildLinkedSymbols(symbol: SymbolRecord | null, treeNode: StructureNode | null) {
  const values = new Set<string>();
  const qualifiedName = symbol?.properties.qualified_name;
  if (typeof qualifiedName === "string") {
    values.add(qualifiedName);
  }
  if (treeNode?.qualified_name) {
    values.add(treeNode.qualified_name);
  }
  return [...values];
}

function buildNewCanvasNodeTitle(symbol: SymbolRecord | null, treeNode: StructureNode | null) {
  if (symbol) {
    return displaySymbol(symbol).split(".").at(-1) ?? "New note";
  }
  if (treeNode) {
    return treeNode.name;
  }
  return "New note";
}

function buildNewCanvasNodeDescription(symbol: SymbolRecord | null, treeNode: StructureNode | null) {
  if (symbol) {
    return `Describe what ${displaySymbol(symbol)} is responsible for, how it works, and what should stay true when editing it.`;
  }
  if (treeNode) {
    return `Describe how ${treeNode.name} fits into the project and what it should do.`;
  }
  return "Describe the feature, screen, module, or constraint this note represents.";
}

function buildNewCanvasNodeTags(symbol: SymbolRecord | null, treeNode: StructureNode | null) {
  const label = symbol?.labels[0] ?? treeNode?.kind ?? "";
  const lowered = label.toLowerCase();
  if (["file", "module", "function", "method"].includes(lowered)) {
    return ["module"];
  }
  if (lowered) {
    return [lowered];
  }
  return ["feature"];
}

function findCanvasNodeTitle(document: CanvasDocument | null, nodeId: string) {
  return document?.nodes.find((item) => item.id === nodeId)?.title ?? nodeId;
}

function explorationTabTitle(document: CanvasDocument | null, session: ExplorationSession | null) {
  if (!session) {
    return "Explore";
  }
  const rootTitle = findCanvasNodeTitle(document, session.rootNodeId);
  const activeTitle = findCanvasNodeTitle(document, session.activeNodeId);
  return rootTitle === activeTitle ? `Explore: ${rootTitle}` : `${rootTitle} -> ${activeTitle}`;
}

function createExplorationSession(nodeId: string): ExplorationSession {
  return {
    id: `explore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    rootNodeId: nodeId,
    activeNodeId: nodeId,
    pathNodeIds: [nodeId],
    relationQuery: "",
  };
}

function normalizeExplorationSession(
  session: ExplorationSession | null,
  validNodeIds: Set<string>,
): ExplorationSession | null {
  if (!session) {
    return null;
  }

  const pathNodeIds = uniqueNodeIds(session.pathNodeIds.filter((nodeId) => validNodeIds.has(nodeId)));
  if (pathNodeIds.length === 0) {
    return null;
  }

  const rootNodeId = validNodeIds.has(session.rootNodeId) ? session.rootNodeId : pathNodeIds[0];
  const activeNodeId = validNodeIds.has(session.activeNodeId) ? session.activeNodeId : pathNodeIds.at(-1) ?? rootNodeId;

  return {
    ...session,
    rootNodeId,
    activeNodeId,
    pathNodeIds,
  };
}

function advanceExplorationSession(session: ExplorationSession, nextNodeId: string): ExplorationSession {
  const existingIndex = session.pathNodeIds.indexOf(nextNodeId);
  if (existingIndex !== -1) {
    const nextPath = session.pathNodeIds.slice(0, existingIndex + 1);
    if (
      nextPath.length === session.pathNodeIds.length &&
      session.activeNodeId === nextNodeId
    ) {
      return session;
    }
    return {
      ...session,
      activeNodeId: nextNodeId,
      pathNodeIds: nextPath,
    };
  }

  return {
    ...session,
    activeNodeId: nextNodeId,
    pathNodeIds: [...session.pathNodeIds, nextNodeId],
  };
}

function buildExplorationPresentation(
  document: CanvasDocument | null,
  session: ExplorationSession | null,
): ExplorationPresentation {
  if (!document || !session) {
    return {
      activeNode: null,
      customMatches: [],
      displayDocument: null,
      pathNodes: [],
      suggestedNodes: [],
      visibleNodeIds: [],
    };
  }

  const validNodeIds = new Set(document.nodes.map((node) => node.id));
  const normalizedSession = normalizeExplorationSession(session, validNodeIds);
  if (!normalizedSession) {
    return {
      activeNode: null,
      customMatches: [],
      displayDocument: null,
      pathNodes: [],
      suggestedNodes: [],
      visibleNodeIds: [],
    };
  }

  const nodesById = new Map(document.nodes.map((node) => [node.id, node] as const));
  const pathNodes = normalizedSession.pathNodeIds
    .map((nodeId) => nodesById.get(nodeId) ?? null)
    .filter((node): node is CanvasNode => Boolean(node));
  const suggestedNodes = collectExplorationSuggestions(document, normalizedSession)
    .map((nodeId) => nodesById.get(nodeId) ?? null)
    .filter((node): node is CanvasNode => Boolean(node));
  const customMatches = collectExplorationRelationMatches(document, normalizedSession)
    .map((nodeId) => nodesById.get(nodeId) ?? null)
    .filter((node): node is CanvasNode => Boolean(node));
  const visibleNodeIds = uniqueNodeIds([
    ...pathNodes.map((node) => node.id),
    ...suggestedNodes.map((node) => node.id),
    ...customMatches.map((node) => node.id),
  ]);

  return {
    activeNode: nodesById.get(normalizedSession.activeNodeId) ?? null,
    customMatches,
    displayDocument: layoutExplorationDocument(document, normalizedSession, visibleNodeIds, suggestedNodes, customMatches),
    pathNodes,
    suggestedNodes,
    visibleNodeIds,
  };
}

function collectExplorationSuggestions(document: CanvasDocument, session: ExplorationSession) {
  const pathIds = new Set(session.pathNodeIds);
  const candidateScores = new Map<string, number>();
  const activeNeighbors = getNeighborNodeIds(document, session.activeNodeId);

  for (const nodeId of activeNeighbors) {
    if (pathIds.has(nodeId)) {
      continue;
    }
    candidateScores.set(nodeId, (candidateScores.get(nodeId) ?? 0) + 80);
  }

  for (const pathNodeId of session.pathNodeIds) {
    for (const nodeId of getNeighborNodeIds(document, pathNodeId)) {
      if (pathIds.has(nodeId)) {
        continue;
      }
      candidateScores.set(nodeId, (candidateScores.get(nodeId) ?? 0) + 24);
    }
  }

  for (const neighborId of activeNeighbors) {
    for (const nodeId of getNeighborNodeIds(document, neighborId)) {
      if (pathIds.has(nodeId) || nodeId === session.activeNodeId) {
        continue;
      }
      candidateScores.set(nodeId, (candidateScores.get(nodeId) ?? 0) + 8);
    }
  }

  return [...candidateScores.keys()]
    .sort((leftId, rightId) => {
      const leftNode = document.nodes.find((node) => node.id === leftId);
      const rightNode = document.nodes.find((node) => node.id === rightId);
      const leftScore = (candidateScores.get(leftId) ?? 0) + (leftNode ? scoreNote(document, leftNode, session.pathNodeIds) : 0);
      const rightScore = (candidateScores.get(rightId) ?? 0) + (rightNode ? scoreNote(document, rightNode, session.pathNodeIds) : 0);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return leftId.localeCompare(rightId);
    })
    .slice(0, 3);
}

function collectExplorationRelationMatches(document: CanvasDocument, session: ExplorationSession) {
  const query = session.relationQuery.trim().toLowerCase();
  if (!query) {
    return [];
  }

  const queryTerms = query.split(/\s+/).filter(Boolean);
  const pathIds = new Set(session.pathNodeIds);
  const suggestedIds = new Set(collectExplorationSuggestions(document, session));
  const candidateScores = new Map<string, number>();
  const directNeighbors = new Set<string>();

  for (const pathNodeId of session.pathNodeIds) {
    for (const nodeId of getNeighborNodeIds(document, pathNodeId)) {
      if (!pathIds.has(nodeId)) {
        directNeighbors.add(nodeId);
      }
    }
  }

  const secondDegree = new Set<string>();
  for (const nodeId of directNeighbors) {
    for (const nextId of getNeighborNodeIds(document, nodeId)) {
      if (!pathIds.has(nextId)) {
        secondDegree.add(nextId);
      }
    }
  }

  const candidateIds = uniqueNodeIds([...directNeighbors, ...secondDegree]).filter((nodeId) => !pathIds.has(nodeId));

  for (const candidateId of candidateIds) {
    const candidateNode = document.nodes.find((node) => node.id === candidateId);
    if (!candidateNode) {
      continue;
    }

    let score = scoreTextMatch(queryTerms, [
      candidateNode.title,
      candidateNode.description,
      candidateNode.tags.join(" "),
      candidateNode.linked_files.join(" "),
      candidateNode.linked_symbols.join(" "),
    ]);

    for (const edge of document.edges) {
      const touchesCandidate = edge.source_node_id === candidateId || edge.target_node_id === candidateId;
      const touchesPath = pathIds.has(edge.source_node_id) || pathIds.has(edge.target_node_id);
      if (!touchesCandidate || !touchesPath) {
        continue;
      }
      score += scoreTextMatch(queryTerms, [edge.label]) * 18;
    }

    if (directNeighbors.has(candidateId)) {
      score += 10;
    }

    if (suggestedIds.has(candidateId)) {
      score += 4;
    }

    if (score > 0) {
      candidateScores.set(candidateId, score);
    }
  }

  return [...candidateScores.keys()]
    .sort((leftId, rightId) => {
      const leftScore = candidateScores.get(leftId) ?? 0;
      const rightScore = candidateScores.get(rightId) ?? 0;
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return leftId.localeCompare(rightId);
    })
    .slice(0, 6);
}

function layoutExplorationDocument(
  document: CanvasDocument,
  session: ExplorationSession,
  visibleNodeIds: string[],
  suggestedNodes: CanvasNode[],
  customMatches: CanvasNode[],
) {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node] as const));
  const positions = new Map<string, { x: number; y: number }>();
  const pathY = 244;
  const pathStartX = 84;
  const pathStepX = 300;

  session.pathNodeIds.forEach((nodeId, index) => {
    positions.set(nodeId, { x: pathStartX + index * pathStepX, y: pathY });
  });

  const activeX = pathStartX + Math.max(session.pathNodeIds.length - 1, 0) * pathStepX;
  const suggestionX = activeX + 336;
  suggestedNodes.forEach((node, index) => {
    positions.set(node.id, { x: suggestionX, y: 88 + index * 184 });
  });

  const customBaseY = suggestedNodes.length > 0 ? 88 + suggestedNodes.length * 184 + 44 : 88;
  customMatches.forEach((node, index) => {
    positions.set(node.id, { x: suggestionX, y: customBaseY + index * 184 });
  });

  const nodes = visibleNodeIds
    .map((nodeId) => nodesById.get(nodeId) ?? null)
    .filter((node): node is CanvasNode => Boolean(node))
    .map((node) => {
      const position = positions.get(node.id) ?? { x: 84, y: 88 };
      return {
        ...node,
        x: position.x,
        y: position.y,
      };
    });

  const visibleNodeIdSet = new Set(visibleNodeIds);
  const edges = document.edges.filter(
    (edge) => visibleNodeIdSet.has(edge.source_node_id) && visibleNodeIdSet.has(edge.target_node_id),
  );

  return {
    ...document,
    nodes,
    edges,
  };
}

function getNeighborNodeIds(document: CanvasDocument, nodeId: string) {
  const neighbors = new Set<string>();
  for (const edge of document.edges) {
    if (edge.source_node_id === nodeId) {
      neighbors.add(edge.target_node_id);
    }
    if (edge.target_node_id === nodeId) {
      neighbors.add(edge.source_node_id);
    }
  }
  return [...neighbors];
}

function uniqueNodeIds(nodeIds: string[]) {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const nodeId of nodeIds) {
    if (seen.has(nodeId)) {
      continue;
    }
    seen.add(nodeId);
    ordered.push(nodeId);
  }
  return ordered;
}

function scoreTextMatch(terms: string[], values: string[]) {
  const haystack = values.join(" ").toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function buildSelectedNoteContext(document: CanvasDocument | null, focusNodeIds: string[]) {
  if (!document || document.nodes.length === 0) {
    return undefined;
  }

  const nodes = rankRelevantNotes(document, focusNodeIds).slice(0, 12);
  const selectedRelationLines = focusNodeIds.flatMap((nodeId) => describeRelevantEdges(document, nodeId));

  const noteBlocks = nodes
    .slice(0, 12)
    .map((node) => {
      const tags = node.tags.length > 0 ? node.tags.join(", ") : "untagged";
      const files = node.linked_files.length > 0 ? node.linked_files.join(", ") : "none";
      const symbols = node.linked_symbols.length > 0 ? node.linked_symbols.join(", ") : "none";
      return [
        `Note: ${node.title}`,
        `Tags: ${tags}`,
        `Files: ${files}`,
        `Symbols: ${symbols}`,
        `Summary: ${summarizeNote(node.description)}`,
      ].join("\n");
    })
    .join("\n\n");

  if (selectedRelationLines.length === 0) {
    return noteBlocks;
  }

  return [noteBlocks, "Relevant note relationships:", ...selectedRelationLines].join("\n\n");
}

function buildConversationContext(messages: ConversationMessage[]) {
  if (messages.length === 0) {
    return undefined;
  }

  return messages
    .slice(-8)
    .map((message) => {
      const title = message.title?.trim() ? ` [${message.title.trim()}]` : "";
      return `${message.role.toUpperCase()}${title}: ${message.content.trim()}`;
    })
    .join("\n\n");
}

function buildCanvasSetupPrompt(repoPath: string, visibleFileCount: number) {
  const projectName = PathLabel(repoPath);
  return [
    `Map the existing project "${projectName}" into a compact visual workspace.`,
    "Create a clean architecture map for the current codebase, not a speculative redesign.",
    "Represent business logic and architecture with only the most relevant implementation details.",
    "Prefer nodes for domain areas, workflows, UI surfaces, stateful areas, boundaries, integrations, and policies.",
    `The repository currently has about ${visibleFileCount} visible project file${visibleFileCount === 1 ? "" : "s"}.`,
  ].join(" ");
}

function rankRelevantNotes(document: CanvasDocument, focusNodeIds: string[]) {
  return [...document.nodes].sort((left, right) => {
    const leftScore = scoreNote(document, left, focusNodeIds);
    const rightScore = scoreNote(document, right, focusNodeIds);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return left.title.localeCompare(right.title);
  });
}

function scoreNote(document: CanvasDocument, node: CanvasNode, focusNodeIds: string[]) {
  let score =
    node.linked_files.length * 5 +
    node.linked_symbols.length * 6 +
    node.tags.length * 2 +
    Math.min(node.description.trim().length, 220) / 55;

  for (const focusedNodeId of focusNodeIds) {
    if (node.id === focusedNodeId) {
      score += 100;
    }
  }

  for (const focusedNodeId of focusNodeIds) {
    for (const edge of document.edges) {
      const touchesSelected =
        edge.source_node_id === focusedNodeId || edge.target_node_id === focusedNodeId;
      const touchesCurrent = edge.source_node_id === node.id || edge.target_node_id === node.id;
      if (!touchesSelected || !touchesCurrent) {
        continue;
      }
      score += 24;
      if (edge.label.trim()) {
        score += 4;
      }
    }
  }

  return score;
}

function describeRelevantEdges(document: CanvasDocument, selectedNodeId: string) {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node] as const));
  return document.edges
    .filter((edge) => edge.source_node_id === selectedNodeId || edge.target_node_id === selectedNodeId)
    .map((edge) => {
      const source = nodesById.get(edge.source_node_id);
      const target = nodesById.get(edge.target_node_id);
      if (!source || !target) {
        return null;
      }
      const label = edge.label.trim() || "connects to";
      return `${source.title} --${label}--> ${target.title}`;
    })
    .filter((value): value is string => Boolean(value));
}

function summarizeNote(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "No description yet.";
  }
  const collapsed = trimmed.replace(/\s+/g, " ");
  return collapsed.length > 120 ? `${collapsed.slice(0, 117).trim()}...` : collapsed;
}

function renderConsoleMessageContent(
  content: string,
  document: CanvasDocument | null,
  onOpenNode: (nodeId: string) => void,
) {
  if (!document || document.nodes.length === 0) {
    return content;
  }

  const titleToId = new Map(
    document.nodes
      .filter((node) => node.title.trim())
      .map((node) => [node.title.trim(), node.id] as const),
  );
  const titles = [...titleToId.keys()].sort((left, right) => right.length - left.length);
  if (titles.length === 0) {
    return content;
  }

  const pattern = new RegExp(`\\b(${titles.map(escapeRegExp).join("|")})\\b`, "g");
  const lines = content.split("\n");

  return lines.map((line, lineIndex) => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(line)) !== null) {
      const [matchedText] = match;
      const start = match.index;
      if (start > lastIndex) {
        parts.push(line.slice(lastIndex, start));
      }
      const nodeId = titleToId.get(matchedText.trim());
      if (nodeId) {
        parts.push(
          <button
            className={styles.consoleNoteLink}
            key={`${lineIndex}-${start}-${matchedText}`}
            onClick={() => onOpenNode(nodeId)}
            type="button"
          >
            {matchedText}
          </button>,
        );
      } else {
        parts.push(matchedText);
      }
      lastIndex = start + matchedText.length;
    }

    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex));
    }
    if (parts.length === 0) {
      parts.push(line);
    }

    return (
      <span key={`line-${lineIndex}`}>
        {parts}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </span>
    );
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Request failed";
}

function statusTone(status: StatusResponse["index_job"]["status"] | undefined): "ok" | "error" | "muted" {
  if (status === "completed") {
    return "ok";
  }
  if (status === "failed") {
    return "error";
  }
  return "muted";
}
