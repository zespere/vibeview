"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import styles from "./page.module.css";
import { CanvasBoard } from "@/components/canvas-board";
import {
  API_BASE_URL,
  createCanvasNode,
  createProjectCommit,
  deleteCanvasNode,
  fetchExplorationSuggestions,
  fetchCanvas,
  fetchCommitStatus,
  fetchProjectConversation,
  fetchProjectsTree,
  fetchProject,
  fetchProjectWorkspaceStatus,
  fetchProjectAgents,
  fetchStatus,
  createProjectConversation,
  generateCanvasFromPrompt,
  streamProjectRun,
  resetCanvas,
  updateProject,
  updateProjectConversation,
  updateProjectAgents,
  updateCanvasNode,
  type AgentsDocumentResponse,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type CommitStatusResponse,
  type ConversationMessage,
  type ConversationSummary,
  type ExplorationContextNode,
  type ExplorationSuggestionRecord,
  type ProjectProfile,
  type ProjectTreeItem,
  type ProjectWorkspaceStatusResponse,
  type StatusResponse,
  type ProjectRunStreamEvent,
} from "@/lib/api";

type WorkspaceView = "notes" | "project";
type OpenTab =
  | { id: `view:${WorkspaceView}`; type: "view"; view: WorkspaceView; preview: boolean }
  | { id: `note:${string}`; type: "note"; nodeId: string }
  | { id: `explore:${string}`; type: "exploration"; explorationId: string };

const RAIL_VIEW_ITEMS: Array<{ id: WorkspaceView; label: string }> = [
  { id: "notes", label: "Notes" },
  { id: "project", label: "Project" },
];

interface CommandResultItem {
  id: string;
  title: string;
  subtitle?: string;
  group: "navigate" | "action" | "ask" | "execute";
  run: () => void;
}

interface ExplorationSuggestion {
  id: string;
  displayNodeId: string;
  title: string;
  summary: string;
  edgeLabel: string;
}

interface ExplorationSuggestionState {
  key: string;
  loading: boolean;
  error: string | null;
  kind: "suggestions" | "relation" | null;
  neededCount: number;
  suggestions: ExplorationSuggestion[];
}

interface ExplorationBranch {
  id: string;
  rootNodeId: string;
  activeNodeId: string | null;
  pathNodeIds: string[];
  revealedNodeIds: string[];
  suggestionsByNodeId: Record<string, ExplorationSuggestion[]>;
  transientNodes: CanvasNode[];
  transientEdges: CanvasEdge[];
  relationQuery: string;
  summaryPosition: { x: number; y: number };
}

interface ExplorationPresentation {
  activeNode: CanvasNode | null;
  displayDocument: CanvasDocument | null;
  pathNodes: CanvasNode[];
  suggestedNodes: ExplorationSuggestion[];
  visibleNodeIds: string[];
}

type ComposerRunMode = "auto" | "build" | "plan";
type ComposerReasoningEffort = "low" | "medium" | "high" | "xhigh";
type DockVisibilityState = "hidden" | "visible";
type ConsoleVisibilityState = "collapsed" | "expanded";

const GPT_MODEL_OPTIONS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
];

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
  const [codexPrompt, setCodexPrompt] = useState("");
  const [composerModel, setComposerModel] = useState("gpt-5.4");
  const [composerReasoning, setComposerReasoning] = useState<ComposerReasoningEffort>("medium");
  const [composerMode, setComposerMode] = useState<ComposerRunMode>("auto");
  const [composerStatus, setComposerStatus] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGeneratingCanvas, setIsGeneratingCanvas] = useState(false);
  const [commitStatus, setCommitStatus] = useState<CommitStatusResponse | null>(null);
  const [dockVisibility, setDockVisibility] = useState<DockVisibilityState>("visible");
  const [consoleVisibility, setConsoleVisibility] = useState<ConsoleVisibilityState>("collapsed");
  const [dockOffset, setDockOffset] = useState({ x: 0, y: 0 });
  const [isDockDragging, setIsDockDragging] = useState(false);
  const [isProjectTrayExpanded, setIsProjectTrayExpanded] = useState(false);
  const [isNoteSidebarCollapsed, setIsNoteSidebarCollapsed] = useState(false);
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
  const [expandedCanvasNodeId, setExpandedCanvasNodeId] = useState<string | null>(null);
  const [notesExploration, setNotesExploration] = useState<ExplorationBranch | null>(null);
  const [explorationBranches, setExplorationBranches] = useState<Record<string, ExplorationBranch>>({});
  const [explorationTabs, setExplorationTabs] = useState<Record<string, ExplorationBranch>>({});
  const [explorationSuggestionStates, setExplorationSuggestionStates] = useState<Record<string, ExplorationSuggestionState>>({});
  const [openCanvasNodeIds, setOpenCanvasNodeIds] = useState<string[]>([]);
  const [canvasDraftTitle, setCanvasDraftTitle] = useState("");
  const [canvasDraftDescription, setCanvasDraftDescription] = useState("");
  const [canvasDraftTags, setCanvasDraftTags] = useState("");
  const [canvasDraftFiles, setCanvasDraftFiles] = useState("");
  const [canvasDraftSymbols, setCanvasDraftSymbols] = useState("");
  const [pinnedCanvasNodeIds, setPinnedCanvasNodeIds] = useState<string[]>([]);
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const consoleMessagesRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const commandResultRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const expectedRepoPathRef = useRef("");
  const explorationSuggestionStatesRef = useRef<Record<string, ExplorationSuggestionState>>({});
  const dockDragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  const [statusPending, startStatusTransition] = useTransition();
  const [projectPending, startProjectTransition] = useTransition();
  const [agentsPending, startAgentsTransition] = useTransition();
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

  useEffect(() => {
    if (activeTab?.type === "note") {
      setDockVisibility("hidden");
      setConsoleVisibility("collapsed");
      return;
    }
    if (activeView === "project") {
      setDockVisibility("hidden");
      setConsoleVisibility("collapsed");
      return;
    }
    setDockVisibility("visible");
    setConsoleVisibility("collapsed");
  }, [activeTab?.type, activeView]);

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
  const shouldShowCanvasSetup =
    !!canvasDocument &&
    canvasDocument.nodes.length === 0 &&
    !!activeRepoPath &&
    workspaceStatus?.repo_path === activeRepoPath &&
    workspaceStatus.has_project_files;
  const isSlashCommandMode = codexPrompt.trim().startsWith("/");
  const commandQuery = isSlashCommandMode ? codexPrompt.trim().slice(1).trim() : "";
  const isComposerBusy = isBuilding || isPlanning || isAnswering || codexPending;
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
    if (isAnswering) {
      return "Working through the request...";
    }
    if (composerStatus) {
      return composerStatus;
    }
    if (activeConversationSummary) {
      return activeConversationSummary.title;
    }
    return consoleMessages.at(-1)?.title ?? "Ready to build in this project.";
  }, [activeConversationSummary, composerStatus, consoleMessages, isAnswering, isBuilding, isPlanning]);
  const availableComposerModels = useMemo(() => {
    const items = [status?.codex_model, composerModel, ...GPT_MODEL_OPTIONS];
    return [...new Set(items.filter((item): item is string => Boolean(item && item.trim())))];
  }, [composerModel, status?.codex_model]);
  const notesExplorationPresentation = useMemo(
    () =>
      buildExplorationPresentation(
        canvasDocument,
        notesExploration,
        notesExploration ? getActiveExplorationSuggestions(notesExploration) : [],
        notesExploration ? explorationSuggestionStates[notesExploration.id] ?? null : null,
      ),
    [canvasDocument, explorationSuggestionStates, notesExploration],
  );
  const activeExplorationPresentation = useMemo(
    () =>
      buildExplorationPresentation(
        canvasDocument,
        activeExplorationSession,
        activeExplorationSession ? getActiveExplorationSuggestions(activeExplorationSession) : [],
        activeExplorationSession ? explorationSuggestionStates[activeExplorationSession.id] ?? null : null,
      ),
    [activeExplorationSession, canvasDocument, explorationSuggestionStates],
  );
  const overviewCanvasDocument = useMemo(
    () => buildOverviewCanvasDocument(canvasDocument, explorationBranches),
    [canvasDocument, explorationBranches],
  );
  const notesCanvasDocument = useMemo(
    () => applyExpandedNodeLayout(notesExplorationPresentation.displayDocument ?? overviewCanvasDocument, expandedCanvasNodeId),
    [expandedCanvasNodeId, notesExplorationPresentation.displayDocument, overviewCanvasDocument],
  );
  const explorationCanvasDocument = useMemo(
    () => applyExpandedNodeLayout(activeExplorationPresentation.displayDocument, expandedCanvasNodeId),
    [activeExplorationPresentation.displayDocument, expandedCanvasNodeId],
  );
  const activeContextDocument = useMemo(
    () => buildExplorationContextDocument(canvasDocument, currentExplorationSession),
    [canvasDocument, currentExplorationSession],
  );
  const notesExplorationControls = notesExploration
    ? {
        activeNodeId: notesExploration.activeNodeId,
        pathTitles: notesExplorationPresentation.pathNodes.map((node) => node.title),
        relationQuery: notesExploration.relationQuery,
        persistent: false as const,
        onRelationQueryChange: (value: string) =>
          handleExplorationRelationQueryChange(notesExploration.id, value),
        onRelationSubmit: () => {
          void materializeRelationQuery(notesExploration, notesExploration.relationQuery);
        },
        onReturnToOverview: collapseNotesExploration,
      }
    : null;
  const activeExplorationControls = activeExplorationSession
    ? {
        activeNodeId: activeExplorationSession.activeNodeId,
        pathTitles: activeExplorationPresentation.pathNodes.map((node) => node.title),
        relationQuery: activeExplorationSession.relationQuery,
        persistent: true as const,
        onRelationQueryChange: (value: string) =>
          handleExplorationRelationQueryChange(activeExplorationSession.id, value, { persistent: true }),
        onRelationSubmit: () => {
          void materializeRelationQuery(
            activeExplorationSession,
            activeExplorationSession.relationQuery,
            { persistent: true },
          );
        },
      }
    : null;

  useEffect(() => {
    expectedRepoPathRef.current = activeRepoPath;
  }, [activeRepoPath]);

  useEffect(() => {
    startStatusTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const nextStatus = await fetchStatus();
          setStatus(nextStatus);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
    startProjectTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await fetchProject();
          setProject(response.project);
          if (response.project.repo_path) {
            try {
              const commitResponse = await fetchCommitStatus(response.project.repo_path);
              setCommitStatus(commitResponse);
            } catch (error) {
              setCommitStatus(null);
              setErrorMessage(getErrorMessage(error));
            }
          } else {
            setCommitStatus(null);
          }
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
    startProjectTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await fetchProjectsTree();
          setProjectsTree(response.projects);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
    startCanvasTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await fetchCanvas();
          setCanvasDocument(response.document);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
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
    if (!isDockDragging) {
      return;
    }

    function handleMouseMove(event: MouseEvent) {
      const dragStart = dockDragStartRef.current;
      if (!dragStart) {
        return;
      }

      setDockOffset({
        x: dragStart.offsetX + (event.clientX - dragStart.x),
        y: dragStart.offsetY + (event.clientY - dragStart.y),
      });
    }

    function handleMouseUp() {
      setIsDockDragging(false);
      dockDragStartRef.current = null;
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDockDragging]);

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
      setExplorationBranches({});
      setExplorationSuggestionStates({});
      return;
    }
    const repoPathValue = project.repo_path;
    startAgentsTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await fetchProjectAgents(repoPathValue || undefined);
          if (repoPathValue && expectedRepoPathRef.current && expectedRepoPathRef.current !== repoPathValue) {
            return;
          }
          setAgentsDocument(response);
          setAgentsContent(response.content);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
    startCanvasTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await fetchCanvas(repoPathValue);
          if (expectedRepoPathRef.current && expectedRepoPathRef.current !== repoPathValue) {
            return;
          }
          setCanvasDocument(response.document);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
    startProjectTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await fetchProjectsTree();
          setProjectsTree(response.projects);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
    void (async () => {
      try {
        const response = await fetchCommitStatus(repoPathValue);
        if (expectedRepoPathRef.current && expectedRepoPathRef.current !== repoPathValue) {
          return;
        }
        setCommitStatus(response);
      } catch (error) {
        setCommitStatus(null);
        setErrorMessage(getErrorMessage(error));
      }
    })();
    void (async () => {
      try {
        const response = await fetchProjectWorkspaceStatus(repoPathValue);
        if (expectedRepoPathRef.current && expectedRepoPathRef.current !== repoPathValue) {
          return;
        }
        setWorkspaceStatus(response);
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
      }
    })();
  }, [project?.repo_path]);

  useEffect(() => {
    setExplorationBranches(readStoredExplorationBranches(activeRepoPath));
    setExplorationSuggestionStates({});
    setExpandedCanvasNodeId(null);
  }, [activeRepoPath]);

  useEffect(() => {
    if (!activeRepoPath) {
      return;
    }
    writeStoredExplorationBranches(activeRepoPath, explorationBranches);
  }, [activeRepoPath, explorationBranches]);

  useEffect(() => {
    if (!expandedCanvasNodeId) {
      return;
    }
    const visibleNodeIds = new Set<string>([
      ...(notesCanvasDocument?.nodes.map((node) => node.id) ?? []),
      ...(explorationCanvasDocument?.nodes.map((node) => node.id) ?? []),
    ]);
    if (visibleNodeIds.size > 0 && !visibleNodeIds.has(expandedCanvasNodeId)) {
      setExpandedCanvasNodeId(null);
    }
  }, [expandedCanvasNodeId, explorationCanvasDocument, notesCanvasDocument]);

  useEffect(() => {
    if (!activeRepoPath || !canvasDocument || !currentExplorationSession) {
      return;
    }

    const branchDocument = buildExplorationContextDocument(canvasDocument, currentExplorationSession);
    if (!branchDocument) {
      return;
    }
    const activeNode = buildExplorationContextNode(branchDocument, currentExplorationSession);
    if (!activeNode) {
      return;
    }
    const currentNodeId = currentExplorationSession.activeNodeId ?? currentExplorationSession.rootNodeId;
    const currentSuggestions = currentExplorationSession.suggestionsByNodeId?.[currentNodeId] ?? [];
    const neededSuggestionCount = Math.max(0, 3 - currentSuggestions.length);
    if (neededSuggestionCount === 0) {
      return;
    }

    const requestKey = buildExplorationSuggestionKey(currentExplorationSession);
    const existingState = explorationSuggestionStatesRef.current[currentExplorationSession.id];
    if (
      existingState?.key === requestKey &&
      (existingState.loading || existingState.error !== null)
    ) {
      return;
    }

    let cancelled = false;
    const applySuggestions = (suggestions: ExplorationSuggestion[]) => {
      const branchId = currentExplorationSession.id;
      const sourceNodeId = currentNodeId;
      setExplorationTabs((current) => {
        const branch = current[branchId];
        if (!branch) {
          return current;
        }
        const next = {
          ...branch,
          suggestionsByNodeId: {
            ...(branch.suggestionsByNodeId ?? {}),
            [sourceNodeId]: suggestions,
          },
        };
        return areExplorationBranchesEqual(branch, next)
          ? current
          : {
              ...current,
              [branchId]: next,
            };
      });
      setNotesExploration((current) => {
        if (!current || current.id !== branchId) {
          return current;
        }
        const next = {
          ...current,
          suggestionsByNodeId: {
            ...(current.suggestionsByNodeId ?? {}),
            [sourceNodeId]: suggestions,
          },
        };
        return areExplorationBranchesEqual(current, next) ? current : next;
      });
    };

    setExplorationSuggestionStates((current) => ({
      ...current,
      [currentExplorationSession.id]: {
        key: requestKey,
        loading: true,
        error: null,
        kind: "suggestions",
        neededCount: neededSuggestionCount,
        suggestions: current[currentExplorationSession.id]?.key === requestKey ? current[currentExplorationSession.id].suggestions : [],
      },
    }));

    void fetchExplorationSuggestions(
      activeRepoPath,
      activeNode,
      buildExplorationPathTitles(branchDocument, currentExplorationSession),
      buildSelectedNoteContext(branchDocument, currentExplorationSession.pathNodeIds),
      undefined,
      undefined,
      neededSuggestionCount,
    )
      .then((response) => {
        if (cancelled) {
          return;
        }
        const filteredSuggestions = mergeExplorationSuggestions(
          currentSuggestions,
          response.suggestions.map((suggestion, index) =>
            toExplorationSuggestion(currentExplorationSession.id, suggestion, currentSuggestions.length + index),
          ),
          branchDocument,
          currentExplorationSession,
        );
        applySuggestions(filteredSuggestions);
        setExplorationSuggestionStates((current) => ({
          ...current,
          [currentExplorationSession.id]: {
            key: requestKey,
            loading: false,
            error: null,
            kind: null,
            neededCount: 0,
            suggestions: [],
          },
        }));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        const fallbackSuggestions = mergeExplorationSuggestions(
          currentSuggestions,
          buildFallbackExplorationSuggestions(activeNode.title).map((suggestion, index) =>
            toExplorationSuggestion(currentExplorationSession.id, suggestion, currentSuggestions.length + index),
          ),
          branchDocument,
          currentExplorationSession,
        );
        applySuggestions(fallbackSuggestions);
        setExplorationSuggestionStates((current) => ({
          ...current,
          [currentExplorationSession.id]: {
            key: requestKey,
            loading: false,
            error: null,
            kind: null,
            neededCount: 0,
            suggestions: [],
          },
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeRepoPath,
    canvasDocument,
    currentExplorationSession,
    currentExplorationSession?.activeNodeId,
    currentExplorationSession?.id,
    currentExplorationSession?.pathNodeIds,
    currentExplorationSession?.rootNodeId,
  ]);

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
    const isAnyDockExpanded = dockVisibility === "visible" && consoleVisibility === "expanded";
    if (!isAnyDockExpanded) {
      return;
    }
    const container = consoleMessagesRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [consoleMessages, consoleVisibility, dockVisibility]);

  useEffect(() => {
    resizeComposerInput(composerInputRef.current);
  }, [codexPrompt]);

  useEffect(() => {
    if (status?.codex_model) {
      setComposerModel((current) => (current === "gpt-5.4" ? status.codex_model! : current));
    }
  }, [status?.codex_model]);

  useEffect(() => {
    if (!activeRepoPath) {
      return;
    }
    try {
      const rawValue = window.localStorage.getItem(`konceptura:project-tray:${activeRepoPath}`);
      if (rawValue === "1") {
        setIsProjectTrayExpanded(true);
        return;
      }
      if (rawValue === "0") {
        setIsProjectTrayExpanded(false);
      }
    } catch {
      // Ignore storage errors and keep default UI state.
    }
  }, [activeRepoPath]);

  useEffect(() => {
    if (!activeRepoPath) {
      return;
    }
    try {
      window.localStorage.setItem(`konceptura:project-tray:${activeRepoPath}`, isProjectTrayExpanded ? "1" : "0");
    } catch {
      // Ignore storage errors and keep the project page usable.
    }
  }, [activeRepoPath, isProjectTrayExpanded]);

  useEffect(() => {
    explorationSuggestionStatesRef.current = explorationSuggestionStates;
  }, [explorationSuggestionStates]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const isTypingIntoField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDockVisibility("visible");
        setConsoleVisibility("expanded");
        window.setTimeout(() => {
          composerInputRef.current?.focus();
          composerInputRef.current?.setSelectionRange(
            composerInputRef.current.value.length,
            composerInputRef.current.value.length,
          );
        }, 0);
        return;
      }

      if (
        event.key === "/" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTypingIntoField
      ) {
        event.preventDefault();
        setDockVisibility("visible");
        setConsoleVisibility("expanded");
        setCodexPrompt((current) => (current.trim() ? current : "/"));
        window.setTimeout(() => {
          composerInputRef.current?.focus();
          const value = composerInputRef.current?.value ?? "/";
          composerInputRef.current?.setSelectionRange(value.length, value.length);
        }, 0);
        return;
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "n" &&
        activeTab?.type === "view" &&
        activeTab.view === "notes" &&
        notesExploration &&
        canvasDocument
      ) {
        event.preventDefault();
        const promotedBranch = {
          ...notesExploration,
          id: `saved-${Date.now()}`,
          pathNodeIds: [...notesExploration.pathNodeIds],
          revealedNodeIds: [...notesExploration.revealedNodeIds],
          suggestionsByNodeId: Object.fromEntries(
            Object.entries(notesExploration.suggestionsByNodeId ?? {}).map(([nodeId, suggestions]) => [
              nodeId,
              [...suggestions],
            ]),
          ),
          transientNodes: [...notesExploration.transientNodes],
          transientEdges: [...notesExploration.transientEdges],
        };
        setExplorationBranches((current) => ({
          ...current,
          [promotedBranch.id]: promotedBranch,
        }));
        setExplorationTabs((current) => ({
          ...current,
          [promotedBranch.id]: promotedBranch,
        }));
        setOpenTabs((current) =>
          current.some((tab) => tab.id === `explore:${promotedBranch.id}`)
            ? current
            : [...current, { id: `explore:${promotedBranch.id}`, type: "exploration", explorationId: promotedBranch.id }],
        );
        setActiveTabId(`explore:${promotedBranch.id}`);
        setComposerStatus(`Opened an exploration tab for ${findCanvasNodeTitle(canvasDocument, promotedBranch.rootNodeId)}.`);
        return;
      }

    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, activeView, canvasDocument, codexPrompt, notesExploration]);

  useEffect(() => {
    setCommandSelectedIndex(0);
  }, [codexPrompt]);

  useEffect(() => {
    if (isSlashCommandMode) {
      setDockVisibility("visible");
      setConsoleVisibility("expanded");
    }
  }, [isSlashCommandMode]);

  useEffect(() => {
    if (!canvasDocument) {
      return;
    }

    const validNodeIds = new Set(canvasDocument.nodes.map((node) => node.id));
    const explorationNodeIds = new Set<string>([
      ...(notesExploration?.transientNodes.map((node) => node.id) ?? []),
      ...Object.values(explorationTabs).flatMap((branch) => branch.transientNodes.map((node) => node.id)),
      ...Object.values(explorationBranches).flatMap((branch) => branch.transientNodes.map((node) => node.id)),
    ]);
    setPinnedCanvasNodeIds((current) => {
      const next = current.filter((nodeId) => validNodeIds.has(nodeId));
      return current.length === next.length && current.every((nodeId, index) => nodeId === next[index]) ? current : next;
    });
    setOpenCanvasNodeIds((current) => {
      const next = current.filter((nodeId) => validNodeIds.has(nodeId));
      return current.length === next.length && current.every((nodeId, index) => nodeId === next[index]) ? current : next;
    });
    setOpenTabs((current) => {
      const next = current.filter((tab) => {
        if (tab.type === "view") {
          return true;
        }
        if (tab.type === "note") {
          return validNodeIds.has(tab.nodeId);
        }
        return true;
      });
      return current.length === next.length && current.every((tab, index) => tab === next[index]) ? current : next;
    });
    setNotesExploration((current) => {
      const next = normalizeExplorationBranch(current, validNodeIds);
      return areExplorationBranchesEqual(current, next) ? current : next;
    });
    setExplorationBranches((current) => {
      const nextEntries = Object.entries(current)
        .map(([id, branch]) => [id, normalizeExplorationBranch(branch, validNodeIds)] as const)
        .filter((entry): entry is readonly [string, ExplorationBranch] => Boolean(entry[1]));
      const next = Object.fromEntries(nextEntries);
      return areExplorationBranchMapsEqual(current, next) ? current : next;
    });
    setExplorationTabs((current) => {
      const nextEntries = Object.entries(current)
        .map(([id, branch]) => [id, normalizeExplorationBranch(branch, validNodeIds)] as const)
        .filter((entry): entry is readonly [string, ExplorationBranch] => Boolean(entry[1]));
      const next = Object.fromEntries(nextEntries);
      return areExplorationBranchMapsEqual(current, next) ? current : next;
    });

    if (selectedCanvasNodeId && !validNodeIds.has(selectedCanvasNodeId) && !explorationNodeIds.has(selectedCanvasNodeId)) {
      const fallbackNodeId = canvasDocument.nodes[0]?.id ?? null;
      setSelectedCanvasNodeId(fallbackNodeId);
      setSelectedCanvasNodeIds(fallbackNodeId ? [fallbackNodeId] : []);
      if (fallbackNodeId) {
        setOpenCanvasNodeIds((current) =>
          current.includes(fallbackNodeId) ? current : [fallbackNodeId, ...current],
        );
      }
    }
  }, [canvasDocument, explorationBranches, explorationTabs, notesExploration, selectedCanvasNodeId]);

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
        buildSelectedNoteContext(activeContextDocument, visibleContextNodeIds),
        buildConversationContext(pendingMessages),
        composerModel,
        composerReasoning,
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

  async function submitAutoPrompt(
    promptValue = codexPrompt.trim(),
    options?: { preserveActiveView?: boolean },
  ) {
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
    setIsAnswering(true);
    if (promptValue === codexPrompt.trim()) {
      setCodexPrompt("");
    }
    setPendingPlan(null);
    let ensuredConversationId: string | null = null;

    try {
      setErrorMessage(null);
      setComposerStatus("Understanding request...");
      ensuredConversationId =
        activeConversationId && activeConversationRepoPath === activeRepoPath && activeConversationId !== "default"
          ? activeConversationId
          : await createConversationForProject(activeRepoPath, deriveConversationTitle(prompt), options);
      if (!ensuredConversationId) {
        setIsAnswering(false);
        return;
      }
      await persistConversationMessages(activeRepoPath, ensuredConversationId, pendingMessages);
      let assistantContent = "";
      const assistantId = `assistant-auto-${Date.now()}`;
      setConsoleMessages([
        ...pendingMessages,
        {
          id: assistantId,
          role: "assistant",
          title: "Working...",
          content: "",
          created_at: new Date().toISOString(),
        },
      ]);

      let finalSummary = "Done.";
      let resolvedMode: ProjectRunStreamEvent["mode"] | null = null;
      await streamProjectRun(
        activeRepoPath,
        "auto",
        prompt,
        buildSelectedNoteContext(activeContextDocument, visibleContextNodeIds),
        buildConversationContext(pendingMessages),
        composerModel,
        composerReasoning,
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
              resolvedMode = completedEvent.mode ?? resolvedMode;
              finalSummary = completedEvent.summary ?? finalSummary;
              if (completedEvent.mode === "build") {
                if (completedEvent.document) {
                  setCanvasDocument(completedEvent.document);
                }
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
              } else {
                setConsoleMessages((current) =>
                  current.map((message) =>
                    message.id === assistantId
                      ? {
                          ...message,
                          title: finalSummary,
                          content: completedEvent.answer_text ?? assistantContent,
                        }
                      : message,
                  ),
                );
              }
              setComposerStatus(finalSummary);
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
      if (resolvedMode === "build") {
        await refreshCommitStatus(activeRepoPath);
      }
    } catch (error) {
      setComposerStatus("Request failed.");
      setErrorMessage(getErrorMessage(error));
      const nextMessages = [
        ...pendingMessages,
        {
          id: `assistant-auto-error-${Date.now()}`,
          role: "assistant" as const,
          title: "Request failed.",
          content: getErrorMessage(error),
          created_at: new Date().toISOString(),
        },
      ];
      setConsoleMessages(nextMessages);
      if (ensuredConversationId) {
        await persistConversationMessages(activeRepoPath, ensuredConversationId, nextMessages);
      }
    } finally {
      setIsAnswering(false);
    }
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
      setDockVisibility("visible");
      setConsoleVisibility("expanded");
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
        buildSelectedNoteContext(activeContextDocument, visibleContextNodeIds),
        buildConversationContext(pendingMessages),
        composerModel,
        composerReasoning,
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

  function handleApprovePlan() {
    if (!pendingPlan || isBuilding || !activeRepoPath) {
      return;
    }
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
        buildSelectedNoteContext(activeContextDocument, visibleContextNodeIds),
        buildConversationContext(pendingMessages),
        composerModel,
        composerReasoning,
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

  function applySampleRepo(nextPath: string) {
    setRepoPath(nextPath);
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

  function toggleCanvasNodeExpansion(nodeId: string) {
    setExpandedCanvasNodeId((current) => (current === nodeId ? null : nodeId));
  }

  function resetCanvasNodeSize(nodeId: string) {
    setExpandedCanvasNodeId((current) => (current === nodeId ? null : current));
  }

  function collapseNotesExploration() {
    if (!notesExploration) {
      setSelectedCanvasNodeId(null);
      setSelectedCanvasNodeIds([]);
      setExpandedCanvasNodeId(null);
      return;
    }
    setExplorationBranches((current) => ({
      ...current,
      [notesExploration.id]: notesExploration,
    }));
    setNotesExploration(null);
    setSelectedCanvasNodeId(null);
    setSelectedCanvasNodeIds([]);
    setExpandedCanvasNodeId(null);
  }

  function materializeExplorationSuggestion(
    branch: ExplorationBranch,
    suggestion: ExplorationSuggestion,
    options?: { persistent?: boolean },
  ) {
    const sourceNodeId = branch.activeNodeId ?? branch.rootNodeId;
    const nextBranch = addTransientExplorationNode(
      canvasDocument,
      branch,
      sourceNodeId,
      suggestion.title,
      suggestion.summary,
      suggestion.edgeLabel,
    );
    const remainingSuggestions = (branch.suggestionsByNodeId?.[sourceNodeId] ?? []).filter(
      (item) => item.displayNodeId !== suggestion.displayNodeId,
    );
    const branchWithSuggestions = {
      ...nextBranch,
      suggestionsByNodeId: {
        ...(branch.suggestionsByNodeId ?? {}),
        [sourceNodeId]: remainingSuggestions,
      },
    };

    setSelectedCanvasNodeId(branchWithSuggestions.activeNodeId);
    setSelectedCanvasNodeIds(branchWithSuggestions.activeNodeId ? [branchWithSuggestions.activeNodeId] : []);
    setExpandedCanvasNodeId(branchWithSuggestions.activeNodeId);
    setExplorationSuggestionStates((current) => ({
      ...current,
      [branch.id]: {
        key: buildExplorationSuggestionKey(branchWithSuggestions),
        loading: false,
        error: null,
        kind: null,
        neededCount: 0,
        suggestions: [],
      },
    }));
    if (options?.persistent) {
      setExplorationTabs((current) => ({
        ...current,
        [branch.id]: branchWithSuggestions,
      }));
    } else {
      setNotesExploration(branchWithSuggestions);
    }
  }

  function findSuggestionForBranch(branch: ExplorationBranch, nodeId: string, options?: { persistent?: boolean }) {
    const presentation =
      options?.persistent
        ? activeExplorationPresentation
        : notesExplorationPresentation;
    if (!presentation || branch.id !== (options?.persistent ? activeExplorationSession?.id : notesExploration?.id)) {
      return null;
    }
    return presentation.suggestedNodes.find((suggestion) => suggestion.displayNodeId === nodeId) ?? null;
  }

  async function materializeRelationQuery(
    branch: ExplorationBranch,
    relationQuery: string,
    options?: { persistent?: boolean },
  ) {
    const query = relationQuery.trim();
    if (!query || !canvasDocument || !activeRepoPath) {
      return;
    }

    const branchDocument = buildExplorationContextDocument(canvasDocument, branch);
    if (!branchDocument) {
      return;
    }
    const activeNode = buildExplorationContextNode(branchDocument, branch);
    if (!activeNode) {
      return;
    }

    setExplorationSuggestionStates((current) => ({
      ...current,
      [branch.id]: {
        key: buildExplorationSuggestionKey(branch),
        loading: true,
        error: null,
        kind: "relation",
        neededCount: 0,
        suggestions: current[branch.id]?.suggestions ?? [],
      },
    }));

    let generatedSuggestion: ExplorationSuggestion;
    try {
      const response = await fetchExplorationSuggestions(
        activeRepoPath,
        activeNode,
        buildExplorationPathTitles(branchDocument, branch),
        buildSelectedNoteContext(branchDocument, branch.pathNodeIds),
        buildConversationContext(consoleMessages),
        query,
        1,
      );
      const firstSuggestion = response.suggestions[0];
      if (!firstSuggestion) {
        throw new Error("No exploration suggestion was returned.");
      }
      generatedSuggestion = toExplorationSuggestion(branch.id, firstSuggestion, 0);
    } catch {
      const fallbackSuggestion = buildFallbackRelationSuggestion(activeNode.title, query);
      generatedSuggestion = toExplorationSuggestion(branch.id, fallbackSuggestion, 0);
      setExplorationSuggestionStates((current) => ({
        ...current,
        [branch.id]: {
          key: buildExplorationSuggestionKey(branch),
          loading: false,
          error: null,
          kind: null,
          neededCount: 0,
          suggestions: current[branch.id]?.suggestions ?? [],
        },
      }));
    }

    let nextBranch = addTransientExplorationNode(
      canvasDocument,
      branch,
      branch.activeNodeId ?? branch.rootNodeId,
      generatedSuggestion.title,
      generatedSuggestion.summary,
      generatedSuggestion.edgeLabel,
    );
    nextBranch = {
      ...nextBranch,
      relationQuery: "",
    };

    setSelectedCanvasNodeId(nextBranch.activeNodeId);
    setSelectedCanvasNodeIds(nextBranch.activeNodeId ? [nextBranch.activeNodeId] : []);
    setExpandedCanvasNodeId(nextBranch.activeNodeId);
    if (options?.persistent) {
      setExplorationTabs((current) => ({
        ...current,
        [branch.id]: nextBranch,
      }));
    } else {
      setNotesExploration(nextBranch);
    }
    setExplorationSuggestionStates((current) => ({
      ...current,
      [branch.id]: {
        key: buildExplorationSuggestionKey(nextBranch),
        loading: false,
        error: null,
        kind: null,
        neededCount: 0,
        suggestions: [],
      },
    }));
  }

  function handleExplorationSelection(
    branch: ExplorationBranch,
    nodeIds: string[],
    options?: { persistent?: boolean },
  ) {
    if (nodeIds.length === 0) {
      if (options?.persistent) {
        return;
      }
      collapseNotesExploration();
      return;
    }

    if (nodeIds.length !== 1) {
      return;
    }

    const nextNodeId = nodeIds[0];
    const suggestion = findSuggestionForBranch(branch, nextNodeId, options);
    if (suggestion) {
      materializeExplorationSuggestion(branch, suggestion, options);
      return;
    }
    const nextBranch = advanceExplorationBranch(branch, nextNodeId);
    setSelectedCanvasNodeId((current) => (current === nextNodeId ? current : nextNodeId));
    setSelectedCanvasNodeIds((current) =>
      current.length === 1 && current[0] === nextNodeId ? current : [nextNodeId],
    );
    setExpandedCanvasNodeId(nextNodeId);

    if (options?.persistent) {
      setExplorationTabs((current) => ({
        ...current,
        [branch.id]: nextBranch,
      }));
    } else {
      setNotesExploration(nextBranch);
    }
  }

  function handleExplorationRelationQueryChange(
    sessionId: string,
    value: string,
    options?: { persistent?: boolean },
  ) {
    if (options?.persistent) {
      setExplorationTabs((current) => {
        const branch = current[sessionId];
        if (!branch) {
          return current;
        }
        return {
          ...current,
          [sessionId]: { ...branch, relationQuery: value },
        };
      });
      return;
    }

    setNotesExploration((current) => (current && current.id === sessionId ? { ...current, relationQuery: value } : current));
  }

  function handleOpenContextNode(nodeId: string) {
    const branchId = parseBranchSummaryNodeId(nodeId);
    if (branchId) {
      const branch = explorationBranches[branchId];
      if (branch) {
        setNotesExploration(branch);
        setSelectedCanvasNodeId(branch.activeNodeId ?? branch.rootNodeId);
        setSelectedCanvasNodeIds(branch.activeNodeId ? [branch.activeNodeId] : []);
        setExpandedCanvasNodeId(branch.activeNodeId ?? branch.rootNodeId);
      }
      return;
    }

    if (isTransientExplorationNodeId(nodeId)) {
      if (activeTab?.type === "exploration" && activeExplorationSession) {
        handleExplorationSelection(activeExplorationSession, [nodeId], { persistent: true });
        return;
      }
      if (notesExploration) {
        handleExplorationSelection(notesExploration, [nodeId]);
        return;
      }
    }

    openCanvasNode(nodeId);
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
    if (activeTab?.type === "view" && activeTab.view === "notes" && !notesExploration && nodeIds.length === 1) {
      const branchId = parseBranchSummaryNodeId(nodeIds[0]);
      if (branchId) {
        const branch = explorationBranches[branchId];
      if (branch) {
        setNotesExploration(branch);
        setSelectedCanvasNodeId(branch.activeNodeId ?? branch.rootNodeId);
        setSelectedCanvasNodeIds(branch.activeNodeId ? [branch.activeNodeId] : []);
        setExpandedCanvasNodeId(branch.activeNodeId ?? branch.rootNodeId);
      }
      return;
    }
    }

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

    if (activeTab?.type === "view" && activeTab.view === "notes") {
      if (nodeIds.length === 1 && canvasDocument?.nodes.some((node) => node.id === nodeIds[0])) {
        setExpandedCanvasNodeId(nodeIds[0]);
        setNotesExploration((current) => {
          if (!current) {
            return createExplorationBranch(nodeIds[0], canvasDocument);
          }
          return advanceExplorationBranch(current, nodeIds[0]);
        });
      } else if (nodeIds.length === 0) {
        collapseNotesExploration();
      }
    }
  }

  const commandResults: CommandResultItem[] = (() => {
    if (!isSlashCommandMode) {
      return [];
    }

    const loweredCommand = commandQuery.toLowerCase();
    const buildPrompt = loweredCommand.startsWith("build ") ? commandQuery.slice(6).trim() : "";
    const planPrompt = loweredCommand.startsWith("plan ") ? commandQuery.slice(5).trim() : "";

    if (buildPrompt) {
      return [
        {
          id: "execute-build",
          title: `Build: ${buildPrompt}`,
          subtitle: "Implement changes and refresh the canvas afterward",
          group: "execute",
          run: () => {
            setCodexPrompt("");
            setDockVisibility("visible");
            setConsoleVisibility("expanded");
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
          subtitle: "Draft an implementation plan in the current conversation",
          group: "execute",
          run: () => {
            setCodexPrompt("");
            setDockVisibility("visible");
            setConsoleVisibility("expanded");
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
        subtitle: "Add a new note to the current canvas",
        group: "action",
        keywords: ["create", "note", "new"],
        enabled: !!activeRepoPath,
        run: () => {
          setCodexPrompt("");
          startCanvasTransition(() => {
            void handleCreateCanvasNodeAt();
          });
        },
      },
      {
        id: "action-setup-canvas",
        title: canvasDocument?.nodes.length ? "Regenerate canvas" : "Set up canvas",
        subtitle: "Map the current project into canvas notes",
        group: "action",
        keywords: ["canvas", "map", "generate", "setup", "regenerate"],
        enabled: !!activeRepoPath,
        run: () => {
          setCodexPrompt("");
          startCanvasTransition(() => {
            void handleGenerateCanvas();
          });
        },
      },
      {
        id: "action-reset-canvas",
        title: "Reset canvas",
        subtitle: "Clear all notes for the current project",
        group: "action",
        keywords: ["canvas", "reset", "clear"],
        enabled: !!activeRepoPath,
        run: () => {
          setCodexPrompt("");
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
          setCodexPrompt("");
          handleCommitClick();
        },
      },
      {
        id: "action-new-conversation",
        title: "New conversation",
        subtitle: "Start a new project conversation",
        group: "action",
        keywords: ["conversation", "chat", "new"],
        enabled: !!activeRepoPath,
        run: () => {
          setCodexPrompt("");
          startProjectTransition(() => {
            void createConversationForProject(activeRepoPath, "New conversation", { preserveActiveView: true });
          });
        },
      },
      {
        id: "action-open-notes",
        title: "Open Notes",
        subtitle: "Switch to the Notes workspace",
        group: "action",
        keywords: ["open", "notes", "view"],
        enabled: true,
        run: () => {
          setCodexPrompt("");
          openViewTab("notes");
        },
      },
      {
        id: "action-open-project",
        title: "Open Project",
        subtitle: "Switch to the Project workspace",
        group: "action",
        keywords: ["open", "project", "view", "settings"],
        enabled: true,
        run: () => {
          setCodexPrompt("");
          openViewTab("project");
        },
      },
    ];

    if (currentNode && !pinnedCanvasNodeIds.includes(currentNode.id)) {
      actionItems.push({
        id: "action-pin-current-note",
        title: `Pin ${currentNode.title}`,
        subtitle: "Keep this note in working context while you explore",
        group: "action",
        keywords: ["pin", "current", "note", currentNode.title.toLowerCase()],
        enabled: true,
        run: () => {
          setCodexPrompt("");
          pinCanvasNode(currentNode.id);
        },
      });
    }

    if (currentNode && pinnedCanvasNodeIds.includes(currentNode.id)) {
      actionItems.push({
        id: "action-unpin-current-note",
        title: `Unpin ${currentNode.title}`,
        subtitle: "Remove this note from persistent context",
        group: "action",
        keywords: ["unpin", "current", "note", currentNode.title.toLowerCase()],
        enabled: true,
        run: () => {
          setCodexPrompt("");
          unpinCanvasNode(currentNode.id);
        },
      });
    }

    if (pinnedCanvasNodeIds.length > 0) {
      actionItems.push({
        id: "action-clear-pinned",
        title: "Clear pinned notes",
        subtitle: `Remove ${pinnedCanvasNodeIds.length} pinned note${pinnedCanvasNodeIds.length === 1 ? "" : "s"}`,
        group: "action",
        keywords: ["clear", "pinned", "context", "unpin"],
        enabled: true,
        run: () => {
          setCodexPrompt("");
          clearPinnedCanvasNodes();
        },
      });
    }

    const actionMatches = actionItems
      .filter((item) => item.enabled !== false)
      .filter((item) => {
        if (!commandQuery) {
          return true;
        }
        const haystack = [item.title, item.subtitle ?? "", ...item.keywords].join(" ").toLowerCase();
        return haystack.includes(loweredCommand);
      });

    const query = loweredCommand;
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
          setCodexPrompt("");
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
          setCodexPrompt("");
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
          setCodexPrompt("");
          startProjectTransition(() => {
            void openProjectConversation(item.repoPath, item.conversation);
          });
        },
      }));

    const viewItems = (["notes", "project"] as WorkspaceView[])
      .filter((view) => !query || viewLabel(view).toLowerCase().includes(query))
      .map<CommandResultItem>((view) => ({
        id: `view:${view}`,
        title: viewLabel(view),
        subtitle: "workspace view",
        group: "navigate",
        run: () => {
          setCodexPrompt("");
          openViewTab(view);
        },
      }));

    return [...actionMatches, ...noteItems, ...projectItems, ...conversationItems, ...viewItems].slice(0, 14);
  })();

  useEffect(() => {
    const isAnyDockExpanded = dockVisibility === "visible" && consoleVisibility === "expanded";
    if (!isSlashCommandMode || !isAnyDockExpanded || commandResults.length === 0) {
      return;
    }

    const selectedResult =
      commandResults[Math.min(commandSelectedIndex, Math.max(commandResults.length - 1, 0))] ?? null;
    if (!selectedResult) {
      return;
    }

    const node = commandResultRefs.current[selectedResult.id];
    node?.scrollIntoView({ block: "nearest" });
  }, [commandResults, commandSelectedIndex, consoleVisibility, dockVisibility, isSlashCommandMode]);

  function handleSubmitOmnibox() {
    const value = codexPrompt.trim();
    if (!value) {
      return;
    }

    setDockVisibility("visible");
    setConsoleVisibility("expanded");

    if (isSlashCommandMode) {
      const selectedResult =
        commandResults[Math.min(commandSelectedIndex, Math.max(commandResults.length - 1, 0))] ?? commandResults[0];
      if (selectedResult) {
        selectedResult.run();
      }
      return;
    }

    startCodexTransition(() => {
      if (composerMode === "build") {
        void submitBuildPrompt(value, { preserveActiveView: true });
        return;
      }
      if (composerMode === "plan") {
        void submitPlanPrompt(value, { preserveActiveView: true });
        return;
      }
      void submitAutoPrompt(value, { preserveActiveView: true });
    });
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const collapseComposer = () => {
      if (consoleVisibility === "expanded") {
        setConsoleVisibility("collapsed");
        return;
      }
      if (dockVisibility === "visible") {
        setDockVisibility("hidden");
      }
    };

    if (event.key === "Escape") {
      if (codexPrompt.trim() === "/") {
        event.preventDefault();
        setCodexPrompt("");
        collapseComposer();
        event.currentTarget.blur();
        return;
      }

      if (!codexPrompt.trim()) {
        event.preventDefault();
        collapseComposer();
        event.currentTarget.blur();
        return;
      }
    }

    if (isSlashCommandMode) {
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
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSubmitOmnibox();
      }
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmitOmnibox();
    }
  }

  function handleDockDragStart(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    dockDragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      offsetX: dockOffset.x,
      offsetY: dockOffset.y,
    };
    setIsDockDragging(true);
  }

  function handleComposerChange(value: string) {
    setCodexPrompt(value);
    window.requestAnimationFrame(() => {
      resizeComposerInput(composerInputRef.current);
    });
  }

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
            title: "New note",
            description: "Describe the feature, screen, workflow, or constraint this note represents.",
            tags: ["feature"],
            x,
            y,
            linked_files: [],
            linked_symbols: [],
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
    const branchId = parseBranchSummaryNodeId(nodeId);
    if (branchId) {
      setExplorationBranches((current) => {
        if (!current[branchId]) {
          return current;
        }
        const next = { ...current };
        delete next[branchId];
        return next;
      });
      setExplorationTabs((current) => {
        if (!current[branchId]) {
          return current;
        }
        const next = { ...current };
        delete next[branchId];
        return next;
      });
      setExplorationSuggestionStates((current) => {
        if (!current[branchId]) {
          return current;
        }
        const next = { ...current };
        delete next[branchId];
        return next;
      });
      setOpenTabs((current) => current.filter((tab) => !(tab.type === "exploration" && tab.explorationId === branchId)));
      setNotesExploration((current) => (current?.id === branchId ? null : current));
      setSelectedCanvasNodeId((current) => (current === nodeId ? null : current));
      setSelectedCanvasNodeIds((current) => current.filter((item) => item !== nodeId));
      setExpandedCanvasNodeId((current) => (current === nodeId ? null : current));
      setActiveTabId((current) => (current === `explore:${branchId}` ? "view:notes" : current));
      return;
    }

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

  function renderNotesView() {
    return (
      <div className={styles.notesWorkspace}>
        <div className={styles.canvasFrame}>
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
          ) : (
            <>
              <CanvasBoard
                onDeleteNode={handleDeleteCanvasNode}
                document={notesCanvasDocument}
                edgeNodeIds={notesExploration ? notesExplorationPresentation.visibleNodeIds : selectedCanvasNodeIds}
                expandedNodeId={expandedCanvasNodeId}
                explorationControls={notesExploration ? notesExplorationControls : null}
                onCreateNodeAt={(x, y) => {
                  startCanvasTransition(() => {
                    void handleCreateCanvasNodeAt(x, y);
                  });
                }}
                onMoveNodeEnd={(nodeId, x, y) => {
                  const branchId = parseBranchSummaryNodeId(nodeId);
                  if (branchId && !notesExploration) {
                    setExplorationBranches((current) => {
                      const branch = current[branchId];
                      if (!branch) {
                        return current;
                      }
                      return {
                        ...current,
                        [branchId]: {
                          ...branch,
                          summaryPosition: { x, y },
                        },
                      };
                    });
                    return;
                  }
                  startCanvasTransition(() => {
                    void handlePersistCanvasNodePosition(nodeId, x, y);
                  });
                }}
                onOpenNode={(nodeId) => {
                  const branchId = parseBranchSummaryNodeId(nodeId);
                  if (branchId && !notesExploration) {
                    const branch = explorationBranches[branchId];
                    if (branch) {
                      setNotesExploration(branch);
                      setSelectedCanvasNodeId(branch.activeNodeId ?? branch.rootNodeId);
                      setSelectedCanvasNodeIds(branch.activeNodeId ? [branch.activeNodeId] : []);
                      setExpandedCanvasNodeId(branch.activeNodeId ?? branch.rootNodeId);
                    }
                    return;
                  }
                  const suggestion = notesExploration ? findSuggestionForBranch(notesExploration, nodeId) : null;
                  if (suggestion && notesExploration) {
                    materializeExplorationSuggestion(notesExploration, suggestion);
                    return;
                  }
                  openCanvasNode(nodeId);
                }}
                onPaneClick={notesExploration ? collapseNotesExploration : undefined}
                onSelectNode={(nodeId) =>
                  notesExploration
                    ? handleExplorationSelection(notesExploration, [nodeId])
                    : handleSelectCanvasNodes([nodeId])
                }
                onSelectNodes={(nodeIds) =>
                  notesExploration
                    ? handleExplorationSelection(notesExploration, nodeIds)
                    : handleSelectCanvasNodes(nodeIds)
                }
                onToggleExpandNode={toggleCanvasNodeExpansion}
                onResetNodeSize={resetCanvasNodeSize}
                selectedNodeIds={notesExploration?.activeNodeId ? [notesExploration.activeNodeId] : selectedCanvasNodeIds}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  function renderExplorationTab(branch: ExplorationBranch | null) {
    if (!branch || !activeExplorationPresentation.displayDocument) {
      return <EmptyState message="This exploration is no longer available." />;
    }

    return (
      <div className={styles.notesWorkspace}>
        <div className={styles.canvasFrame}>
          <CanvasBoard
            document={explorationCanvasDocument}
            edgeNodeIds={activeExplorationPresentation.visibleNodeIds}
            expandedNodeId={expandedCanvasNodeId}
            explorationControls={activeExplorationControls}
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
            onOpenNode={(nodeId) => {
              const suggestion = findSuggestionForBranch(branch, nodeId, { persistent: true });
              if (suggestion) {
                materializeExplorationSuggestion(branch, suggestion, { persistent: true });
                return;
              }
              if (isTransientExplorationNodeId(nodeId)) {
                handleExplorationSelection(branch, [nodeId], { persistent: true });
                return;
              }
              openCanvasNode(nodeId);
            }}
            onSelectNode={(nodeId) => handleExplorationSelection(branch, [nodeId], { persistent: true })}
            onSelectNodes={(nodeIds) => handleExplorationSelection(branch, nodeIds, { persistent: true })}
            onToggleExpandNode={toggleCanvasNodeExpansion}
            onResetNodeSize={resetCanvasNodeSize}
            selectedNodeIds={branch.activeNodeId ? [branch.activeNodeId] : []}
          />
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
        <div className={styles.noteEditorWorkspace}>
          <div className={isNoteSidebarCollapsed ? styles.noteEditorLayoutSidebarHidden : styles.noteEditorLayout}>
            <div className={styles.noteEditorMain}>
              <div className={styles.noteEditorHeader}>
                <div className={styles.noteHeaderTop}>
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
                  <button
                    className={styles.noteSidebarToggle}
                    onClick={() => setIsNoteSidebarCollapsed((current) => !current)}
                    type="button"
                  >
                    {isNoteSidebarCollapsed ? "Show details" : "Hide details"}
                  </button>
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

              <div className={styles.noteDockSlotInline}>{renderUnifiedDock("embedded")}</div>
            </div>

            {isNoteSidebarCollapsed ? null : (
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
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderProjectView() {
    return (
      <div className={styles.projectPage}>
        <div className={styles.projectPrimaryCard}>
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

        <div className={styles.projectTray}>
          <button
            className={isProjectTrayExpanded ? styles.projectTrayToggleOpen : styles.projectTrayToggle}
            onClick={() => setIsProjectTrayExpanded((current) => !current)}
            type="button"
          >
            <span>{isProjectTrayExpanded ? "Hide project details" : "Show project details"}</span>
            <span className={styles.projectTrayToggleMeta}>{isProjectTrayExpanded ? "Collapse" : "Expand"}</span>
          </button>

          {isProjectTrayExpanded ? (
            <div className={styles.projectTrayPanel}>
              <div className={styles.projectTrayGrid}>
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
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function renderUnifiedDock(mode: "floating" | "embedded" = "floating") {
    const selectedCommandResult =
      commandResults[Math.min(commandSelectedIndex, Math.max(commandResults.length - 1, 0))] ?? null;
    const isEmbedded = mode === "embedded";
    const isDockHidden = dockVisibility === "hidden";
    const isDockExpanded = consoleVisibility === "expanded";
    const floatingShellStyle = isEmbedded ? undefined : { transform: `translate(${dockOffset.x}px, ${dockOffset.y}px)` };

    if (isDockHidden) {
      return (
        <div className={isEmbedded ? styles.notesConsoleShellEmbedded : styles.notesConsoleShell} style={floatingShellStyle}>
          <div className={isEmbedded ? styles.notesConsoleHiddenRail : styles.notesConsoleHiddenRailFloating}>
            <button
              className={styles.notesConsoleHiddenHandle}
              onClick={() => {
                setDockVisibility("visible");
                setConsoleVisibility("collapsed");
              }}
              type="button"
            >
              <span className={styles.notesConsoleBarLabel}>{isSlashCommandMode ? "Commands" : "Console"}</span>
              <span className={styles.notesConsoleHiddenMeta}>Show</span>
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={isEmbedded ? styles.notesConsoleShellEmbedded : styles.notesConsoleShell} style={floatingShellStyle}>
        <div className={isEmbedded ? styles.notesConsoleDockEmbedded : styles.notesConsoleFloatingWrap}>
          <div className={isEmbedded ? styles.notesConsoleDockEmbedded : styles.notesConsoleDock}>
          {isDockExpanded ? (
            <div className={styles.notesConsolePanel}>
              {isSlashCommandMode ? (
                <div className={styles.commandResults}>
                  {commandResults.length === 0 ? (
                    <p className={styles.helperText}>Type a slash command, or search notes, projects, conversations, and views with `/`.</p>
                  ) : (
                    commandResults.map((item, index) => (
                      <button
                        className={index === commandSelectedIndex ? styles.commandResultActive : styles.commandResult}
                        key={item.id}
                        ref={(node) => {
                          commandResultRefs.current[item.id] = node;
                        }}
                        onClick={item.run}
                        type="button"
                      >
                        <span className={styles.commandResultTitle}>{item.title}</span>
                        {item.subtitle ? <span className={styles.commandResultMeta}>{item.subtitle}</span> : null}
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className={styles.notesConsoleMessages} ref={consoleMessagesRef}>
                  {consoleMessages.length === 0 ? (
                    <p className={styles.helperText}>Ask about the project, describe a change, or type `/` for commands.</p>
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
                            message.role === "assistant" ? activeContextDocument : null,
                            handleOpenContextNode,
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
              )}
            </div>
          ) : null}

          <div className={isDockExpanded ? styles.notesConsoleBarExpanded : styles.notesConsoleBar}>
            <button
              className={styles.notesConsoleBarMain}
              onClick={() => setConsoleVisibility((current) => (current === "expanded" ? "collapsed" : "expanded"))}
              type="button"
            >
              <span className={styles.notesConsoleBarLabel}>{isSlashCommandMode ? "Commands" : "Console"}</span>
              <span className={styles.notesConsoleBarSummary}>
                {isSlashCommandMode && selectedCommandResult ? selectedCommandResult.title : latestConsoleSummary}
              </span>
            </button>
          </div>

          <label className={styles.consoleComposer}>
            <textarea
              className={styles.consoleComposerInput}
              disabled={isComposerBusy}
              onChange={(event) => handleComposerChange(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Ask about the project, describe a change, or type / for commands."
              ref={composerInputRef}
              rows={2}
              value={codexPrompt}
            />
            <div className={styles.consoleComposerActions}>
              <div className={styles.consoleComposerLeft}>
                <div className={styles.consoleControlCluster}>
                  <label className={styles.consoleInlineControl}>
                    <select
                      aria-label="Model"
                      className={styles.consoleInlineSelect}
                      disabled={isComposerBusy}
                      onChange={(event) => setComposerModel(event.target.value)}
                      value={composerModel}
                    >
                      {availableComposerModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.consoleInlineControl}>
                    <select
                      aria-label="Reasoning"
                      className={styles.consoleInlineSelect}
                      disabled={isComposerBusy}
                      onChange={(event) => setComposerReasoning(event.target.value as ComposerReasoningEffort)}
                      value={composerReasoning}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="xhigh">Extra high</option>
                    </select>
                  </label>
                </div>
                <div aria-label="Run mode" className={styles.consoleModeSwitch} role="tablist">
                  {(["auto", "build", "plan"] as const).map((mode) => (
                    <button
                      aria-selected={composerMode === mode}
                      className={composerMode === mode ? styles.consoleModeButtonActive : styles.consoleModeButton}
                      disabled={isComposerBusy}
                      key={mode}
                      onClick={() => setComposerMode(mode)}
                      role="tab"
                      type="button"
                    >
                      {mode === "auto" ? "Auto" : mode === "build" ? "Build" : "Plan"}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.consoleComposerRight}>
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
                <button
                  className={styles.primaryButton}
                  disabled={
                    isComposerBusy ||
                    !codexPrompt.trim() ||
                    (!isSlashCommandMode && !activeRepoPath)
                  }
                  onClick={handleSubmitOmnibox}
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
                  ) : isAnswering ? (
                    <>
                      <span aria-hidden="true" className={styles.buttonSpinner} />
                      <span>Working...</span>
                    </>
                  ) : (
                    <span>
                      {isSlashCommandMode
                        ? "Run"
                        : composerMode === "build"
                          ? "Build"
                          : composerMode === "plan"
                            ? "Plan"
                            : "Send"}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </label>
          </div>
          {isEmbedded ? null : (
            <div className={styles.notesConsoleExternalActions}>
              <button
                className={[styles.notesConsoleExternalButton, styles.notesConsoleDragHandle].join(" ")}
                aria-label="Move console"
                onMouseDown={handleDockDragStart}
                title="Drag console"
                type="button"
              >
                <span aria-hidden="true" className={styles.notesConsoleGripDots} />
              </button>
              <button
                className={styles.notesConsoleExternalButton}
                onClick={() => {
                  setConsoleVisibility("collapsed");
                  setDockVisibility("hidden");
                }}
                type="button"
              >
                Hide
              </button>
            </div>
          )}
        </div>
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
      case "project":
        return renderProjectView();
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

          <section
            className={[
              activeTab?.type === "exploration" || (activeTab?.type === "view" && activeView === "notes")
                ? styles.workspaceStageFlush
                : styles.workspaceStage,
              dockVisibility === "visible" ? styles.workspaceStageWithDockExpanded : styles.workspaceStageWithDockCollapsed,
            ].join(" ")}
          >
            {renderActiveView()}
          </section>

          {activeTab?.type === "note" ? null : renderUnifiedDock()}
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

function EmptyState({ message }: { message: string }) {
  return <p className={styles.helperText}>{message}</p>;
}

function viewLabel(view: WorkspaceView) {
  switch (view) {
    case "notes":
      return "Notes";
    case "project":
      return "Project";
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
    case "project":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 13.2h10M4 11V4.6a1.6 1.6 0 0 1 1.6-1.6h4.8L12 4.6V11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M10.4 3v2h2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
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

function findCanvasNodeTitle(document: CanvasDocument | null, nodeId: string) {
  return document?.nodes.find((item) => item.id === nodeId)?.title ?? nodeId;
}

function explorationTabTitle(document: CanvasDocument | null, branch: ExplorationBranch | null) {
  if (!branch) {
    return "Explore";
  }
  const rootTitle = findCanvasNodeTitle(buildExplorationContextDocument(document, branch), branch.rootNodeId);
  const activeTitle = findCanvasNodeTitle(buildExplorationContextDocument(document, branch), branch.activeNodeId ?? branch.rootNodeId);
  return rootTitle === activeTitle ? `Explore: ${rootTitle}` : `${rootTitle} -> ${activeTitle}`;
}

function createExplorationBranch(nodeId: string, document: CanvasDocument | null): ExplorationBranch {
  const rootNode = document?.nodes.find((node) => node.id === nodeId) ?? null;
  return {
    id: `explore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    rootNodeId: nodeId,
    activeNodeId: nodeId,
    pathNodeIds: [nodeId],
    revealedNodeIds: [nodeId],
    suggestionsByNodeId: {},
    transientNodes: [],
    transientEdges: [],
    relationQuery: "",
    summaryPosition: {
      x: (rootNode?.x ?? 96) + 280,
      y: rootNode?.y ?? 96,
    },
  };
}

function normalizeExplorationBranch(
  branch: ExplorationBranch | null,
  validNodeIds: Set<string>,
): ExplorationBranch | null {
  if (!branch) {
    return null;
  }

  const transientNodeIds = new Set(branch.transientNodes.map((node) => node.id));
  const knownNodeIds = new Set([...validNodeIds, ...transientNodeIds]);
  const pathNodeIds = uniqueNodeIds(branch.pathNodeIds.filter((nodeId) => knownNodeIds.has(nodeId)));
  const revealedNodeIds = uniqueNodeIds(branch.revealedNodeIds.filter((nodeId) => knownNodeIds.has(nodeId)));
  const rootNodeId = knownNodeIds.has(branch.rootNodeId) ? branch.rootNodeId : pathNodeIds[0] ?? revealedNodeIds[0] ?? null;
  if (!rootNodeId) {
    return null;
  }
  const activeNodeId =
    branch.activeNodeId && knownNodeIds.has(branch.activeNodeId)
      ? branch.activeNodeId
      : pathNodeIds.at(-1) ?? revealedNodeIds.at(-1) ?? rootNodeId;
  const transientNodes = branch.transientNodes.filter((node) => transientNodeIds.has(node.id));
  const validEdgeNodeIds = new Set([...validNodeIds, ...transientNodes.map((node) => node.id)]);
  const transientEdges = branch.transientEdges.filter(
    (edge) => validEdgeNodeIds.has(edge.source_node_id) && validEdgeNodeIds.has(edge.target_node_id),
  );
  const suggestionsByNodeId = Object.fromEntries(
    Object.entries(branch.suggestionsByNodeId ?? {})
      .filter(([nodeId]) => knownNodeIds.has(nodeId))
      .map(([nodeId, suggestions]) => [nodeId, dedupeExplorationSuggestions(suggestions)]),
  );

  return {
    ...branch,
    rootNodeId,
    activeNodeId,
    pathNodeIds,
    revealedNodeIds: uniqueNodeIds([rootNodeId, ...revealedNodeIds, ...pathNodeIds]),
    suggestionsByNodeId,
    transientNodes,
    transientEdges,
  };
}

function advanceExplorationBranch(branch: ExplorationBranch, nextNodeId: string): ExplorationBranch {
  const existingIndex = branch.pathNodeIds.indexOf(nextNodeId);
  if (existingIndex !== -1) {
    const nextPath = branch.pathNodeIds.slice(0, existingIndex + 1);
    if (
      nextPath.length === branch.pathNodeIds.length &&
      branch.activeNodeId === nextNodeId
    ) {
      return branch;
    }
    return {
      ...branch,
      activeNodeId: nextNodeId,
      pathNodeIds: nextPath,
      revealedNodeIds: uniqueNodeIds([...branch.revealedNodeIds, nextNodeId]),
    };
  }

  return {
    ...branch,
    activeNodeId: nextNodeId,
    pathNodeIds: [...branch.pathNodeIds, nextNodeId],
    revealedNodeIds: uniqueNodeIds([...branch.revealedNodeIds, nextNodeId]),
  };
}

function buildExplorationPresentation(
  document: CanvasDocument | null,
  branch: ExplorationBranch | null,
  suggestions: ExplorationSuggestion[],
  suggestionState: ExplorationSuggestionState | null,
): ExplorationPresentation {
  if (!document || !branch) {
    return {
      activeNode: null,
      displayDocument: null,
      pathNodes: [],
      suggestedNodes: [],
      visibleNodeIds: [],
    };
  }

  const validNodeIds = new Set(document.nodes.map((node) => node.id));
  const normalizedBranch = normalizeExplorationBranch(branch, validNodeIds);
  if (!normalizedBranch) {
    return {
      activeNode: null,
      displayDocument: null,
      pathNodes: [],
      suggestedNodes: [],
      visibleNodeIds: [],
    };
  }

  const branchDocument = buildExplorationContextDocument(document, normalizedBranch);
  if (!branchDocument) {
    return {
      activeNode: null,
      displayDocument: null,
      pathNodes: [],
      suggestedNodes: [],
      visibleNodeIds: [],
    };
  }
  const nodesById = new Map(branchDocument.nodes.map((node) => [node.id, node] as const));
  const pathNodes = normalizedBranch.pathNodeIds
    .map((nodeId) => nodesById.get(nodeId) ?? null)
    .filter((node): node is CanvasNode => Boolean(node));
  const loadingSuggestionCount =
    suggestionState?.loading && suggestionState.kind === "suggestions"
      ? Math.max(0, suggestionState.neededCount || Math.max(0, 3 - suggestions.length))
      : 0;
  const suggestionArtifacts = buildExplorationSuggestionArtifacts(
    branchDocument,
    normalizedBranch,
    suggestions,
    loadingSuggestionCount,
  );
  const displayDocument = {
    ...branchDocument,
    nodes: [...branchDocument.nodes, ...suggestionArtifacts.nodes],
    edges: [...branchDocument.edges, ...suggestionArtifacts.edges],
  };
  const visibleNodeIds = uniqueNodeIds([
    ...normalizedBranch.revealedNodeIds,
    ...suggestionArtifacts.nodes.map((node) => node.id),
  ]);

  return {
    activeNode: normalizedBranch.activeNodeId ? nodesById.get(normalizedBranch.activeNodeId) ?? null : null,
    displayDocument: layoutExplorationDocument(displayDocument, visibleNodeIds),
    pathNodes,
    suggestedNodes: suggestions,
    visibleNodeIds,
  };
}

function layoutExplorationDocument(
  document: CanvasDocument,
  visibleNodeIds: string[],
) {
  const visibleNodeIdSet = new Set(visibleNodeIds);
  const nodes = document.nodes.filter((node) => visibleNodeIdSet.has(node.id));
  const edges = document.edges.filter(
    (edge) => visibleNodeIdSet.has(edge.source_node_id) && visibleNodeIdSet.has(edge.target_node_id),
  );

  return {
    ...document,
    nodes,
    edges,
  };
}

const DEFAULT_CANVAS_NODE_WIDTH = 240;
const DEFAULT_CANVAS_NODE_HEIGHT = 148;
const EXPANDED_CANVAS_NODE_WIDTH = 388;
const EXPANDED_CANVAS_NODE_HEIGHT = 348;
const EXPANDED_CANVAS_NODE_GAP_X = 44;
const EXPANDED_CANVAS_NODE_GAP_Y = 40;

function applyExpandedNodeLayout(
  document: CanvasDocument | null,
  expandedNodeId: string | null,
) {
  if (!document || !expandedNodeId) {
    return document;
  }

  const expandedNode = document.nodes.find((node) => node.id === expandedNodeId);
  if (!expandedNode) {
    return document;
  }

  const expandedBounds = {
    left: expandedNode.x,
    top: expandedNode.y,
    right: expandedNode.x + EXPANDED_CANVAS_NODE_WIDTH,
    bottom: expandedNode.y + EXPANDED_CANVAS_NODE_HEIGHT,
  };
  const defaultBounds = {
    right: expandedNode.x + DEFAULT_CANVAS_NODE_WIDTH,
    bottom: expandedNode.y + DEFAULT_CANVAS_NODE_HEIGHT,
  };
  const horizontalShift = EXPANDED_CANVAS_NODE_WIDTH - DEFAULT_CANVAS_NODE_WIDTH + EXPANDED_CANVAS_NODE_GAP_X;
  const verticalShift = EXPANDED_CANVAS_NODE_HEIGHT - DEFAULT_CANVAS_NODE_HEIGHT + EXPANDED_CANVAS_NODE_GAP_Y;

  const nodes = document.nodes.map((node) => {
    if (node.id === expandedNodeId) {
      return node;
    }

    const overlapsExpandedVertically =
      node.y < expandedBounds.bottom && node.y + DEFAULT_CANVAS_NODE_HEIGHT > expandedBounds.top;
    const overlapsExpandedHorizontally =
      node.x < expandedBounds.right && node.x + DEFAULT_CANVAS_NODE_WIDTH > expandedBounds.left;

    const shouldShiftRight =
      node.x >= defaultBounds.right - 8 && overlapsExpandedVertically;
    const shouldShiftDown =
      node.y >= defaultBounds.bottom - 8 && overlapsExpandedHorizontally;

    return {
      ...node,
      x: node.x + (shouldShiftRight ? horizontalShift : 0),
      y: node.y + (shouldShiftDown ? verticalShift : 0),
    };
  });

  return {
    ...document,
    nodes,
  };
}

function buildExplorationSuggestionArtifacts(
  document: CanvasDocument,
  branch: ExplorationBranch,
  suggestions: ExplorationSuggestion[],
  loadingSuggestionCount: number,
) {
  const activeNode = document.nodes.find((node) => node.id === (branch.activeNodeId ?? branch.rootNodeId)) ?? null;
  if (!activeNode || (suggestions.length === 0 && loadingSuggestionCount === 0)) {
    return { nodes: [] as CanvasNode[], edges: [] as CanvasEdge[] };
  }

  const offsets = [
    { x: 310, y: -186 },
    { x: 352, y: 0 },
    { x: 310, y: 186 },
  ];

  const suggestionNodes = suggestions.map((suggestion, index) => {
    const offset = offsets[index] ?? offsets[offsets.length - 1];
    return {
      id: suggestion.displayNodeId,
      title: suggestion.title,
      description: suggestion.summary,
      linked_files: [],
      linked_symbols: [],
      tags: ["suggestion"],
      x: activeNode.x + offset.x,
      y: activeNode.y + offset.y,
    } satisfies CanvasNode;
  });

  const loadingNodes = Array.from({ length: loadingSuggestionCount }, (_, index) => {
    const slotIndex = Math.min(suggestions.length + index, offsets.length - 1);
    const offset = offsets[slotIndex] ?? offsets[offsets.length - 1];
    return {
      id: `suggestion-loading-node:${branch.id}:${activeNode.id}:${slotIndex}`,
      title: "",
      description: "",
      linked_files: [],
      linked_symbols: [],
      tags: ["suggestion", "suggestion-loading"],
      x: activeNode.x + offset.x,
      y: activeNode.y + offset.y,
    } satisfies CanvasNode;
  });

  const suggestionEdges = suggestions.map((suggestion) => ({
    id: `suggestion-edge:${branch.id}:${suggestion.id}`,
    source_node_id: activeNode.id,
    target_node_id: suggestion.displayNodeId,
    label: suggestion.edgeLabel,
  }) satisfies CanvasEdge);

  const loadingEdges = loadingNodes.map((node) => ({
    id: `suggestion-edge-loading:${branch.id}:${node.id}`,
    source_node_id: activeNode.id,
    target_node_id: node.id,
    label: "",
  }) satisfies CanvasEdge);

  return {
    nodes: [...suggestionNodes, ...loadingNodes],
    edges: [...suggestionEdges, ...loadingEdges],
  };
}

function suggestionNodeId(branchId: string, suggestionId: string) {
  return `suggestion-node:${branchId}:${suggestionId}`;
}

function toExplorationSuggestion(
  branchId: string,
  suggestion: ExplorationSuggestionRecord,
  index: number,
): ExplorationSuggestion {
  return {
    id: `generated:${branchId}:${index}:${suggestion.title}`,
    displayNodeId: suggestionNodeId(branchId, `${index}:${suggestion.title}`),
    title: suggestion.title,
    summary: suggestion.summary,
    edgeLabel: suggestion.edge_label,
  };
}

function buildExplorationSuggestionKey(branch: ExplorationBranch) {
  return `${branch.activeNodeId ?? branch.rootNodeId}::${branch.pathNodeIds.join("::")}`;
}

function buildExplorationContextNode(
  document: CanvasDocument | null,
  branch: ExplorationBranch,
): ExplorationContextNode | null {
  if (!document) {
    return null;
  }
  const activeNode = document.nodes.find((node) => node.id === (branch.activeNodeId ?? branch.rootNodeId)) ?? null;
  if (!activeNode) {
    return null;
  }
  return {
    title: activeNode.title,
    description: activeNode.description,
    tags: activeNode.tags,
    linked_files: activeNode.linked_files,
    linked_symbols: activeNode.linked_symbols,
  };
}

function buildExplorationPathTitles(document: CanvasDocument, branch: ExplorationBranch) {
  return branch.pathNodeIds.map((nodeId) => findCanvasNodeTitle(document, nodeId));
}

function buildFallbackExplorationSuggestions(activeTitle: string): ExplorationSuggestionRecord[] {
  const base = activeTitle.trim() || "Current concept";
  return [
    {
      title: `${base} Decision Points`,
      summary: `Explore the key decisions and branching logic around ${base.toLowerCase()}.`,
      edge_label: "shapes",
    },
    {
      title: `${base} Inputs`,
      summary: `Explore the inputs, triggers, and upstream signals that feed ${base.toLowerCase()}.`,
      edge_label: "depends on",
    },
    {
      title: `${base} Effects`,
      summary: `Explore the outputs, side effects, and downstream consequences of ${base.toLowerCase()}.`,
      edge_label: "drives",
    },
  ];
}

function buildFallbackRelationSuggestion(activeTitle: string, relationQuery: string): ExplorationSuggestionRecord {
  const base = activeTitle.trim() || "Current concept";
  const query = relationQuery.trim() || "relationship";
  return {
    title: `${base} ${query.charAt(0).toUpperCase()}${query.slice(1)}`,
    summary: `Explore the ${query.toLowerCase()} angle around ${base.toLowerCase()}.`,
    edge_label: query.toLowerCase(),
  };
}

function getActiveExplorationSuggestions(branch: ExplorationBranch) {
  const activeNodeId = branch.activeNodeId ?? branch.rootNodeId;
  return branch.suggestionsByNodeId?.[activeNodeId] ?? [];
}

function dedupeExplorationSuggestions(suggestions: ExplorationSuggestion[]) {
  const seenTitles = new Set<string>();
  const deduped: ExplorationSuggestion[] = [];
  for (const suggestion of suggestions) {
    const normalizedTitle = suggestion.title.trim().toLowerCase();
    if (!normalizedTitle || seenTitles.has(normalizedTitle)) {
      continue;
    }
    seenTitles.add(normalizedTitle);
    deduped.push(suggestion);
  }
  return deduped;
}

function mergeExplorationSuggestions(
  existing: ExplorationSuggestion[],
  incoming: ExplorationSuggestion[],
  document: CanvasDocument,
  branch: ExplorationBranch,
) {
  const takenTitles = new Set(
    uniqueNodeIds([...branch.pathNodeIds, ...branch.revealedNodeIds])
      .map((nodeId) => findCanvasNodeTitle(document, nodeId).trim().toLowerCase())
      .filter(Boolean),
  );

  const filtered: ExplorationSuggestion[] = [];
  const seenTitles = new Set<string>();
  for (const suggestion of [...existing, ...incoming]) {
    const normalizedTitle = suggestion.title.trim().toLowerCase();
    if (!normalizedTitle) {
      continue;
    }
    if (takenTitles.has(normalizedTitle) || seenTitles.has(normalizedTitle)) {
      continue;
    }
    seenTitles.add(normalizedTitle);
    filtered.push(suggestion);
  }
  return filtered.slice(0, 3);
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

function branchSummaryNodeId(branchId: string) {
  return `branch-summary:${branchId}`;
}

function parseBranchSummaryNodeId(nodeId: string) {
  return nodeId.startsWith("branch-summary:") ? nodeId.slice("branch-summary:".length) : null;
}

function isTransientExplorationNodeId(nodeId: string) {
  return nodeId.startsWith("explore-node:");
}

function buildOverviewCanvasDocument(
  document: CanvasDocument | null,
  branches: Record<string, ExplorationBranch>,
) {
  if (!document) {
    return null;
  }

  const branchNodes = Object.values(branches).map((branch) => {
    const branchDocument = buildExplorationContextDocument(document, branch);
    const rootTitle = findCanvasNodeTitle(branchDocument, branch.rootNodeId);
    const conceptCount = countExplorationConcepts(branch);
    return {
      id: branchSummaryNodeId(branch.id),
      title: rootTitle,
      description: `Saved exploration branch for ${rootTitle.toLowerCase()}.`,
      linked_files: [],
      linked_symbols: [],
      tags: ["exploration", `${conceptCount} concepts`],
      x: branch.summaryPosition.x,
      y: branch.summaryPosition.y,
    } satisfies CanvasNode;
  });

  const branchEdges = Object.values(branches).map((branch) => ({
    id: `branch-summary-edge:${branch.id}`,
    source_node_id: branchSummaryNodeId(branch.id),
    target_node_id: branch.rootNodeId,
    label: "explores",
  }) satisfies CanvasEdge);

  return {
    ...document,
    nodes: [...document.nodes, ...branchNodes],
    edges: [...document.edges, ...branchEdges],
  };
}

function buildExplorationContextDocument(
  document: CanvasDocument | null,
  branch: ExplorationBranch | null,
) {
  if (!document || !branch) {
    return document;
  }

  const nodes = uniqueNodeIds([...document.nodes.map((node) => node.id), ...branch.transientNodes.map((node) => node.id)]);
  void nodes;
  return {
    ...document,
    nodes: [...document.nodes, ...branch.transientNodes],
    edges: [...document.edges, ...branch.transientEdges],
  };
}

function countExplorationConcepts(branch: ExplorationBranch) {
  return (
    uniqueNodeIds([...branch.revealedNodeIds, ...branch.transientNodes.map((node) => node.id)]).length +
    Object.values(branch.suggestionsByNodeId ?? {}).reduce((count, suggestions) => count + suggestions.length, 0)
  );
}

function areStringArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function areCanvasNodesEqual(left: CanvasNode[], right: CanvasNode[]) {
  return (
    left.length === right.length &&
    left.every((node, index) => {
      const other = right[index];
      return (
        node.id === other.id &&
        node.title === other.title &&
        node.description === other.description &&
        node.x === other.x &&
        node.y === other.y &&
        areStringArraysEqual(node.tags, other.tags) &&
        areStringArraysEqual(node.linked_files, other.linked_files) &&
        areStringArraysEqual(node.linked_symbols, other.linked_symbols)
      );
    })
  );
}

function areCanvasEdgesEqual(left: CanvasEdge[], right: CanvasEdge[]) {
  return (
    left.length === right.length &&
    left.every((edge, index) => {
      const other = right[index];
      return (
        edge.id === other.id &&
        edge.source_node_id === other.source_node_id &&
        edge.target_node_id === other.target_node_id &&
        edge.label === other.label
      );
    })
  );
}

function areExplorationBranchesEqual(left: ExplorationBranch | null, right: ExplorationBranch | null) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    left.id === right.id &&
    left.rootNodeId === right.rootNodeId &&
    left.activeNodeId === right.activeNodeId &&
    left.relationQuery === right.relationQuery &&
    left.summaryPosition.x === right.summaryPosition.x &&
    left.summaryPosition.y === right.summaryPosition.y &&
    areStringArraysEqual(left.pathNodeIds, right.pathNodeIds) &&
    areStringArraysEqual(left.revealedNodeIds, right.revealedNodeIds) &&
    areExplorationSuggestionMapsEqual(left.suggestionsByNodeId ?? {}, right.suggestionsByNodeId ?? {}) &&
    areCanvasNodesEqual(left.transientNodes, right.transientNodes) &&
    areCanvasEdgesEqual(left.transientEdges, right.transientEdges)
  );
}

function areExplorationBranchMapsEqual(
  left: Record<string, ExplorationBranch>,
  right: Record<string, ExplorationBranch>,
) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    areStringArraysEqual(leftKeys, rightKeys) &&
    leftKeys.every((key) => areExplorationBranchesEqual(left[key], right[key]))
  );
}

function areExplorationSuggestionsEqual(left: ExplorationSuggestion[], right: ExplorationSuggestion[]) {
  return (
    left.length === right.length &&
    left.every((suggestion, index) => {
      const other = right[index];
      return (
        suggestion.id === other.id &&
        suggestion.displayNodeId === other.displayNodeId &&
        suggestion.title === other.title &&
        suggestion.summary === other.summary &&
        suggestion.edgeLabel === other.edgeLabel
      );
    })
  );
}

function areExplorationSuggestionMapsEqual(
  left: Record<string, ExplorationSuggestion[]>,
  right: Record<string, ExplorationSuggestion[]>,
) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    areStringArraysEqual(leftKeys, rightKeys) &&
    leftKeys.every((key) => areExplorationSuggestionsEqual(left[key] ?? [], right[key] ?? []))
  );
}

function addTransientExplorationNode(
  document: CanvasDocument | null,
  branch: ExplorationBranch,
  sourceNodeId: string,
  title: string,
  description: string,
  edgeLabel: string,
) {
  const contextDocument = buildExplorationContextDocument(document, branch);
  const sourceNode = contextDocument?.nodes.find((node) => node.id === sourceNodeId) ?? null;
  const nextIndex = branch.transientNodes.length;
  const transientNode: CanvasNode = {
    id: `explore-node:${branch.id}:${nextIndex + 1}`,
    title,
    description,
    linked_files: sourceNode?.linked_files.slice(0, 3) ?? [],
    linked_symbols: [],
    tags: uniqueNodeIds([...(sourceNode?.tags ?? []), "exploration"]),
    x: (sourceNode?.x ?? branch.summaryPosition.x) + 340,
    y: sourceNode?.y ?? branch.summaryPosition.y,
  };
  const transientEdge: CanvasEdge = {
    id: `explore-edge:${branch.id}:${nextIndex + 1}`,
    source_node_id: sourceNodeId,
    target_node_id: transientNode.id,
    label: edgeLabel,
  };

  return {
    ...branch,
    activeNodeId: transientNode.id,
    pathNodeIds: [...branch.pathNodeIds, transientNode.id],
    revealedNodeIds: uniqueNodeIds([...branch.revealedNodeIds, transientNode.id]),
    transientNodes: [...branch.transientNodes, transientNode],
    transientEdges: [...branch.transientEdges, transientEdge],
  };
}

function buildExplorationStorageKey(repoPath: string) {
  return `konceptura.explorations:${repoPath}`;
}

function readStoredExplorationBranches(repoPath: string) {
  if (typeof window === "undefined" || !repoPath) {
    return {};
  }

  try {
    const rawValue = window.localStorage.getItem(buildExplorationStorageKey(repoPath));
    if (!rawValue) {
      return {};
    }
    const parsed = JSON.parse(rawValue) as Record<string, ExplorationBranch>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function writeStoredExplorationBranches(repoPath: string, branches: Record<string, ExplorationBranch>) {
  if (typeof window === "undefined" || !repoPath) {
    return;
  }

  try {
    window.localStorage.setItem(buildExplorationStorageKey(repoPath), JSON.stringify(branches));
  } catch {
    // Ignore localStorage failures and keep the explorer usable.
  }
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

function resizeComposerInput(element: HTMLTextAreaElement | null) {
  if (!element) {
    return;
  }

  element.style.height = "0px";
  const nextHeight = Math.min(Math.max(element.scrollHeight, 54), 148);
  element.style.height = `${nextHeight}px`;
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
