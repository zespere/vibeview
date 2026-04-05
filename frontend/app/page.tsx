"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";

import styles from "./page.module.css";
import { CanvasBoard } from "@/components/canvas-board";
import {
  applyCanvasEdits,
  createProjectCanvas,
  createProjectCanvasFromPrompt,
  createProjectCanvasFromSnapshot,
  deleteProjectCanvas,
  duplicateProjectCanvas,
  createCanvasNode,
  createProjectCommit,
  pushProjectCommits,
  deleteCanvasNode,
  fetchExplorationSuggestions,
  fetchCanvas,
  fetchCanvases,
  fetchCommitStatus,
  fetchProjectConversation,
  fetchProjectsTree,
  fetchProject,
  fetchProjectWorkspaceStatus,
  fetchStatus,
  pickProjectFolder,
  previewCanvasEdits,
  createProjectConversation,
  generateCanvasFromPrompt,
  streamProjectRun,
  resetCanvas,
  renameProjectCanvas,
  uploadProjectImage,
  updateProject,
  updateProjectConversation,
  updateCanvasNode,
  type CanvasEditChangeRecord,
  type CanvasEditPreviewResponse,
  type CanvasDocument,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSummary,
  type CommitStatusResponse,
  type ConversationMessage,
  type ConversationSummary,
  type ExplorationContextNode,
  type ExplorationSuggestionRecord,
  type ProjectProfile,
  type ProjectImageUploadResponse,
  type ProjectTreeItem,
  type ProjectWorkspaceStatusResponse,
  type StatusResponse,
  type ProjectRunStreamEvent,
} from "@/lib/api";

type OpenTab =
  | { id: `canvas:${string}`; type: "canvas"; canvasId: string }
  | { id: `note:${string}:${string}`; type: "note"; nodeId: string; canvasId: string }
  | { id: `explore:${string}:${string}`; type: "exploration"; explorationId: string; canvasId: string };

interface CommandResultItem {
  id: string;
  title: string;
  subtitle?: string;
  key?: string;
  disabled?: boolean;
  group: "navigate" | "action" | "ask" | "execute";
  searchText?: string;
  run: () => void;
}

type LeaderScope =
  | "root"
  | "projects"
  | "canvases"
  | "notes"
  | "conversations"
  | "models"
  | "reasoning"
  | "actions"
  | "git";

interface LeaderGroupItem {
  id: string;
  key: string;
  title: string;
  subtitle: string;
  scope?: Exclude<LeaderScope, "root">;
  run?: () => void;
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
  canvasId: string;
  draftCanvasId?: string | null;
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

interface ComposerImageAttachment {
  id: string;
  fileName: string;
  previewUrl: string;
  uploadedPath: string | null;
  contentType: string;
  sizeBytes: number;
  status: "uploading" | "ready" | "error";
  errorMessage: string | null;
}

type ComposerRunMode = "build" | "plan";
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

const LEADER_DIGIT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

export default function Home() {
  const [isRailExpanded, setIsRailExpanded] = useState(true);
  const [railWidth, setRailWidth] = useState(292);
  const [isRailResizing, setIsRailResizing] = useState(false);
  const [railResizeStartX, setRailResizeStartX] = useState<number | null>(null);
  const [railResizeStartWidth, setRailResizeStartWidth] = useState<number | null>(null);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<OpenTab["id"] | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [project, setProject] = useState<ProjectProfile | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState<ProjectWorkspaceStatusResponse | null>(null);
  const [projectsTree, setProjectsTree] = useState<ProjectTreeItem[]>([]);
  const [projectCanvases, setProjectCanvases] = useState<CanvasSummary[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  const [isProjectsSectionExpanded, setIsProjectsSectionExpanded] = useState(true);
  const [isCanvasesSectionExpanded, setIsCanvasesSectionExpanded] = useState(true);
  const [expandedProjectPaths, setExpandedProjectPaths] = useState<Set<string>>(new Set());
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationRepoPath, setActiveConversationRepoPath] = useState<string | null>(null);
  const [repoPath, setRepoPath] = useState("");
  const [codexPrompt, setCodexPrompt] = useState("");
  const [composerImageAttachments, setComposerImageAttachments] = useState<ComposerImageAttachment[]>([]);
  const [inspectedComposerImageId, setInspectedComposerImageId] = useState<string | null>(null);
  const [composerCaretIndex, setComposerCaretIndex] = useState(0);
  const [composerModel, setComposerModel] = useState("gpt-5.4");
  const [composerReasoning, setComposerReasoning] = useState<ComposerReasoningEffort>("medium");
  const [composerMode, setComposerMode] = useState<ComposerRunMode>("build");
  const [composerStatus, setComposerStatus] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPreviewingCanvasEdits, setIsPreviewingCanvasEdits] = useState(false);
  const [isApplyingCanvasEdits, setIsApplyingCanvasEdits] = useState(false);
  const [isGeneratingCanvas, setIsGeneratingCanvas] = useState(false);
  const [commitStatus, setCommitStatus] = useState<CommitStatusResponse | null>(null);
  const [dockVisibility, setDockVisibility] = useState<DockVisibilityState>("visible");
  const [consoleVisibility, setConsoleVisibility] = useState<ConsoleVisibilityState>("collapsed");
  const [dockOffset, setDockOffset] = useState({ x: 0, y: 0 });
  const [isDockDragging, setIsDockDragging] = useState(false);
  const [leaderScope, setLeaderScope] = useState<LeaderScope | null>(null);
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
  const [canvasEditPreview, setCanvasEditPreview] = useState<CanvasEditPreviewResponse | null>(null);
  const [canvasEditReviewIndex, setCanvasEditReviewIndex] = useState(0);
  const [openCanvasNodeIds, setOpenCanvasNodeIds] = useState<string[]>([]);
  const [canvasDraftTitle, setCanvasDraftTitle] = useState("");
  const [canvasDraftDescription, setCanvasDraftDescription] = useState("");
  const [canvasDraftTags, setCanvasDraftTags] = useState("");
  const [canvasDraftFiles, setCanvasDraftFiles] = useState("");
  const [canvasDraftSymbols, setCanvasDraftSymbols] = useState("");
  const [pinnedCanvasNodeIds, setPinnedCanvasNodeIds] = useState<string[]>([]);
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestedTitleFocusNodeId, setRequestedTitleFocusNodeId] = useState<string | null>(null);
  const [copiedConsoleLinkKey, setCopiedConsoleLinkKey] = useState<string | null>(null);
  const [canvasRailMenu, setCanvasRailMenu] = useState<{
    canvas: CanvasSummary;
    x: number;
    y: number;
  } | null>(null);
  const [renamingCanvasId, setRenamingCanvasId] = useState<string | null>(null);
  const [renamingCanvasTitle, setRenamingCanvasTitle] = useState("");
  const consoleMessagesRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const noteTitleInputRef = useRef<HTMLInputElement | null>(null);
  const renamingCanvasInputRef = useRef<HTMLInputElement | null>(null);
  const commandResultRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const leaderResultRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const expectedRepoPathRef = useRef("");
  const openProjectConversationRef = useRef<((repoPathToOpen: string, conversation?: ConversationSummary) => Promise<void>) | null>(
    null,
  );
  const urlIntentRef = useRef<{
    repoPath: string | null;
    canvasId: string | null;
    noteId: string | null;
    handledRepo: boolean;
    handledCanvas: boolean;
    handledNote: boolean;
  } | null>(null);
  const explorationSuggestionStatesRef = useRef<Record<string, ExplorationSuggestionState>>({});
  const dockDragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const exploreCanvasNodeRef = useRef<(nodeId: string) => void>(() => undefined);
  const openDraftCanvasForExplorationRef = useRef<
    ((branch: ExplorationBranch, options?: { activate?: boolean }) => Promise<void>) | null
  >(null);
  const copiedConsoleLinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerImageAttachmentsRef = useRef<ComposerImageAttachment[]>([]);

  const [, startStatusTransition] = useTransition();
  const [, startProjectTransition] = useTransition();
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

  const activeNoteTabId = activeTab?.type === "note" ? activeTab.nodeId : null;
  const activeNoteTabNode = useMemo(
    () => (activeNoteTabId ? canvasDocument?.nodes.find((item) => item.id === activeNoteTabId) ?? null : null),
    [activeNoteTabId, canvasDocument],
  );
  const editableCanvasNode = activeNoteTabNode ?? selectedCanvasNode;
  const activeExplorationSession =
    activeTab?.type === "exploration" ? explorationTabs[activeTab.explorationId] ?? null : null;
  const transientNotesExploration = activeTab?.type === "canvas" ? notesExploration : null;
  const currentExplorationSession = activeExplorationSession ?? transientNotesExploration;
  const currentCanvasSelectionIds = useMemo(
    () =>
      deriveCurrentCanvasSelectionIds(
        canvasDocument,
        currentExplorationSession,
        selectedCanvasNodeIds,
        activeTab,
        activeCanvasId,
      ),
    [activeCanvasId, activeTab, canvasDocument, currentExplorationSession, selectedCanvasNodeIds],
  );
  const inspectedComposerImage = useMemo(
    () => composerImageAttachments.find((item) => item.id === inspectedComposerImageId) ?? null,
    [composerImageAttachments, inspectedComposerImageId],
  );

  useEffect(() => {
    composerImageAttachmentsRef.current = composerImageAttachments;
  }, [composerImageAttachments]);

  useEffect(() => {
    if (!canvasRailMenu) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCanvasRailMenu(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canvasRailMenu]);

  useEffect(() => {
    if (!renamingCanvasId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      renamingCanvasInputRef.current?.focus();
      renamingCanvasInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [renamingCanvasId]);

  useEffect(() => {
    return () => {
      if (copiedConsoleLinkTimeoutRef.current) {
        clearTimeout(copiedConsoleLinkTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const attachment of composerImageAttachmentsRef.current) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (!inspectedComposerImageId) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setInspectedComposerImageId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [inspectedComposerImageId]);

  const handleCopyConsoleFileLink = useCallback((linkKey: string, href: string) => {
    void navigator.clipboard.writeText(href);
    setCopiedConsoleLinkKey(linkKey);
    if (copiedConsoleLinkTimeoutRef.current) {
      clearTimeout(copiedConsoleLinkTimeoutRef.current);
    }
    copiedConsoleLinkTimeoutRef.current = setTimeout(() => {
      setCopiedConsoleLinkKey((current) => (current === linkKey ? null : current));
    }, 1400);
  }, []);

  const removeComposerImageAttachment = useCallback((attachmentId: string) => {
    setComposerImageAttachments((current) => {
      const target = current.find((item) => item.id === attachmentId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== attachmentId);
    });
    setInspectedComposerImageId((current) => (current === attachmentId ? null : current));
  }, []);

  const clearComposerImageAttachments = useCallback(() => {
    setComposerImageAttachments((current) => {
      for (const attachment of current) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
      return [];
    });
  }, []);

  const handleComposerPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((item): item is File => item !== null);

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();

    for (const file of imageFiles) {
      const attachmentId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = URL.createObjectURL(file);
      setComposerImageAttachments((current) => [
        ...current,
        {
          id: attachmentId,
          fileName: file.name || "pasted-image.png",
          previewUrl,
          uploadedPath: null,
          contentType: file.type || "image/png",
          sizeBytes: file.size,
          status: "uploading",
          errorMessage: null,
        },
      ]);

      void (async () => {
        try {
          const response: ProjectImageUploadResponse = await uploadProjectImage(file);
          setComposerImageAttachments((current) =>
            current.map((item) =>
              item.id === attachmentId
                ? {
                    ...item,
                    fileName: response.file_name,
                    uploadedPath: response.file_path,
                    contentType: response.content_type,
                    sizeBytes: response.size_bytes,
                    status: "ready",
                    errorMessage: null,
                  }
                : item,
            ),
          );
        } catch (error) {
          setComposerImageAttachments((current) =>
            current.map((item) =>
              item.id === attachmentId
                ? {
                    ...item,
                    status: "error",
                    errorMessage: getErrorMessage(error),
                  }
                : item,
            ),
          );
        }
      })();
    }
  }, []);

  useEffect(() => {
    if (activeTab?.type === "note") {
      setDockVisibility("hidden");
      setConsoleVisibility("collapsed");
      return;
    }
    setDockVisibility("visible");
    setConsoleVisibility("collapsed");
  }, [activeTab?.type]);

  const openCanvasNodes = useMemo(() => {
    if (!canvasDocument) {
      return [];
    }
    return openCanvasNodeIds
      .map((nodeId) => canvasDocument.nodes.find((item) => item.id === nodeId) ?? null)
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [canvasDocument, openCanvasNodeIds]);

  const currentRailWidth = isRailExpanded ? railWidth : 72;
  const activeRepoPath = (project?.repo_path || repoPath).trim();
  const activeCanvasSummary = useMemo(
    () => projectCanvases.find((canvas) => canvas.id === activeCanvasId) ?? null,
    [activeCanvasId, projectCanvases],
  );
  const focusedCanvasNodeId =
    activeTab?.type === "note"
      ? activeTab.nodeId
      : currentExplorationSession?.activeNodeId ?? selectedCanvasNodeId;
  const activeProjectTreeItem = useMemo(
    () => projectsTree.find((item) => item.repo_path === activeRepoPath) ?? null,
    [activeRepoPath, projectsTree],
  );
  const activeTabCanvasId =
    activeTab?.type === "canvas"
      ? activeTab.canvasId
      : activeTab?.type === "note"
        ? activeTab.canvasId
        : activeTab?.type === "exploration"
          ? activeTab.canvasId
          : null;
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
  const activeNoteMention = useMemo(
    () => findActiveNoteMention(codexPrompt, composerCaretIndex, canvasDocument),
    [canvasDocument, codexPrompt, composerCaretIndex],
  );
  const isNoteMentionMode = !isSlashCommandMode && activeNoteMention !== null;
  const hasUploadingComposerImages = composerImageAttachments.some((item) => item.status === "uploading");
  const hasComposerImageErrors = composerImageAttachments.some((item) => item.status === "error");
  const readyComposerImagePaths = composerImageAttachments
    .filter((item) => item.status === "ready" && item.uploadedPath)
    .map((item) => item.uploadedPath as string);
  const isComposerBusy = isBuilding || isPlanning || isPushing || codexPending || hasUploadingComposerImages;
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
  const availableComposerModels = useMemo(() => {
    const items = [status?.codex_model, composerModel, ...GPT_MODEL_OPTIONS];
    return [...new Set(items.filter((item): item is string => Boolean(item && item.trim())))];
  }, [composerModel, status?.codex_model]);
  const focusedContextNode = useMemo(
    () => canvasDocument?.nodes.find((node) => node.id === focusedCanvasNodeId) ?? null,
    [canvasDocument, focusedCanvasNodeId],
  );
  const modelCommandItems = useMemo(
    () =>
      availableComposerModels.map<CommandResultItem>((model) => ({
        id: `set-model:${model}`,
        title: model,
        subtitle: model === composerModel ? "currently selected" : "switch model",
        group: "action",
        searchText: [model, "model"].join(" ").toLowerCase(),
        run: () => {
          setComposerModel(model);
          setComposerStatus(`Composer model set to ${model}.`);
          setCodexPrompt("");
          setLeaderScope(null);
        },
      })),
    [availableComposerModels, composerModel],
  );
  const reasoningCommandItems = useMemo(
    () =>
      ([
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
        { value: "xhigh", label: "Extra high" },
      ] as const).map<CommandResultItem>((item) => ({
        id: `set-reasoning:${item.value}`,
        title: item.label,
        subtitle: composerReasoning === item.value ? "currently selected" : "switch reasoning level",
        group: "action",
        searchText: [item.label, "reasoning"].join(" ").toLowerCase(),
        run: () => {
          setComposerReasoning(item.value);
          setComposerStatus(`Reasoning set to ${item.label}.`);
          setCodexPrompt("");
          setLeaderScope(null);
        },
      })),
    [composerReasoning],
  );
  const canvasCommandItems = useMemo(
    () =>
      projectCanvases.slice(0, 200).map<CommandResultItem>((canvas) => ({
        id: `canvas:${canvas.id}`,
        title: canvas.title,
        subtitle: `${canvas.node_count} note${canvas.node_count === 1 ? "" : "s"}`,
        group: "navigate",
        searchText: [canvas.title, "canvas"].join(" ").toLowerCase(),
        run: () => {
          setCodexPrompt("");
          setLeaderScope(null);
          const tabId = `canvas:${canvas.id}` as const;
          setOpenTabs((current) =>
            current.some((tab) => tab.id === tabId)
              ? current
              : [...current, { id: tabId, type: "canvas", canvasId: canvas.id }],
          );
          setActiveTabId(tabId);
        },
      })),
    [projectCanvases],
  );
  const noteCommandItems = useMemo(
    () =>
      (canvasDocument?.nodes ?? []).slice(0, 200).map<CommandResultItem>((node) => ({
        id: `note:${node.id}`,
        title: node.title,
        subtitle: node.tags.join(", ") || "note",
        group: "navigate",
        searchText: [node.title, node.description, node.tags.join(" "), "note"].join(" ").toLowerCase(),
        run: () => {
          setCodexPrompt("");
          setLeaderScope(null);
          if (!activeCanvasId) {
            return;
          }
          const tabId = `note:${activeCanvasId}:${node.id}` as const;
          setOpenCanvasNodeIds((current) => (current.includes(node.id) ? current : [...current, node.id]));
          setOpenTabs((current) =>
            current.some((tab) => tab.id === tabId)
              ? current
              : [...current, { id: tabId, type: "note", nodeId: node.id, canvasId: activeCanvasId }],
          );
          setActiveTabId(tabId);
        },
      })),
    [activeCanvasId, canvasDocument],
  );
  const projectCommandItems = projectsTree.slice(0, 200).map<CommandResultItem>((item) => ({
        id: `project:${item.repo_path}`,
        title: item.name,
        subtitle: item.repo_path,
        group: "navigate",
        searchText: [item.name, item.repo_path, "project"].join(" ").toLowerCase(),
        run: () => {
          setCodexPrompt("");
          setLeaderScope(null);
          startProjectTransition(() => {
            void openProjectConversation(item.repo_path);
          });
        },
      }));
  const conversationCommandItems = projectsTree
    .flatMap((item) =>
      item.conversations.map((conversation) => ({
        projectName: item.name,
        repoPath: item.repo_path,
        conversation,
      })),
    )
    .slice(0, 200)
    .map<CommandResultItem>((item) => ({
      id: `conversation:${item.repoPath}:${item.conversation.id}`,
      title: item.conversation.title,
      subtitle: `${item.projectName} · ${item.conversation.message_count} msg${item.conversation.message_count === 1 ? "" : "s"}`,
      group: "navigate",
      searchText: [item.conversation.title, item.projectName, item.repoPath, "conversation"].join(" ").toLowerCase(),
      run: () => {
        setCodexPrompt("");
        setLeaderScope(null);
        startProjectTransition(() => {
          void openProjectConversation(item.repoPath, item.conversation);
        });
      },
    }));
  const actionCommandItems = (() => {
    const items: CommandResultItem[] = [
      {
        id: "action-create-note",
        title: "Create note",
        subtitle: "Add a new note to the current canvas",
        group: "action",
        searchText: "create note new",
        run: () => {
          setCodexPrompt("");
          setLeaderScope(null);
          startCanvasTransition(() => {
            void handleCreateCanvasNodeAt();
          });
        },
      },
      {
        id: "action-create-canvas-from-selection",
        title: "Create canvas from selection",
        subtitle:
          currentCanvasSelectionIds.length === 0
            ? "Select one or more notes first"
            : `${currentCanvasSelectionIds.length} selected note${currentCanvasSelectionIds.length === 1 ? "" : "s"} will seed a focused canvas`,
        disabled: !activeRepoPath || currentCanvasSelectionIds.length === 0,
        group: "action",
        searchText: "create canvas from selection focused notes",
        run: () => {
          if (!activeRepoPath || currentCanvasSelectionIds.length === 0) {
            return;
          }
          setCodexPrompt("");
          setLeaderScope(null);
          startCanvasTransition(() => {
            void handleCreateCanvasFromSelection();
          });
        },
      },
      {
        id: "action-create-canvas-from-prompt",
        title: "Create canvas from prompt",
        subtitle: "Insert an explicit /new-canvas command into the composer",
        group: "action",
        searchText: "create canvas from prompt generate explicit",
        run: () => {
          setLeaderScope(null);
          setDockVisibility("visible");
          setConsoleVisibility("expanded");
          setCodexPrompt("/new-canvas ");
          window.setTimeout(() => {
            composerInputRef.current?.focus();
            const value = composerInputRef.current?.value ?? "/new-canvas ";
            composerInputRef.current?.setSelectionRange(value.length, value.length);
          }, 0);
        },
      },
      {
        id: "action-setup-canvas",
        title: canvasDocument?.nodes.length ? "Regenerate canvas" : "Set up canvas",
        subtitle: "Map the current project into canvas notes",
        group: "action",
        searchText: "canvas map generate setup regenerate",
        run: () => {
          setCodexPrompt("");
          setLeaderScope(null);
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
        searchText: "canvas reset clear",
        run: () => {
          setCodexPrompt("");
          setLeaderScope(null);
          startCanvasTransition(() => {
            void handleResetCanvas();
          });
        },
      },
      {
        id: "action-commit",
        title: "Commit changes",
        key: "c",
        subtitle: !activeRepoPath
          ? "Open a project first"
          : !commitStatus?.is_git_repo
            ? "Repository is not a git repository"
            : !commitStatus?.has_changes
              ? "Nothing to commit"
              : commitStatus?.suggested_message ?? "Create a git commit for the current repo",
        disabled: !activeRepoPath || !commitStatus?.is_git_repo || !commitStatus?.has_changes || isCommitting || isPushing,
        group: "action",
        searchText: "commit git save",
        run: () => {
          if (!activeRepoPath || !commitStatus?.is_git_repo || !commitStatus?.has_changes || isCommitting || isPushing) {
            return;
          }
          setCodexPrompt("");
          setLeaderScope(null);
          handleCommitClick();
        },
      },
      {
        id: "action-push",
        title: "Push commits",
        key: "p",
        subtitle: !activeRepoPath
          ? "Open a project first"
          : !commitStatus?.is_git_repo
            ? "Repository is not a git repository"
            : !commitStatus?.upstream_name
              ? "Current branch has no upstream configured"
              : !commitStatus?.can_push
                ? "Nothing to push"
                : `Push ${commitStatus.ahead_count} commit${commitStatus.ahead_count === 1 ? "" : "s"} to ${commitStatus.upstream_name}`,
        disabled: !activeRepoPath || !commitStatus?.is_git_repo || !commitStatus?.can_push || isCommitting || isPushing,
        group: "action",
        searchText: "push git publish upstream remote",
        run: () => {
          if (!activeRepoPath || !commitStatus?.is_git_repo || !commitStatus?.can_push || isCommitting || isPushing) {
            return;
          }
          setCodexPrompt("");
          setLeaderScope(null);
          handlePushClick();
        },
      },
      {
        id: "action-new-conversation",
        title: "New conversation",
        subtitle: "Start a new project conversation",
        group: "action",
        searchText: "conversation chat new",
        run: () => {
          setCodexPrompt("");
          setLeaderScope(null);
          startProjectTransition(() => {
            void createConversationForProject(activeRepoPath, "New conversation", { preserveActiveView: true });
          });
        },
      },
    ];

    if (focusedContextNode && !pinnedCanvasNodeIds.includes(focusedContextNode.id)) {
      items.push({
        id: "action-pin-current-note",
        title: `Pin ${focusedContextNode.title}`,
        subtitle: "Keep this note in working context while you explore",
        group: "action",
        searchText: ["pin current note", focusedContextNode.title].join(" ").toLowerCase(),
        run: () => {
          setCodexPrompt("");
          setLeaderScope(null);
          pinCanvasNode(focusedContextNode.id);
        },
      });
    }

    if (focusedContextNode && pinnedCanvasNodeIds.includes(focusedContextNode.id)) {
      items.push({
        id: "action-unpin-current-note",
        title: `Unpin ${focusedContextNode.title}`,
        subtitle: "Remove this note from persistent context",
        group: "action",
        searchText: ["unpin current note", focusedContextNode.title].join(" ").toLowerCase(),
        run: () => {
          setCodexPrompt("");
          setLeaderScope(null);
          unpinCanvasNode(focusedContextNode.id);
        },
      });
    }

    if (pinnedCanvasNodeIds.length > 0) {
      items.push({
        id: "action-clear-pinned",
        title: "Clear pinned notes",
        subtitle: `Remove ${pinnedCanvasNodeIds.length} pinned note${pinnedCanvasNodeIds.length === 1 ? "" : "s"}`,
        group: "action",
        searchText: "clear pinned context unpin",
        run: () => {
          setCodexPrompt("");
          setLeaderScope(null);
          clearPinnedCanvasNodes();
        },
      });
    }

    return items.filter((item) => {
      if (item.id === "action-new-conversation") {
        return !!activeRepoPath;
      }
      if (
        item.id === "action-create-note" ||
        item.id === "action-setup-canvas" ||
        item.id === "action-reset-canvas" ||
        item.id === "action-create-canvas-from-selection" ||
        item.id === "action-create-canvas-from-prompt"
      ) {
        return !!activeRepoPath;
      }
      return true;
    });
  })();
  const leaderRootItems = useMemo<LeaderGroupItem[]>(
    () => [
      { id: "leader-projects", key: "p", title: "Projects", subtitle: "Switch project", scope: "projects" },
      { id: "leader-canvases", key: "v", title: "Canvases", subtitle: "Open canvas", scope: "canvases" },
      { id: "leader-notes", key: "n", title: "Notes", subtitle: "Open note on current canvas", scope: "notes" },
      { id: "leader-conversations", key: "c", title: "Conversations", subtitle: "Open conversation", scope: "conversations" },
      { id: "leader-actions", key: "a", title: "Actions", subtitle: "Run canvas and project actions", scope: "actions" },
      { id: "leader-git", key: "g", title: "Git", subtitle: "Commit and push", scope: "git" },
      { id: "leader-models", key: "m", title: "Models", subtitle: "Switch model", scope: "models" },
      { id: "leader-reasoning", key: "r", title: "Reasoning", subtitle: "Switch reasoning level", scope: "reasoning" },
      {
        id: "leader-build-mode",
        key: "b",
        title: "Build mode",
        subtitle: "Set the composer to Build",
        run: () => {
          setComposerMode("build");
          setComposerStatus("Composer set to Build mode.");
          setLeaderScope(null);
        },
      },
      {
        id: "leader-plan-mode",
        key: "l",
        title: "Plan mode",
        subtitle: "Set the composer to Plan",
        run: () => {
          setComposerMode("plan");
          setComposerStatus("Composer set to Plan mode.");
          setLeaderScope(null);
        },
      },
    ],
    [],
  );
  const leaderItems = useMemo(() => {
    switch (leaderScope) {
      case "projects":
        return projectCommandItems.slice(0, 10);
      case "canvases":
        return canvasCommandItems.slice(0, 10);
      case "notes":
        return noteCommandItems.slice(0, 10);
      case "conversations":
        return conversationCommandItems.slice(0, 10);
      case "models":
        return modelCommandItems.slice(0, 10);
      case "reasoning":
        return reasoningCommandItems.slice(0, 10);
      case "actions":
        return actionCommandItems.slice(0, 10);
      case "git":
        return actionCommandItems.filter((item) => item.id === "action-commit" || item.id === "action-push").slice(0, 10);
      default:
        return [];
    }
  }, [
    actionCommandItems,
    canvasCommandItems,
    conversationCommandItems,
    leaderScope,
    modelCommandItems,
    noteCommandItems,
    projectCommandItems,
    reasoningCommandItems,
  ]);
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
    setProjectCanvases(activeProjectTreeItem?.canvases ?? []);
  }, [activeProjectTreeItem]);

  useEffect(() => {
    if (activeTabCanvasId) {
      setActiveCanvasId((current) => (current === activeTabCanvasId ? current : activeTabCanvasId));
      return;
    }
    if (!projectCanvases.length) {
      setActiveCanvasId(null);
      return;
    }
    setActiveCanvasId((current) => current ?? projectCanvases[0]?.id ?? null);
  }, [activeTabCanvasId, projectCanvases]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const repoParam = params.get("repo")?.trim() || null;
    const canvasParam = params.get("canvas")?.trim() || null;
    const noteParam = params.get("note")?.trim() || null;
    if (!repoParam && !canvasParam && !noteParam) {
      return;
    }
    urlIntentRef.current = {
      repoPath: repoParam,
      canvasId: canvasParam,
      noteId: noteParam,
      handledRepo: false,
      handledCanvas: false,
      handledNote: false,
    };
    if (repoParam) {
      expectedRepoPathRef.current = repoParam;
      setRepoPath(repoParam);
    }
  }, []);

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
          setProject((current) => current ?? { name: "", repo_path: "", recent_projects: [] });
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
          setCanvasDocument(null);
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
    if (project?.repo_path || repoPath.trim()) {
      return;
    }

    const fallbackRepoPath =
      status?.active_repo_path?.trim() ||
      projectsTree.find((item) => item.repo_path.trim())?.repo_path?.trim() ||
      "";
    if (!fallbackRepoPath) {
      return;
    }

    setRepoPath(fallbackRepoPath);
    setProject((current) => {
      if (current?.repo_path) {
        return current;
      }

      const recentProjects = [
        ...new Set(
          [
            ...(current?.recent_projects ?? []),
            ...projectsTree.map((item) => item.repo_path),
            fallbackRepoPath,
          ].filter((item) => item.trim()),
        ),
      ].slice(0, 8);

      return {
        name: current?.name || PathLabel(fallbackRepoPath),
        repo_path: fallbackRepoPath,
        recent_projects: recentProjects,
      };
    });
  }, [project?.repo_path, projectsTree, repoPath, status?.active_repo_path]);

  useEffect(() => {
    if (!project?.repo_path) {
      setActiveConversationId(null);
      setActiveConversationRepoPath(null);
      setConsoleMessages([]);
      setPendingPlan(null);
      setCommitStatus(null);
      setWorkspaceStatus(null);
      setExplorationBranches({});
      setExplorationSuggestionStates({});
      setCanvasEditPreview(null);
      setCanvasDocument(null);
      setProjectCanvases([]);
      setActiveCanvasId(null);
      return;
    }
    const repoPathValue = project.repo_path;
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
    if (!activeRepoPath) {
      setCanvasDocument(null);
      return;
    }

    startCanvasTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await fetchCanvas(activeRepoPath, activeCanvasId);
          if (expectedRepoPathRef.current && expectedRepoPathRef.current !== activeRepoPath) {
            return;
          }
          setCanvasDocument(response.document);
          setActiveCanvasId(response.document.id ?? activeCanvasId ?? null);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }, [activeCanvasId, activeRepoPath]);

  useEffect(() => {
    if (!activeRepoPath) {
      setProjectCanvases([]);
      return;
    }
    startProjectTransition(() => {
      void (async () => {
        try {
          const response = await fetchCanvases(activeRepoPath);
          if (expectedRepoPathRef.current && expectedRepoPathRef.current !== activeRepoPath) {
            return;
          }
          setProjectCanvases(response.canvases);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }, [activeRepoPath]);

  useEffect(() => {
    if (!activeRepoPath || projectCanvases.length === 0) {
      return;
    }
    const hasCanvasTab = openTabs.some(
      (tab) =>
        (tab.type === "canvas" || tab.type === "note" || tab.type === "exploration") &&
        tab.canvasId === projectCanvases[0]?.id,
    );
    if (hasCanvasTab) {
      return;
    }
    setOpenTabs((current) => {
      if (current.some((tab) => tab.type === "canvas" && tab.canvasId === projectCanvases[0].id)) {
        return current;
      }
      return [...current, { id: `canvas:${projectCanvases[0].id}`, type: "canvas", canvasId: projectCanvases[0].id }];
    });
    setActiveTabId((current) => current ?? `canvas:${projectCanvases[0].id}`);
  }, [activeRepoPath, openTabs, projectCanvases]);

  useEffect(() => {
    const intent = urlIntentRef.current;
    if (!intent || intent.handledRepo) {
      return;
    }
    if (!intent.repoPath) {
      intent.handledRepo = true;
      return;
    }
    if ((project?.repo_path ?? "").trim() === intent.repoPath) {
      intent.handledRepo = true;
      return;
    }
    intent.handledRepo = true;
    startProjectTransition(() => {
      void openProjectConversationRef.current?.(intent.repoPath as string);
    });
  }, [project?.repo_path]);

  useEffect(() => {
    const intent = urlIntentRef.current;
    if (!intent || intent.handledCanvas || !intent.canvasId || !activeRepoPath || !projectCanvases.length) {
      return;
    }
    if (intent.repoPath && intent.repoPath !== activeRepoPath) {
      return;
    }
    const targetCanvas = projectCanvases.find((canvas) => canvas.id === intent.canvasId);
    if (!targetCanvas) {
      return;
    }
    intent.handledCanvas = true;
    const tabId = `canvas:${targetCanvas.id}` as const;
    setOpenTabs((current) =>
      current.some((tab) => tab.id === tabId)
        ? current
        : [...current, { id: tabId, type: "canvas", canvasId: targetCanvas.id }],
    );
    setActiveTabId(tabId);
  }, [activeRepoPath, projectCanvases]);

  useEffect(() => {
    const intent = urlIntentRef.current;
    if (!intent || intent.handledNote || !intent.noteId || !intent.repoPath) {
      return;
    }
    if (activeRepoPath !== intent.repoPath || !canvasDocument) {
      return;
    }
    if (!canvasDocument.nodes.some((node) => node.id === intent.noteId)) {
      return;
    }
    intent.handledNote = true;
    if (!canvasDocument.id) {
      return;
    }
    const tabId = `note:${canvasDocument.id}:${intent.noteId}` as const;
    setOpenCanvasNodeIds((current) => (current.includes(intent.noteId!) ? current : [...current, intent.noteId!]));
    setOpenTabs((current) =>
      current.some((tab) => tab.id === tabId)
        ? current
        : [...current, { id: tabId, type: "note", nodeId: intent.noteId!, canvasId: canvasDocument.id! }],
    );
    setActiveTabId(tabId);
  }, [activeRepoPath, canvasDocument]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (activeRepoPath) {
      params.set("repo", activeRepoPath);
    }
    if (activeTab?.type === "canvas") {
      params.set("canvas", activeTab.canvasId);
    }
    if (activeTab?.type === "note") {
      params.set("canvas", activeTab.canvasId);
      params.set("note", activeTab.nodeId);
    }
    if (activeTab?.type === "exploration") {
      params.set("canvas", activeTab.canvasId);
    }
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [activeRepoPath, activeTab]);

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
    if (!editableCanvasNode) {
      setCanvasDraftTitle("");
      setCanvasDraftDescription("");
      setCanvasDraftTags("");
      setCanvasDraftFiles("");
      setCanvasDraftSymbols("");
      return;
    }
    setCanvasDraftTitle(editableCanvasNode.title);
    setCanvasDraftDescription(editableCanvasNode.description);
    setCanvasDraftTags(editableCanvasNode.tags.join(", "));
    setCanvasDraftFiles(editableCanvasNode.linked_files.join("\n"));
    setCanvasDraftSymbols(editableCanvasNode.linked_symbols.join("\n"));
  }, [editableCanvasNode]);

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
    try {
      const storedExpanded = window.localStorage.getItem("konceptura:rail:expanded");
      if (storedExpanded === "0") {
        setIsRailExpanded(false);
      } else if (storedExpanded === "1") {
        setIsRailExpanded(true);
      }

      const storedWidth = window.localStorage.getItem("konceptura:rail:width");
      if (storedWidth) {
        const parsedWidth = Number.parseInt(storedWidth, 10);
        if (Number.isFinite(parsedWidth)) {
          setRailWidth(Math.min(420, Math.max(240, parsedWidth)));
        }
      }

      const storedCanvasesExpanded = window.localStorage.getItem("konceptura:rail:canvases-expanded");
      if (storedCanvasesExpanded === "0") {
        setIsCanvasesSectionExpanded(false);
      } else if (storedCanvasesExpanded === "1") {
        setIsCanvasesSectionExpanded(true);
      }
    } catch {
      // Ignore localStorage failures and keep the rail usable.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("konceptura:rail:expanded", isRailExpanded ? "1" : "0");
      window.localStorage.setItem("konceptura:rail:width", `${railWidth}`);
      window.localStorage.setItem("konceptura:rail:canvases-expanded", isCanvasesSectionExpanded ? "1" : "0");
    } catch {
      // Ignore localStorage failures and keep the rail usable.
    }
  }, [isCanvasesSectionExpanded, isRailExpanded, railWidth]);

  useEffect(() => {
    explorationSuggestionStatesRef.current = explorationSuggestionStates;
  }, [explorationSuggestionStates]);

  useEffect(() => {
    if (!canvasEditPreview) {
      setCanvasEditReviewIndex(0);
      return;
    }
    setCanvasEditReviewIndex((current) =>
      Math.min(current, Math.max(canvasEditPreview.changes.length - 1, 0)),
    );
  }, [canvasEditPreview]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const isTypingIntoField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      const isLeaderSpace =
        (event.code === "Space" || event.key === " ") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !isTypingIntoField;

      if (isLeaderSpace) {
        event.preventDefault();
        setLeaderScope("root");
        setCommandSelectedIndex(0);
        return;
      }

      if (event.defaultPrevented) {
        return;
      }

      if (leaderScope) {
        if (event.key === "Escape") {
          event.preventDefault();
          setLeaderScope(null);
          return;
        }

        if (leaderScope === "root") {
          if (/^[a-z]$/i.test(event.key)) {
            const matchedItem = leaderRootItems.find((item) => item.key === event.key.toLowerCase()) ?? null;
            if (matchedItem) {
              event.preventDefault();
              setCommandSelectedIndex(0);
              if (matchedItem.scope) {
                setLeaderScope(matchedItem.scope);
              } else {
                matchedItem.run?.();
              }
              return;
            }
          }
        } else {
          if (/^[a-z]$/i.test(event.key)) {
            const keyedItem = leaderItems.find((item) => item.key === event.key.toLowerCase()) ?? null;
            if (keyedItem) {
              event.preventDefault();
              runCommandItem(keyedItem);
              return;
            }
          }
          const digitIndex = LEADER_DIGIT_KEYS.indexOf(event.key as (typeof LEADER_DIGIT_KEYS)[number]);
          if (digitIndex !== -1) {
            const selectedItem = leaderItems[digitIndex] ?? null;
            if (selectedItem && !selectedItem.disabled) {
              event.preventDefault();
              selectedItem.run();
            }
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setCommandSelectedIndex((current) =>
              leaderItems.length === 0 ? 0 : Math.min(current + 1, leaderItems.length - 1),
            );
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setCommandSelectedIndex((current) => Math.max(current - 1, 0));
            return;
          }
          if (event.key === "Enter") {
            const selectedItem =
              leaderItems[Math.min(commandSelectedIndex, Math.max(leaderItems.length - 1, 0))] ?? leaderItems[0];
            if (selectedItem && !selectedItem.disabled) {
              event.preventDefault();
              selectedItem.run();
            }
            return;
          }
          if (event.key === "Backspace") {
            event.preventDefault();
            setCommandSelectedIndex(0);
            setLeaderScope("root");
            return;
          }
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setLeaderScope(null);
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

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setIsRailExpanded((current) => !current);
        return;
      }

      const canUseCanvasOpenShortcut =
        !isTypingIntoField &&
        !leaderScope &&
        (activeTab?.type === "canvas" || activeTab?.type === "exploration") &&
        !!selectedCanvasNodeId &&
        !!canvasDocument?.nodes.find(
          (node) =>
            node.id === selectedCanvasNodeId &&
            !node.tags.includes("suggestion") &&
            !node.tags.includes("suggestion-loading") &&
            !node.id.startsWith("branch-summary:") &&
            !node.id.startsWith("explore-node:"),
        );
      if (canUseCanvasOpenShortcut && (event.key === "Enter" || event.key.toLowerCase() === "o")) {
        event.preventDefault();
        if (!activeCanvasId) {
          return;
        }
        const nodeId = selectedCanvasNodeId as string;
        const tabId = `note:${activeCanvasId}:${nodeId}` as const;
        setOpenCanvasNodeIds((current) => (current.includes(nodeId) ? current : [...current, nodeId]));
        setOpenTabs((current) =>
          current.some((tab) => tab.id === tabId)
            ? current
            : [...current, { id: tabId, type: "note", nodeId, canvasId: activeCanvasId }],
        );
        setActiveTabId(tabId);
        return;
      }

      if (canUseCanvasOpenShortcut && event.key.toLowerCase() === "x") {
        event.preventDefault();
        toggleCanvasNodeExpansion(selectedCanvasNodeId as string);
        return;
      }

      const canUseCanvasExploreShortcut =
        !isTypingIntoField &&
        !leaderScope &&
        activeTab?.type === "canvas" &&
        !!selectedCanvasNodeId &&
        !!canvasDocument?.nodes.find(
          (node) =>
            node.id === selectedCanvasNodeId &&
            !node.tags.includes("suggestion") &&
            !node.tags.includes("suggestion-loading") &&
            !node.id.startsWith("branch-summary:") &&
            !node.id.startsWith("explore-node:"),
        );
      if (canUseCanvasExploreShortcut && event.key.toLowerCase() === "e") {
        event.preventDefault();
        exploreCanvasNodeRef.current(selectedCanvasNodeId as string);
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
        setLeaderScope(null);
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
        activeTab?.type === "canvas" &&
        notesExploration &&
        canvasDocument
      ) {
        event.preventDefault();
        const promotedBranch = {
          ...notesExploration,
          id: notesExploration.id.startsWith("saved-") ? notesExploration.id : `saved-${Date.now()}`,
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
        setNotesExploration(promotedBranch);
        void openDraftCanvasForExplorationRef.current?.(promotedBranch);
        return;
      }

    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTab,
    canvasDocument,
    codexPrompt,
    commandSelectedIndex,
    leaderItems,
    leaderRootItems,
    leaderScope,
    notesExploration,
    activeCanvasId,
    selectedCanvasNodeId,
  ]);

  useEffect(() => {
    setCommandSelectedIndex(0);
  }, [codexPrompt, composerCaretIndex]);

  useEffect(() => {
    setCommandSelectedIndex(0);
  }, [leaderScope]);

  useEffect(() => {
    if (!requestedTitleFocusNodeId || activeNoteTabId !== requestedTitleFocusNodeId) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      noteTitleInputRef.current?.focus();
      noteTitleInputRef.current?.select();
      setRequestedTitleFocusNodeId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeNoteTabId, requestedTitleFocusNodeId]);

  useEffect(() => {
    if (isSlashCommandMode) {
      setDockVisibility("visible");
      setConsoleVisibility("expanded");
    }
  }, [isSlashCommandMode]);

  useEffect(() => {
    if (isNoteMentionMode) {
      setDockVisibility("visible");
      setConsoleVisibility("expanded");
    }
  }, [isNoteMentionMode]);

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
      if (!options?.preserveActiveView && activeCanvasId) {
        openCanvasTab(activeCanvasId);
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
      const response = await fetchCanvas(targetRepoPath, activeCanvasId);
      if (targetRepoPath && expectedRepoPathRef.current && expectedRepoPathRef.current !== targetRepoPath) {
        return;
      }
      setCanvasDocument(response.document);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleCreateProjectCanvas() {
    if (!activeRepoPath) {
      return;
    }

    startCanvasTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await createProjectCanvas(activeRepoPath);
          setCanvasDocument(response.document);
          setActiveCanvasId(response.document.id);
          await refreshProjectsTree();
          if (response.document.id) {
            openCanvasTab(response.document.id);
          }
          setComposerStatus(`Created ${response.document.title}.`);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  async function handleCreateCanvasFromSelection() {
    if (!activeRepoPath || !activeContextDocument || currentCanvasSelectionIds.length === 0) {
      return;
    }

    const snapshot = buildCanvasSnapshotFromSelection(activeContextDocument, currentCanvasSelectionIds);
    if (snapshot.nodes.length === 0) {
      setComposerStatus("Select at least one real note first.");
      return;
    }

    const suggestedTitle = buildCanvasTitleFromSelection(activeContextDocument, currentCanvasSelectionIds);

    startCanvasTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await createProjectCanvasFromSnapshot(
            activeRepoPath,
            suggestedTitle,
            snapshot.nodes,
            snapshot.edges,
          );
          setCanvasDocument(response.document);
          setActiveCanvasId(response.document.id);
          setCanvasEditPreview(null);
          await refreshProjectsTree();
          if (response.document.id) {
            openCanvasTab(response.document.id);
          }
          setComposerStatus(`Created ${response.document.title} from the current selection.`);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  async function handleCreateCanvasFromPrompt(promptValue: string) {
    const prompt = promptValue.trim();
    if (!activeRepoPath || !prompt) {
      return;
    }

    startCanvasTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          setComposerStatus("Creating a focused canvas from your prompt...");
          const response = await createProjectCanvasFromPrompt(activeRepoPath, prompt, deriveCanvasTitleFromPrompt(prompt));
          setCanvasDocument(response.document);
          setActiveCanvasId(response.document.id);
          setCanvasEditPreview(null);
          setCodexPrompt("");
          await refreshProjectsTree();
          if (response.document.id) {
            openCanvasTab(response.document.id);
          }
          setComposerStatus(response.summary?.trim() ? response.summary : `Created ${response.document.title}.`);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
          setComposerStatus("Canvas creation failed.");
        }
      })();
    });
  }

  function beginCanvasRename(canvas: CanvasSummary) {
    setCanvasRailMenu(null);
    setRenamingCanvasId(canvas.id);
    setRenamingCanvasTitle(canvas.title);
  }

  function cancelCanvasRename() {
    setRenamingCanvasId(null);
    setRenamingCanvasTitle("");
  }

  async function handleRenameProjectCanvas(canvas: CanvasSummary) {
    if (!activeRepoPath) {
      cancelCanvasRename();
      return;
    }

    const nextTitle = renamingCanvasTitle.trim();
    if (!nextTitle || nextTitle === canvas.title) {
      cancelCanvasRename();
      return;
    }

    startCanvasTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await renameProjectCanvas(activeRepoPath, canvas.id, nextTitle);
          setProjectCanvases((current) =>
            current.map((item) => (item.id === canvas.id ? { ...item, title: response.document.title } : item)),
          );
          setCanvasRailMenu(null);
          if (canvasDocument?.id === canvas.id) {
            setCanvasDocument(response.document);
          }
          await refreshProjectsTree();
          cancelCanvasRename();
          setComposerStatus(`Renamed canvas to ${response.document.title}.`);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  async function handleDuplicateProjectCanvas(canvas: CanvasSummary) {
    if (!activeRepoPath) {
      return;
    }
    const requestedTitle = window.prompt("Duplicate canvas as", `${canvas.title} Copy`)?.trim() || undefined;

    startCanvasTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await duplicateProjectCanvas(activeRepoPath, canvas.id, requestedTitle);
          setProjectCanvases((current) => [
            ...current,
            { id: response.document.id ?? `canvas-${Date.now()}`, title: response.document.title, node_count: response.document.nodes.length },
          ]);
          setCanvasRailMenu(null);
          await refreshProjectsTree();
          if (response.document.id) {
            openCanvasTab(response.document.id);
          }
          setComposerStatus(`Duplicated ${canvas.title} as ${response.document.title}.`);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  async function handleDeleteProjectCanvas(canvas: CanvasSummary) {
    if (!activeRepoPath) {
      return;
    }
    const shouldDelete = window.confirm(`Delete canvas "${canvas.title}"?`);
    if (!shouldDelete) {
      return;
    }

    startCanvasTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await deleteProjectCanvas(activeRepoPath, canvas.id);
          const nextCanvases = response.canvases;
          setProjectCanvases(nextCanvases);
          setCanvasRailMenu(null);
          setOpenTabs((current) =>
            current.filter(
              (tab) =>
                !(
                  (tab.type === "canvas" || tab.type === "note" || tab.type === "exploration") &&
                  tab.canvasId === canvas.id
                ),
            ),
          );
          setOpenCanvasNodeIds([]);
          setSelectedCanvasNodeId((current) => (current ? null : current));
          setSelectedCanvasNodeIds([]);
          setNotesExploration((current) => (current?.canvasId === canvas.id ? null : current));
          setExplorationTabs((current) =>
            Object.fromEntries(
              Object.entries(current)
                .filter(([, branch]) => branch.canvasId !== canvas.id)
                .map(([branchId, branch]) => [
                  branchId,
                  branch.draftCanvasId === canvas.id ? { ...branch, draftCanvasId: null } : branch,
                ]),
            ),
          );
          setExplorationBranches((current) =>
            Object.fromEntries(
              Object.entries(current)
                .filter(([, branch]) => branch.canvasId !== canvas.id)
                .map(([branchId, branch]) => [
                  branchId,
                  branch.draftCanvasId === canvas.id ? { ...branch, draftCanvasId: null } : branch,
                ]),
            ),
          );
          if (activeCanvasId === canvas.id) {
            const nextCanvasId = nextCanvases[0]?.id ?? null;
            setActiveCanvasId(nextCanvasId);
            setActiveTabId(nextCanvasId ? (`canvas:${nextCanvasId}` as const) : null);
            if (nextCanvasId) {
              setOpenTabs((current) =>
                current.some((tab) => tab.type === "canvas" && tab.canvasId === nextCanvasId)
                  ? current
                  : [...current, { id: `canvas:${nextCanvasId}`, type: "canvas", canvasId: nextCanvasId }],
              );
            } else {
              setCanvasDocument(null);
            }
          }
          await refreshProjectsTree();
          setComposerStatus(`Deleted ${canvas.title}.`);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  async function handleGenerateCanvas() {
    const targetRepoPath = activeRepoPath;
    if (!targetRepoPath || !activeCanvasId) {
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
            activeCanvasId,
          );
          setCanvasDocument(response.document);
          setCanvasEditPreview(null);
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

    const promptContextNodeIds = resolvePromptContextNodeIds(prompt, activeContextDocument, visibleContextNodeIds);
    const attachmentSummary = readyComposerImagePaths.length
      ? `Attached images: ${composerImageAttachments
          .filter((item) => item.status === "ready")
          .map((item) => item.fileName)
          .join(", ")}`
      : null;
    const userMessage: ConversationMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: attachmentSummary ? `${attachmentSummary}\n\n${prompt}` : prompt,
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
        activeCanvasId,
        buildSelectedNoteContext(activeContextDocument, promptContextNodeIds),
        buildConversationContext(pendingMessages),
        readyComposerImagePaths,
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
      clearComposerImageAttachments();
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

  async function submitPlanPrompt(
    promptValue = codexPrompt.trim(),
    options?: { preserveActiveView?: boolean },
  ) {
    const prompt = promptValue.trim();
    if (!prompt) {
      return;
    }

    const promptContextNodeIds = resolvePromptContextNodeIds(prompt, activeContextDocument, visibleContextNodeIds);
    const attachmentSummary = readyComposerImagePaths.length
      ? `Attached images: ${composerImageAttachments
          .filter((item) => item.status === "ready")
          .map((item) => item.fileName)
          .join(", ")}`
      : null;
    const userMessage: ConversationMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: attachmentSummary ? `${attachmentSummary}\n\n${prompt}` : prompt,
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
        activeCanvasId,
        buildSelectedNoteContext(activeContextDocument, promptContextNodeIds),
        buildConversationContext(pendingMessages),
        readyComposerImagePaths,
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
      clearComposerImageAttachments();
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
        activeCanvasId,
        buildSelectedNoteContext(activeContextDocument, visibleContextNodeIds),
        buildConversationContext(pendingMessages),
        readyComposerImagePaths,
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
      clearComposerImageAttachments();
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
    if (!activeRepoPath || !commitStatus?.has_changes || isCommitting || isPushing) {
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

  function handlePushClick() {
    if (!activeRepoPath || !commitStatus?.can_push || isPushing || isCommitting) {
      return;
    }
    startCodexTransition(() => {
      void (async () => {
        try {
          setIsPushing(true);
          setErrorMessage(null);
          setComposerStatus("Pushing commits...");
          const response = await pushProjectCommits(activeRepoPath);
          setComposerStatus(response.summary);
          await refreshCommitStatus(activeRepoPath);
          setConsoleMessages((current) => [
            ...current,
            {
              id: `assistant-push-${Date.now()}`,
              role: "assistant",
              title: response.upstream_name ? `Pushed to ${response.upstream_name}` : "Pushed commits",
              content: response.summary,
              created_at: new Date().toISOString(),
            },
          ]);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
          setComposerStatus("Push failed.");
        } finally {
          setIsPushing(false);
        }
      })();
    });
  }

  async function previewCanvasEditPrompt(prompt: string) {
    if (!activeRepoPath || !canvasDocument) {
      return;
    }

    const promptContextNodeIds = resolvePromptContextNodeIds(prompt, activeContextDocument, visibleContextNodeIds);
    if (promptContextNodeIds.length === 0) {
      setComposerStatus("Select or mention at least one note first.");
      setErrorMessage("Select or mention at least one note before drafting canvas changes.");
      return;
    }

    try {
      setIsPreviewingCanvasEdits(true);
      setErrorMessage(null);
      setComposerStatus("Drafting canvas note changes...");
      if (activeCanvasId) {
        openCanvasTab(activeCanvasId);
      }
      const response = await previewCanvasEdits(
        activeRepoPath,
        activeCanvasId,
        prompt,
        promptContextNodeIds,
        buildSelectedNoteContext(activeContextDocument, promptContextNodeIds),
        buildConversationContext(consoleMessages),
      );
      setCanvasEditPreview(response);
      setCanvasEditReviewIndex(0);
      setComposerStatus(response.summary);
      setCodexPrompt("");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setComposerStatus("Canvas edit preview failed.");
    } finally {
      setIsPreviewingCanvasEdits(false);
    }
  }

  async function applyCanvasEditDraft(acceptedChangeIds: string[]) {
    if (!activeRepoPath || !canvasEditPreview || acceptedChangeIds.length === 0) {
      return;
    }
    try {
      setIsApplyingCanvasEdits(true);
      setErrorMessage(null);
      setComposerStatus(
        acceptedChangeIds.length === canvasEditPreview.changes.length
          ? "Applying all canvas note changes..."
          : "Applying canvas note change...",
      );
      const response = await applyCanvasEdits(activeRepoPath, activeCanvasId, canvasEditPreview.changes, acceptedChangeIds);
      setCanvasDocument(response.document);
      setComposerStatus(response.note_changes_summary || response.summary);
      await refreshCommitStatus(activeRepoPath);
      const remainingIds = new Set(response.remaining_change_ids);
      const nextChanges = canvasEditPreview.changes.filter((change) => remainingIds.has(change.id));
      if (nextChanges.length === 0) {
        setCanvasEditPreview(null);
        setCanvasEditReviewIndex(0);
        return;
      }
      setCanvasEditPreview({
        ...canvasEditPreview,
        changes: nextChanges,
        direct_count: nextChanges.filter((change) => change.scope === "direct").length,
        impacted_count: nextChanges.filter((change) => change.scope === "impacted").length,
      });
      setCanvasEditReviewIndex(0);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setComposerStatus("Applying canvas changes failed.");
    } finally {
      setIsApplyingCanvasEdits(false);
    }
  }

  function dismissCanvasEditChange(changeId: string) {
    setCanvasEditPreview((current) => {
      if (!current) {
        return current;
      }
      const nextChanges = current.changes.filter((change) => change.id !== changeId);
      if (nextChanges.length === 0) {
        return null;
      }
      return {
        ...current,
        changes: nextChanges,
        direct_count: nextChanges.filter((change) => change.scope === "direct").length,
        impacted_count: nextChanges.filter((change) => change.scope === "impacted").length,
      };
    });
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
        setOpenTabs([]);
        setActiveTabId(null);
        setActiveCanvasId(null);
        setComposerStatus(`Opened ${PathLabel(normalizedRepoPath)}.`);
      }
      setRepoPath(normalizedRepoPath);
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
  openProjectConversationRef.current = openProjectConversation;

  async function handlePickProjectFolder() {
    startProjectTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await pickProjectFolder();
          const pickedRepoPath = response.repo_path?.trim() ?? "";
          if (!pickedRepoPath) {
            return;
          }
          setRepoPath(pickedRepoPath);
          const projectResponse = await updateProject({
            repo_path: pickedRepoPath,
            name: "",
            recent_projects: [],
          });
          setProject(projectResponse.project);
          void refreshProjectsTree();
          setWorkspaceStatus(null);
          setCanvasDocument(null);
          setSelectedCanvasNodeId(null);
          setSelectedCanvasNodeIds([]);
          setNotesExploration(null);
          setExplorationTabs({});
          setOpenCanvasNodeIds([]);
          setCanvasEditPreview(null);
          setOpenTabs([]);
          setActiveTabId(null);
          setActiveCanvasId(null);
          setActiveConversationId(null);
          setActiveConversationRepoPath(projectResponse.project.repo_path || null);
          setConsoleMessages([]);
          if (projectResponse.project.repo_path) {
            expectedRepoPathRef.current = projectResponse.project.repo_path;
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
          const response = await resetCanvas(targetRepoPath, activeCanvasId);
          setCanvasDocument(response.document);
          setSelectedCanvasNodeId(null);
          setSelectedCanvasNodeIds([]);
          setNotesExploration(null);
          setExplorationTabs({});
          setOpenCanvasNodeIds([]);
          setCanvasEditPreview(null);
          setOpenTabs([]);
          setActiveTabId(null);
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

  const openCanvasNode = useCallback((nodeId: string, options?: { focusTitle?: boolean; activate?: boolean }) => {
    if (!activeCanvasId) {
      return;
    }
    const tabId = `note:${activeCanvasId}:${nodeId}` as const;
    setOpenCanvasNodeIds((current) => (current.includes(nodeId) ? current : [...current, nodeId]));
    setOpenTabs((current) =>
      current.some((tab) => tab.id === tabId)
        ? current
        : [...current, { id: tabId, type: "note", nodeId, canvasId: activeCanvasId }],
    );
    if (options?.activate !== false) {
      setActiveTabId(tabId);
    }
    if (options?.focusTitle) {
      setRequestedTitleFocusNodeId(nodeId);
    }
  }, [activeCanvasId]);

  function handleRenameCanvasNode(nodeId: string) {
    openCanvasNode(nodeId, { focusTitle: true });
  }

  function handleActivateCanvasNode(nodeId: string) {
    const branchId = parseBranchSummaryNodeId(nodeId);
    if (branchId) {
      const branch = explorationBranches[branchId];
      if (branch) {
        void openDraftCanvasForExplorationRef.current?.(branch);
      }
      return;
    }

    const suggestion = notesExploration ? findSuggestionForBranch(notesExploration, nodeId) : null;
    if (suggestion && notesExploration) {
      materializeExplorationSuggestion(notesExploration, suggestion);
      return;
    }

    if (isTransientExplorationNodeId(nodeId)) {
      if (activeTab?.type === "exploration" && activeExplorationSession) {
        handleExplorationSelection(activeExplorationSession, [nodeId], { persistent: true });
        return;
      }
      if (notesExploration) {
        handleExplorationSelection(notesExploration, [nodeId]);
      }
      return;
    }

    setSelectedCanvasNodeId((current) => (current === nodeId ? current : nodeId));
    setSelectedCanvasNodeIds((current) => (current.length === 1 && current[0] === nodeId ? current : [nodeId]));
    setExpandedCanvasNodeId((current) => (current === nodeId ? null : nodeId));
  }

  const handleExploreCanvasNode = useCallback((nodeId: string) => {
    if (!canvasDocument) {
      return;
    }

    const branchId = parseBranchSummaryNodeId(nodeId);
    if (branchId) {
      const branch = explorationBranches[branchId];
      if (branch) {
        void openDraftCanvasForExplorationRef.current?.(branch);
      }
      return;
    }

    const node = canvasDocument.nodes.find((item) => item.id === nodeId);
    if (
      !node ||
      node.tags.includes("suggestion") ||
      node.tags.includes("suggestion-loading") ||
      node.id.startsWith("explore-node:")
    ) {
      return;
    }

    const nextBranch =
      notesExploration && notesExploration.rootNodeId === nodeId
        ? advanceExplorationBranch(notesExploration, nodeId)
        : activeCanvasId
          ? createExplorationBranch(nodeId, canvasDocument, activeCanvasId)
          : null;
    if (!nextBranch) {
      return;
    }
    setNotesExploration(nextBranch);
    setSelectedCanvasNodeId(nodeId);
    setSelectedCanvasNodeIds([nodeId]);
    setExpandedCanvasNodeId(nodeId);
  }, [activeCanvasId, canvasDocument, explorationBranches, notesExploration]);

  useEffect(() => {
    exploreCanvasNodeRef.current = handleExploreCanvasNode;
  }, [handleExploreCanvasNode]);

  function toggleCanvasNodeExpansion(nodeId: string) {
    setExpandedCanvasNodeId((current) => (current === nodeId ? null : nodeId));
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

  const openDraftCanvasForExploration = useCallback(async (
    branch: ExplorationBranch,
    options?: { activate?: boolean },
  ) => {
    if (!activeRepoPath || !canvasDocument) {
      return;
    }

    const knownCanvasId = branch.draftCanvasId;
    if (knownCanvasId) {
      const tabId = `canvas:${knownCanvasId}` as const;
      setOpenTabs((current) =>
        current.some((tab) => tab.id === tabId) ? current : [...current, { id: tabId, type: "canvas", canvasId: knownCanvasId }],
      );
      if (options?.activate !== false) {
        setActiveTabId(tabId);
      }
      if (options?.activate !== false) {
        setComposerStatus(`Opened ${buildExplorationDraftTitle(canvasDocument, branch)}.`);
      }
      return;
    }

    const snapshot = buildExplorationDraftSnapshot(canvasDocument, branch);
    if (snapshot.nodes.length === 0) {
      return;
    }

    try {
      setErrorMessage(null);
      const response = await createProjectCanvasFromSnapshot(
        activeRepoPath,
        buildExplorationDraftTitle(canvasDocument, branch),
        snapshot.nodes,
        snapshot.edges,
      );
      const nextCanvasId = response.document.id;
      if (!nextCanvasId) {
        return;
      }

      setProjectCanvases((current) => [
        ...current.filter((canvas) => canvas.id !== nextCanvasId),
        {
          id: nextCanvasId,
          title: response.document.title,
          node_count: response.document.nodes.length,
        },
      ]);
      setExplorationBranches((current) => {
        const currentBranch = current[branch.id];
        if (!currentBranch) {
          return current;
        }
        return {
          ...current,
          [branch.id]: {
            ...currentBranch,
            draftCanvasId: nextCanvasId,
          },
        };
      });
      setNotesExploration((current) =>
        current?.id === branch.id ? { ...current, draftCanvasId: nextCanvasId } : current,
      );
      setExplorationTabs((current) =>
        current[branch.id]
          ? {
              ...current,
              [branch.id]: {
                ...current[branch.id],
                draftCanvasId: nextCanvasId,
              },
            }
          : current,
      );
      await refreshProjectsTree();
      const tabId = `canvas:${nextCanvasId}` as const;
      setOpenTabs((current) =>
        current.some((tab) => tab.id === tabId) ? current : [...current, { id: tabId, type: "canvas", canvasId: nextCanvasId }],
      );
      if (options?.activate !== false) {
        setActiveTabId(tabId);
      }
      if (options?.activate !== false) {
        setComposerStatus(`Created ${response.document.title} from the exploration.`);
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }, [activeRepoPath, canvasDocument]);

  useEffect(() => {
    openDraftCanvasForExplorationRef.current = openDraftCanvasForExploration;
  }, [openDraftCanvasForExploration]);

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
        void openDraftCanvasForExplorationRef.current?.(branch);
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

  function handleCloseCanvasTab(canvasId: string, nodeId: string) {
    setOpenCanvasNodeIds((current) => {
      const next = current.filter((item) => item !== nodeId);
      if (selectedCanvasNodeId === nodeId) {
        setSelectedCanvasNodeId(next.at(-1) ?? null);
        setSelectedCanvasNodeIds(next.at(-1) ? [next.at(-1) as string] : []);
      }
      return next;
    });
    setOpenTabs((current) => {
      const next = current.filter(
        (item) => !(item.type === "note" && item.canvasId === canvasId && item.nodeId === nodeId),
      );
      if (activeTab?.type === "note" && activeTab.canvasId === canvasId && activeTab.nodeId === nodeId) {
        setActiveTabId(next.at(-1)?.id ?? null);
      }
      return next;
    });
  }

  const openCanvasTab = useCallback((canvasId: string, options?: { activate?: boolean }) => {
    const tabId = `canvas:${canvasId}` as const;
    setOpenTabs((current) =>
      current.some((tab) => tab.id === tabId) ? current : [...current, { id: tabId, type: "canvas", canvasId }],
    );
    if (options?.activate !== false) {
      setActiveTabId(tabId);
    }
  }, []);

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

  const commandResults: CommandResultItem[] = (() => {
    if (!isSlashCommandMode) {
      return [];
    }

    const trimmedCommand = commandQuery.trim();
    const loweredCommand = trimmedCommand.toLowerCase();
    const [commandNameRaw = ""] = trimmedCommand.split(/\s+/, 1);
    const commandName = commandNameRaw.toLowerCase();
    const commandArgs = commandNameRaw ? trimmedCommand.slice(commandNameRaw.length).trim() : "";
    const buildPrompt = commandName === "build" ? commandArgs : "";
    const planPrompt = commandName === "plan" ? commandArgs : "";

    if (commandName === "build" && !buildPrompt) {
      return leaderRootItems
        .filter((item) => item.id === "leader-build-mode")
        .map<CommandResultItem>((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          group: "action",
          searchText: [item.title, item.subtitle].join(" ").toLowerCase(),
          run: () => item.run?.(),
        }));
    }

    if (commandName === "plan" && !planPrompt) {
      return leaderRootItems
        .filter((item) => item.id === "leader-plan-mode")
        .map<CommandResultItem>((item) => ({
          id: item.id,
          title: item.title,
          subtitle: item.subtitle,
          group: "action",
          searchText: [item.title, item.subtitle].join(" ").toLowerCase(),
          run: () => item.run?.(),
        }));
    }

    if (commandName === "model") {
      const modelQuery = commandArgs.toLowerCase();
      return modelCommandItems
        .filter((item) => !modelQuery || item.title.toLowerCase().includes(modelQuery))
        .slice(0, 14);
    }

    if (commandName === "reasoning") {
      const reasoningQuery = commandArgs.toLowerCase();
      return reasoningCommandItems.filter((item) => {
        const haystack = [item.title, item.subtitle ?? ""].join(" ").toLowerCase();
        return !reasoningQuery || haystack.includes(reasoningQuery);
      });
    }

    if (commandName === "commit") {
      return actionCommandItems.filter((item) => item.id === "action-commit");
    }

    if (commandName === "push") {
      return actionCommandItems.filter((item) => item.id === "action-push");
    }

    if (commandName === "new-canvas") {
      if (!commandArgs) {
        return [
          {
            id: "execute-new-canvas-help",
            title: "Create a new canvas from prompt",
            subtitle: "Use /new-canvas <instruction> to generate a separate focused canvas explicitly",
            group: "execute",
            searchText: "new canvas generate prompt explicit",
            run: () => undefined,
          },
        ];
      }
      return [
        {
          id: "execute-new-canvas",
          title: `Create canvas: ${commandArgs}`,
          subtitle: !activeRepoPath
            ? "Open a project first"
            : "Generate a new focused canvas without editing the current one",
          disabled: !activeRepoPath,
          group: "execute",
          searchText: "new canvas generate prompt explicit",
          run: () => {
            if (!activeRepoPath) {
              return;
            }
            setLeaderScope(null);
            startCanvasTransition(() => {
              void handleCreateCanvasFromPrompt(commandArgs);
            });
          },
        },
      ];
    }

    if (commandName === "canvas") {
      const targetNoteIds = resolvePromptContextNodeIds(commandArgs, activeContextDocument, visibleContextNodeIds);
      if (!commandArgs) {
        return [
          {
            id: "execute-canvas-help",
            title: "Canvas edits",
            subtitle: "Use /canvas <instruction> to draft note changes for selected or @mentioned notes",
            group: "execute",
            searchText: "canvas edit notes architecture",
            run: () => undefined,
          },
        ];
      }
      return [
        {
          id: "execute-canvas-preview",
          title: `Preview canvas changes: ${commandArgs}`,
          subtitle:
            !activeRepoPath || !canvasDocument
              ? "Open a project canvas first"
              : targetNoteIds.length === 0
                ? "Select or mention at least one note"
                : `${targetNoteIds.length} target note${targetNoteIds.length === 1 ? "" : "s"} selected for review`,
          disabled: !activeRepoPath || !canvasDocument || targetNoteIds.length === 0,
          group: "execute",
          searchText: "canvas edit preview notes architecture",
          run: () => {
            if (!activeRepoPath || !canvasDocument || targetNoteIds.length === 0) {
              return;
            }
            setLeaderScope(null);
            startCodexTransition(() => {
              void previewCanvasEditPrompt(commandArgs);
            });
          },
        },
      ];
    }

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

    const query = loweredCommand;
    return [
      ...actionCommandItems,
      ...canvasCommandItems,
      ...noteCommandItems,
      ...projectCommandItems,
      ...conversationCommandItems,
    ]
      .filter((item) => {
        if (!query) {
          return true;
        }
        return (item.searchText ?? [item.title, item.subtitle ?? ""].join(" ").toLowerCase()).includes(query);
      })
      .slice(0, 14);
  })();

  const insertComposerNoteMention = useCallback(
    (node: CanvasNode) => {
      const mention = findActiveNoteMention(codexPrompt, composerCaretIndex, canvasDocument);
      const nextMentionText = `@${node.title} `;
      const nextValue = mention
        ? `${codexPrompt.slice(0, mention.start)}${nextMentionText}${codexPrompt.slice(mention.end)}`
        : `${codexPrompt}${nextMentionText}`;
      const nextCaretIndex = (mention ? mention.start : codexPrompt.length) + nextMentionText.length;

      setCodexPrompt(nextValue);
      setComposerCaretIndex(nextCaretIndex);
      setCommandSelectedIndex(0);
      window.requestAnimationFrame(() => {
        const element = composerInputRef.current;
        if (!element) {
          return;
        }
        element.focus();
        element.setSelectionRange(nextCaretIndex, nextCaretIndex);
        resizeComposerInput(element);
      });
    },
    [canvasDocument, codexPrompt, composerCaretIndex],
  );

  const mentionResults: CommandResultItem[] = useMemo(() => {
    if (!activeNoteMention || !canvasDocument) {
      return [];
    }

    const query = activeNoteMention.query.trim().toLowerCase();
    return canvasDocument.nodes
      .filter((node) => {
        if (!query) {
          return true;
        }
        const haystack = [node.title, node.tags.join(" "), node.description].join(" ").toLowerCase();
        return haystack.includes(query);
      })
      .sort((left, right) => {
        const leftStarts = left.title.toLowerCase().startsWith(query);
        const rightStarts = right.title.toLowerCase().startsWith(query);
        if (leftStarts !== rightStarts) {
          return leftStarts ? -1 : 1;
        }
        return left.title.localeCompare(right.title);
      })
      .slice(0, 10)
      .map<CommandResultItem>((node) => ({
        id: `mention:${node.id}`,
        title: node.title,
        subtitle: node.tags.join(", ") || "note",
        group: "navigate",
        run: () => {
          insertComposerNoteMention(node);
        },
      }));
  }, [activeNoteMention, canvasDocument, insertComposerNoteMention]);

  const composerResults = useMemo(
    () => (isSlashCommandMode ? commandResults : isNoteMentionMode ? mentionResults : []),
    [commandResults, isNoteMentionMode, isSlashCommandMode, mentionResults],
  );

  useEffect(() => {
    const isAnyDockExpanded = dockVisibility === "visible" && consoleVisibility === "expanded";
    if ((!isSlashCommandMode && !isNoteMentionMode) || !isAnyDockExpanded || composerResults.length === 0) {
      return;
    }

    const selectedResult =
      composerResults[Math.min(commandSelectedIndex, Math.max(composerResults.length - 1, 0))] ?? null;
    if (!selectedResult) {
      return;
    }

    const node = commandResultRefs.current[selectedResult.id];
    node?.scrollIntoView({ block: "nearest" });
  }, [commandSelectedIndex, composerResults, consoleVisibility, dockVisibility, isNoteMentionMode, isSlashCommandMode]);

  useEffect(() => {
    if (!leaderScope || leaderScope === "root" || leaderItems.length === 0) {
      return;
    }
    const selectedLeaderItem =
      leaderItems[Math.min(commandSelectedIndex, Math.max(leaderItems.length - 1, 0))] ?? null;
    if (!selectedLeaderItem) {
      return;
    }
    leaderResultRefs.current[selectedLeaderItem.id]?.scrollIntoView({ block: "nearest" });
  }, [commandSelectedIndex, leaderItems, leaderScope]);

  function runCommandItem(item: CommandResultItem | null | undefined) {
    if (!item || item.disabled) {
      return;
    }
    item.run();
  }

  function handleSubmitOmnibox() {
    const value = codexPrompt.trim();
    if (!value) {
      return;
    }

    setDockVisibility("visible");
    setConsoleVisibility("expanded");

    if (isSlashCommandMode || (isNoteMentionMode && composerResults.length > 0)) {
      const selectedResult =
        composerResults[Math.min(commandSelectedIndex, Math.max(composerResults.length - 1, 0))] ?? composerResults[0];
      runCommandItem(selectedResult);
      return;
    }

    startCodexTransition(() => {
      if (composerMode === "build") {
        void submitBuildPrompt(value, { preserveActiveView: true });
        return;
      }
      void submitPlanPrompt(value, { preserveActiveView: true });
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

    if (isSlashCommandMode || (isNoteMentionMode && composerResults.length > 0)) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCommandSelectedIndex((current) =>
          composerResults.length === 0 ? 0 : Math.min(current + 1, composerResults.length - 1),
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
    const element = composerInputRef.current;
    if (element) {
      setComposerCaretIndex(element.selectionStart ?? value.length);
    }
    window.requestAnimationFrame(() => {
      resizeComposerInput(composerInputRef.current);
    });
  }

  function handleComposerSelectionChange(event: SyntheticEvent<HTMLTextAreaElement>) {
    setComposerCaretIndex(event.currentTarget.selectionStart ?? 0);
  }

  function handleSelectTab(tab: OpenTab) {
    if (tab.type === "canvas") {
      setActiveCanvasId((current) => (current === tab.canvasId ? current : tab.canvasId));
    }
    if (tab.type === "note") {
      setActiveCanvasId((current) => (current === tab.canvasId ? current : tab.canvasId));
      setSelectedCanvasNodeId((current) => (current === tab.nodeId ? current : tab.nodeId));
      setSelectedCanvasNodeIds((current) =>
        current.length === 1 && current[0] === tab.nodeId ? current : [tab.nodeId],
      );
    }
    if (tab.type === "exploration") {
      setActiveCanvasId((current) => (current === tab.canvasId ? current : tab.canvasId));
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
    const tab = openTabs.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }
    if (tab.type === "note") {
      handleCloseCanvasTab(tab.canvasId, tab.nodeId);
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
        setActiveTabId(next.at(-1)?.id ?? null);
      }
      return next;
    });
  }

  async function handlePersistCanvasNodePosition(nodeId: string, x: number, y: number) {
    try {
      if (!activeRepoPath) {
        return;
      }
      const response = await updateCanvasNode(nodeId, activeRepoPath, activeCanvasId, { x, y });
      setCanvasDocument(response.document);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleCreateCanvasNodeAt(x = 96, y = 96) {
    if (!activeRepoPath || !activeCanvasId) {
      return;
    }
    startCanvasTransition(() => {
      void (async () => {
        try {
          const response = await createCanvasNode({
            repo_path: activeRepoPath,
            canvas_id: activeCanvasId,
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
      const branchCanvasId = explorationBranches[branchId]?.canvasId ?? activeCanvasId ?? null;
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
      setActiveTabId((current) =>
        current === `explore:${branchCanvasId ?? ""}:${branchId}`
          ? (`canvas:${branchCanvasId ?? ""}` as OpenTab["id"])
          : current,
      );
      return;
    }

    startCanvasTransition(() => {
      void (async () => {
        try {
          if (!activeRepoPath) {
            return;
          }
          const response = await deleteCanvasNode(nodeId, activeRepoPath, activeCanvasId);
          setCanvasDocument(response.document);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  async function handleSaveCanvasNode() {
    if (!editableCanvasNode || !activeRepoPath) {
      return;
    }
    startCanvasTransition(() => {
      void (async () => {
        try {
          if (!activeRepoPath) {
            return;
          }
          const response = await updateCanvasNode(editableCanvasNode.id, activeRepoPath, activeCanvasId, {
            title: canvasDraftTitle.trim(),
            description: canvasDraftDescription,
            tags: parseTagList(canvasDraftTags),
            x: editableCanvasNode.x,
            y: editableCanvasNode.y,
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

  function renderCanvasView() {
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
                onActivateNode={handleActivateCanvasNode}
                onExploreNode={handleExploreCanvasNode}
                onOpenNode={openCanvasNode}
                onRenameNode={handleRenameCanvasNode}
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
                selectedNodeIds={notesExploration?.activeNodeId ? [notesExploration.activeNodeId] : selectedCanvasNodeIds}
              />
              {renderCanvasEditReview()}
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
            onActivateNode={(nodeId) => {
              const suggestion = findSuggestionForBranch(branch, nodeId, { persistent: true });
              if (suggestion) {
                materializeExplorationSuggestion(branch, suggestion, { persistent: true });
                return;
              }
              if (isTransientExplorationNodeId(nodeId)) {
                handleExplorationSelection(branch, [nodeId], { persistent: true });
                return;
              }
              toggleCanvasNodeExpansion(nodeId);
            }}
            onExploreNode={(nodeId) => {
              const suggestion = findSuggestionForBranch(branch, nodeId, { persistent: true });
              if (suggestion) {
                materializeExplorationSuggestion(branch, suggestion, { persistent: true });
                return;
              }
              handleExplorationSelection(branch, [nodeId], { persistent: true });
            }}
            onOpenNode={openCanvasNode}
            onRenameNode={handleRenameCanvasNode}
            onSelectNode={(nodeId) => handleExplorationSelection(branch, [nodeId], { persistent: true })}
            onSelectNodes={(nodeIds) => handleExplorationSelection(branch, nodeIds, { persistent: true })}
            selectedNodeIds={branch.activeNodeId ? [branch.activeNodeId] : []}
          />
        </div>
      </div>
    );
  }

  function renderNoteTabView(nodeId: string) {
    const node = canvasDocument?.nodes.find((item) => item.id === nodeId) ?? null;
    const noteOutgoingEdges = canvasDocument?.edges.filter((edge) => edge.source_node_id === nodeId) ?? [];
    const noteIncomingEdges = canvasDocument?.edges.filter((edge) => edge.target_node_id === nodeId) ?? [];

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
                  ref={noteTitleInputRef}
                  value={canvasDraftTitle}
                />

                <div className={styles.noteMetaBar}>
                  <span>{node.linked_files.length} linked files</span>
                  <span>{node.linked_symbols.length} linked symbols</span>
                  <span>{noteOutgoingEdges.length} outgoing</span>
                  <span>{noteIncomingEdges.length} incoming</span>
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
                    {noteOutgoingEdges.map((edge) => (
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
                    {noteIncomingEdges.map((edge) => (
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

  function renderCanvasEditReview() {
    if (isPreviewingCanvasEdits) {
      return (
        <aside className={styles.canvasEditReview}>
          <div className={styles.canvasEditReviewHeader}>
            <strong className={styles.canvasEditReviewTitle}>Review canvas changes</strong>
            <span className={styles.canvasEditReviewMeta}>Drafting…</span>
          </div>
          <p className={styles.helperTextLoading}>Drafting direct and impacted note changes…</p>
        </aside>
      );
    }

    if (!canvasEditPreview || canvasEditPreview.changes.length === 0) {
      return null;
    }

    const currentChange =
      canvasEditPreview.changes[Math.min(canvasEditReviewIndex, Math.max(canvasEditPreview.changes.length - 1, 0))] ??
      null;
    if (!currentChange) {
      return null;
    }

    const changedFields = getChangedCanvasFields(currentChange.before_node, currentChange.after_node);
    const kindLabel = getCanvasChangeKindLabel(currentChange.kind);
    const edgeSummary = currentChange.after_edge ? describeCanvasEdgeChange(currentChange.after_edge, canvasEditPreview) : null;

    return (
      <aside className={styles.canvasEditReview}>
        <div className={styles.canvasEditReviewHeader}>
          <div>
            <strong className={styles.canvasEditReviewTitle}>Review canvas changes</strong>
            <div className={styles.canvasEditReviewMeta}>
              {canvasEditReviewIndex + 1}/{canvasEditPreview.changes.length} · {canvasEditPreview.direct_count} direct ·{" "}
              {canvasEditPreview.impacted_count} impacted
            </div>
          </div>
          <button className={styles.secondaryButton} onClick={() => setCanvasEditPreview(null)} type="button">
            Close
          </button>
        </div>

        <p className={styles.canvasEditReviewSummary}>{canvasEditPreview.summary}</p>

        <div className={styles.canvasEditReviewCard}>
          <div className={styles.canvasEditReviewBadges}>
            <span className={styles.canvasEditFieldChip}>{kindLabel}</span>
            <span className={currentChange.scope === "direct" ? styles.canvasEditBadgeDirect : styles.canvasEditBadgeImpacted}>
              {currentChange.scope === "direct" ? "Direct" : "Impacted"}
            </span>
            {changedFields.map((field) => (
              <span className={styles.canvasEditFieldChip} key={field}>
                {field}
              </span>
            ))}
          </div>

          <strong className={styles.canvasEditNodeTitle}>
            {currentChange.after_node?.title ??
              currentChange.before_node?.title ??
              currentChange.target_title ??
              edgeSummary ??
              "Canvas change"}
          </strong>
          <p className={styles.canvasEditReason}>{currentChange.reason}</p>
          {currentChange.impact_basis.length > 0 ? (
            <ul className={styles.canvasEditImpactList}>
              {currentChange.impact_basis.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}

          {currentChange.kind === "create_edge" && edgeSummary ? (
            <div className={styles.canvasEditSnapshot}>
              <span className={styles.canvasEditSnapshotLabel}>Link</span>
              <strong>{edgeSummary}</strong>
              <p>This edge will be added to the current canvas if you accept it.</p>
            </div>
          ) : currentChange.kind === "delete_node" && currentChange.before_node ? (
            <div className={styles.canvasEditSnapshot}>
              <span className={styles.canvasEditSnapshotLabel}>Remove</span>
              <strong>{currentChange.before_node.title}</strong>
              <p>{summarizeNote(currentChange.before_node.description)}</p>
            </div>
          ) : currentChange.kind === "create_node" && currentChange.after_node ? (
            <div className={styles.canvasEditSnapshot}>
              <span className={styles.canvasEditSnapshotLabel}>Create</span>
              <strong>{currentChange.after_node.title}</strong>
              <p>{summarizeNote(currentChange.after_node.description)}</p>
            </div>
          ) : currentChange.before_node && currentChange.after_node ? (
            <div className={styles.canvasEditDiffGrid}>
              <div className={styles.canvasEditSnapshot}>
                <span className={styles.canvasEditSnapshotLabel}>Before</span>
                <strong>{currentChange.before_node.title}</strong>
                <p>{summarizeNote(currentChange.before_node.description)}</p>
              </div>
              <div className={styles.canvasEditSnapshot}>
                <span className={styles.canvasEditSnapshotLabel}>After</span>
                <strong>{currentChange.after_node.title}</strong>
                <p>{summarizeNote(currentChange.after_node.description)}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className={styles.canvasEditReviewActions}>
          <div className={styles.canvasEditReviewNav}>
            <button
              className={styles.secondaryButton}
              disabled={canvasEditReviewIndex === 0}
              onClick={() => setCanvasEditReviewIndex((current) => Math.max(current - 1, 0))}
              type="button"
            >
              Previous
            </button>
            <button
              className={styles.secondaryButton}
              disabled={canvasEditReviewIndex >= canvasEditPreview.changes.length - 1}
              onClick={() =>
                setCanvasEditReviewIndex((current) => Math.min(current + 1, Math.max(canvasEditPreview.changes.length - 1, 0)))
              }
              type="button"
            >
              Next
            </button>
          </div>
          <div className={styles.canvasEditReviewNav}>
            <button
              className={styles.secondaryButton}
              disabled={isApplyingCanvasEdits}
              onClick={() => dismissCanvasEditChange(currentChange.id)}
              type="button"
            >
              Dismiss
            </button>
            <button
              className={styles.secondaryButton}
              disabled={isApplyingCanvasEdits}
              onClick={() => {
                void applyCanvasEditDraft([currentChange.id]);
              }}
              type="button"
            >
              Accept
            </button>
            <button
              className={styles.primaryButton}
              disabled={isApplyingCanvasEdits || canvasEditPreview.changes.length === 0}
              onClick={() => {
                void applyCanvasEditDraft(canvasEditPreview.changes.map((change) => change.id));
              }}
              type="button"
            >
              {isApplyingCanvasEdits ? "Applying..." : "Accept all"}
            </button>
          </div>
        </div>
      </aside>
    );
  }

  function renderUnifiedDock(mode: "floating" | "embedded" = "floating") {
    const selectedCommandResult =
      composerResults[Math.min(commandSelectedIndex, Math.max(composerResults.length - 1, 0))] ?? null;
    const isEmbedded = mode === "embedded";
    const isDockHidden = dockVisibility === "hidden";
    const isDockExpanded = consoleVisibility === "expanded";
    const floatingShellStyle = isEmbedded ? undefined : { transform: `translate(${dockOffset.x}px, ${dockOffset.y}px)` };

    if (isDockHidden) {
      return (
        <div className={isEmbedded ? styles.notesConsoleShellEmbedded : styles.notesConsoleShell} style={floatingShellStyle}>
          {isEmbedded ? (
            <div className={styles.notesConsoleHiddenRail}>
              <div className={styles.notesConsoleHiddenHandle}>
                <button
                  className={styles.notesConsoleHiddenShow}
                  onClick={() => {
                    setDockVisibility("visible");
                    setConsoleVisibility("collapsed");
                  }}
                  type="button"
                >
                  <span className={styles.notesConsoleBarLabel}>
                    {isSlashCommandMode ? "Commands" : isNoteMentionMode ? "Mention notes" : "Conversation"}
                  </span>
                  <span className={styles.notesConsoleHiddenMeta}>Show</span>
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.notesConsoleFloatingWrapHidden}>
              <div aria-hidden="true" className={styles.notesConsoleDockHiddenSpacer} />
              <div className={styles.notesConsoleExternalActions}>
                <button
                  aria-label="Move console"
                  className={[styles.notesConsoleExternalButton, styles.notesConsoleDragHandle].join(" ")}
                  onMouseDown={handleDockDragStart}
                  title="Drag console"
                  type="button"
                >
                  <span aria-hidden="true" className={styles.notesConsoleGripDots} />
                </button>
                <button
                  className={[styles.notesConsoleExternalButton, styles.notesConsoleShowButton].join(" ")}
                  onClick={() => {
                    setDockVisibility("visible");
                    setConsoleVisibility("collapsed");
                  }}
                  type="button"
                >
                  Show
                </button>
              </div>
            </div>
          )}
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
                  {composerResults.length === 0 ? (
                    <p className={styles.helperText}>Type a slash command, or search notes, projects, conversations, and canvases with `/`.</p>
                  ) : (
                    composerResults.map((item, index) => (
                      <button
                        className={
                          item.disabled
                            ? styles.commandResultDisabled
                            : index === commandSelectedIndex
                              ? styles.commandResultActive
                              : styles.commandResult
                        }
                        disabled={item.disabled}
                        key={item.id}
                        ref={(node) => {
                          commandResultRefs.current[item.id] = node;
                        }}
                        onClick={() => runCommandItem(item)}
                        type="button"
                      >
                        <span className={styles.commandResultTitle}>{item.title}</span>
                        {item.subtitle ? <span className={styles.commandResultMeta}>{item.subtitle}</span> : null}
                      </button>
                    ))
                  )}
                </div>
              ) : isNoteMentionMode ? (
                <div className={styles.commandResults}>
                  {composerResults.length === 0 ? (
                    <p className={styles.helperText}>No matching notes. Keep typing after `@` to refine the mention.</p>
                  ) : (
                    composerResults.map((item, index) => (
                      <button
                        className={
                          item.disabled
                            ? styles.commandResultDisabled
                            : index === commandSelectedIndex
                              ? styles.commandResultActive
                              : styles.commandResult
                        }
                        disabled={item.disabled}
                        key={item.id}
                        ref={(node) => {
                          commandResultRefs.current[item.id] = node;
                        }}
                        onClick={() => runCommandItem(item)}
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
                            copiedConsoleLinkKey,
                            handleCopyConsoleFileLink,
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
              <span className={styles.notesConsoleBarLabel}>
                {isSlashCommandMode ? "Commands" : isNoteMentionMode ? "Mention notes" : "Conversation"}
              </span>
              <span className={styles.notesConsoleBarSummary}>
                {(isSlashCommandMode || isNoteMentionMode) && selectedCommandResult
                  ? selectedCommandResult.title
                  : latestConsoleSummary}
              </span>
            </button>
          </div>

          <label className={styles.consoleComposer}>
            <textarea
              className={styles.consoleComposerInput}
              disabled={isComposerBusy}
              onChange={(event) => handleComposerChange(event.target.value)}
              onClick={handleComposerSelectionChange}
              onKeyDown={handleComposerKeyDown}
              onKeyUp={handleComposerSelectionChange}
              onPaste={handleComposerPaste}
              onSelect={handleComposerSelectionChange}
              placeholder="Ask about the project, describe a change, paste an image, or type / for commands."
              ref={composerInputRef}
              rows={2}
              value={codexPrompt}
            />
            {composerImageAttachments.length > 0 ? (
              <div className={styles.consoleComposerAttachments}>
                {composerImageAttachments.map((attachment) => (
                  <div className={styles.consoleComposerAttachment} key={attachment.id}>
                    <button
                      className={styles.consoleComposerAttachmentPreviewButton}
                      onClick={() => setInspectedComposerImageId(attachment.id)}
                      type="button"
                    >
                      <Image
                        alt={attachment.fileName}
                        className={styles.consoleComposerAttachmentPreview}
                        height={42}
                        src={attachment.previewUrl}
                        unoptimized
                        width={42}
                      />
                    </button>
                    <div className={styles.consoleComposerAttachmentMeta}>
                      <span className={styles.consoleComposerAttachmentName}>{attachment.fileName}</span>
                      <span className={styles.consoleComposerAttachmentStatus}>
                        {attachment.status === "uploading"
                          ? "Uploading image..."
                          : attachment.status === "error"
                            ? attachment.errorMessage || "Upload failed"
                            : `Attached image · ${formatBytes(attachment.sizeBytes)}`}
                      </span>
                    </div>
                    <button
                      className={styles.consoleComposerAttachmentRemove}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeComposerImageAttachment(attachment.id);
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
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
                  {(["build", "plan"] as const).map((mode) => (
                    <button
                      aria-selected={composerMode === mode}
                      className={composerMode === mode ? styles.consoleModeButtonActive : styles.consoleModeButton}
                      disabled={isComposerBusy}
                      key={mode}
                      onClick={() => setComposerMode(mode)}
                      role="tab"
                      type="button"
                    >
                      {mode === "build" ? "Build" : "Plan"}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.consoleComposerRight}>
                <button
                  className={styles.commitButton}
                  disabled={isCommitting || isPushing || !commitStatus?.has_changes}
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
                  className={styles.commitButton}
                  disabled={isPushing || isCommitting || !commitStatus?.can_push}
                  onClick={handlePushClick}
                  title={
                    !commitStatus?.is_git_repo
                      ? "Repository is not a git repository"
                      : !commitStatus?.upstream_name
                        ? "Current branch has no upstream configured"
                        : !commitStatus?.can_push
                          ? "Nothing to push"
                          : `Push ${commitStatus.ahead_count} commit${commitStatus.ahead_count === 1 ? "" : "s"} to ${commitStatus.upstream_name}`
                  }
                  type="button"
                >
                  Push
                </button>
                <button
                  className={styles.primaryButton}
                  disabled={
                    isComposerBusy ||
                    hasComposerImageErrors ||
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
                  ) : isPushing ? (
                    <>
                      <span aria-hidden="true" className={styles.buttonSpinner} />
                      <span>Pushing...</span>
                    </>
                  ) : (
                    <span>
                      {isSlashCommandMode || isNoteMentionMode
                        ? "Run"
                        : composerMode === "build"
                          ? "Build"
                          : "Plan"}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </label>
          </div>
          {inspectedComposerImage && typeof document !== "undefined"
            ? createPortal(
                <div
                  className={styles.consoleImagePreviewOverlay}
                  onClick={() => setInspectedComposerImageId(null)}
                  role="presentation"
                >
                <div
                  className={styles.consoleImagePreviewDialog}
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-label={inspectedComposerImage.fileName}
                >
                    <div className={styles.consoleImagePreviewHint}>Click outside to close</div>
                    <div className={styles.consoleImagePreviewStage}>
                      <div className={styles.consoleImagePreviewBody}>
                        <Image
                          alt={inspectedComposerImage.fileName}
                          className={styles.consoleImagePreviewImage}
                          height={960}
                          src={inspectedComposerImage.previewUrl}
                          unoptimized
                          width={1440}
                        />
                      </div>
                    </div>
                    <div className={styles.consoleImagePreviewCaption}>
                      <strong className={styles.consoleImagePreviewTitle}>{inspectedComposerImage.fileName}</strong>
                      <span className={styles.consoleImagePreviewInfo}>
                        {formatBytes(inspectedComposerImage.sizeBytes)}
                        {" · "}
                        {inspectedComposerImage.contentType}
                      </span>
                    </div>
                  </div>
                </div>,
                document.body,
              )
            : null}
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

  function renderLeaderOverlay() {
    if (!leaderScope) {
      return null;
    }

    if (leaderScope === "root") {
      return (
        <div className={styles.leaderOverlay}>
          <div className={styles.leaderOverlayPanel}>
            <div className={styles.leaderOverlayHeader}>
              <span className={styles.leaderOverlayTitle}>Leader</span>
              <span className={styles.leaderOverlayMeta}>Press a key</span>
            </div>
            <div className={styles.leaderRootGrid}>
              {leaderRootItems.map((item) => (
                <button
                  className={styles.leaderRootItem}
                  key={item.id}
                  onClick={() => {
                    if (item.scope) {
                      setLeaderScope(item.scope);
                    } else {
                      item.run?.();
                    }
                  }}
                  type="button"
                >
                  <span className={styles.leaderKeycap}>{item.key}</span>
                  <span className={styles.leaderRootText}>
                    <span className={styles.leaderRootTitle}>{item.title}</span>
                    <span className={styles.leaderRootMeta}>{item.subtitle}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.leaderOverlay}>
        <div className={styles.leaderOverlayPanel}>
          <div className={styles.leaderOverlayHeader}>
            <span className={styles.leaderOverlayTitle}>
              {leaderRootItems.find((item) => item.scope === leaderScope)?.title ?? "Commands"}
            </span>
            <span className={styles.leaderOverlayMeta}>1-9 / 0 to open, Backspace to go back</span>
          </div>
          <div className={styles.leaderResults}>
            {leaderItems.length === 0 ? (
              <p className={styles.helperText}>Nothing available here right now.</p>
            ) : (
              leaderItems.map((item, index) => (
                <button
                  className={
                    item.disabled
                      ? styles.leaderResultDisabled
                      : index === commandSelectedIndex
                        ? styles.leaderResultActive
                        : styles.leaderResult
                  }
                  disabled={item.disabled}
                  key={item.id}
                  onClick={() => runCommandItem(item)}
                  ref={(node) => {
                    leaderResultRefs.current[item.id] = node;
                  }}
                  type="button"
                >
                  <span className={styles.leaderResultNumber}>{item.key?.toUpperCase() ?? LEADER_DIGIT_KEYS[index] ?? "·"}</span>
                  <span className={styles.leaderResultText}>
                    <span className={styles.leaderResultTitle}>{item.title}</span>
                    {item.subtitle ? <span className={styles.leaderResultMeta}>{item.subtitle}</span> : null}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderProjectsTree() {
    if (!isRailExpanded) {
      return (
        <div className={styles.projectTreeSectionCompact}>
          {projectsTree.map((item) => {
            const isActiveProject = item.repo_path === (project?.repo_path ?? repoPath.trim());
            return (
              <button
                className={isActiveProject ? styles.projectTreeCompactButtonActive : styles.projectTreeCompactButton}
                key={item.repo_path}
                onClick={() => {
                  startProjectTransition(() => {
                    void openProjectConversation(item.repo_path);
                  });
                }}
                title={item.name}
                type="button"
              >
                <span className={styles.projectTreeCompactLabel}>{compactProjectLabel(item.name)}</span>
              </button>
            );
          })}
        </div>
      );
    }

    const activeProjectCanvases = activeProjectTreeItem?.canvases ?? [];

    return (
      <>
        <div className={styles.projectTreeSection}>
          <div className={styles.projectTreeRow}>
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
            <button
              className={styles.projectTreeAddButton}
              onClick={handlePickProjectFolder}
              title="Add project"
              type="button"
            >
              +
            </button>
          </div>

          {isRailExpanded && isProjectsSectionExpanded ? (
            <div className={styles.projectTreeList}>
              {projectsTree.length === 0 ? (
                <p className={styles.railMeta}>No recent projects yet.</p>
              ) : (
                projectsTree.map((item) => {
                  const isActiveProject = item.repo_path === (project?.repo_path ?? repoPath.trim());
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
                      </div>

                      {isProjectExpanded ? (
                        <div className={styles.projectTreeConversations}>
                          {item.conversations.map((conversation) => {
                            const isActiveConversation =
                              item.repo_path === activeConversationRepoPath && activeConversationId === conversation.id;
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

        {activeRepoPath ? (
          <div className={styles.projectTreeSection}>
            <div className={styles.projectTreeRow}>
              <button
                className={styles.projectTreeHeaderButton}
                onClick={() => setIsCanvasesSectionExpanded((current) => !current)}
                type="button"
              >
                <span className={styles.projectTreeLabel}>
                  <span className={styles.projectTreeChevron}>
                    <ChevronIcon expanded={isCanvasesSectionExpanded} />
                  </span>
                  <span className={styles.railIcon}>
                    <svg aria-hidden="true" viewBox="0 0 16 16">
                      <path d="M3 4.5h10M3 8h10M3 11.5h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
                    </svg>
                  </span>
                  <span>Canvases</span>
                </span>
              </button>
              <button
                className={styles.projectTreeAddButton}
                onClick={handleCreateProjectCanvas}
                title="Create canvas"
                type="button"
              >
                +
              </button>
            </div>
            {isCanvasesSectionExpanded ? (
              <div className={styles.projectTreeConversations}>
                {activeProjectCanvases.length === 0 ? (
                  <p className={styles.railMeta}>No canvases yet.</p>
                ) : (
                  activeProjectCanvases.map((canvas) => (
                    <div className={styles.projectTreeCanvasRow} key={canvas.id}>
                      {renamingCanvasId === canvas.id ? (
                        <div
                          className={
                            activeCanvasId === canvas.id
                              ? styles.projectTreeConversationActive
                              : styles.projectTreeConversation
                          }
                        >
                          <input
                            aria-label={`Rename ${canvas.title}`}
                            className={styles.projectTreeCanvasRenameInput}
                            onBlur={() => {
                              void handleRenameProjectCanvas(canvas);
                            }}
                            onChange={(event) => setRenamingCanvasTitle(event.currentTarget.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handleRenameProjectCanvas(canvas);
                                return;
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelCanvasRename();
                              }
                            }}
                            ref={renamingCanvasInputRef}
                            type="text"
                            value={renamingCanvasTitle}
                          />
                          <span className={styles.projectTreeConversationMeta}>
                            {canvas.node_count} note{canvas.node_count === 1 ? "" : "s"}
                          </span>
                        </div>
                      ) : (
                        <button
                          className={
                            activeCanvasId === canvas.id
                              ? styles.projectTreeConversationActive
                              : styles.projectTreeConversation
                          }
                          onClick={() => openCanvasTab(canvas.id)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setCanvasRailMenu({
                              canvas,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                          type="button"
                        >
                          <span className={styles.projectTreeConversationTitle}>{canvas.title}</span>
                          <span className={styles.projectTreeConversationMeta}>
                            {canvas.node_count} note{canvas.node_count === 1 ? "" : "s"}
                          </span>
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  function renderActiveView() {
    if (!activeRepoPath) {
      return <EmptyState message="Select a project from the left rail to start." />;
    }

    if (activeTab?.type === "note") {
      if (canvasDocument?.id !== activeTab.canvasId) {
        return <EmptyState message="Loading canvas..." />;
      }
      return renderNoteTabView(activeTab.nodeId);
    }
    if (activeTab?.type === "exploration") {
      if (canvasDocument?.id !== activeTab.canvasId) {
        return <EmptyState message="Loading canvas..." />;
      }
      return renderExplorationTab(explorationTabs[activeTab.explorationId] ?? null);
    }
    if (activeTab?.type === "canvas") {
      if (canvasDocument?.id !== activeTab.canvasId) {
        return <EmptyState message="Loading canvas..." />;
      }
      return renderCanvasView();
    }
    if (activeRepoPath && projectCanvases.length === 0) {
      return <EmptyState message="No canvases yet. Create one from the Canvases section in the left rail." />;
    }
    return <EmptyState message="Open a canvas from the left rail." />;
  }

  return (
    <div className={styles.page}>
      <div className={isRailExpanded ? styles.shellExpanded : styles.shell}>
        <aside className={isRailExpanded ? styles.leftRailExpanded : styles.leftRail} style={{ width: currentRailWidth }}>
          <nav className={styles.railNav}>
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
          {renderLeaderOverlay()}
          <div className={styles.tabStrip}>
            {openTabs.map((tab) => (
              <div className={activeTabId === tab.id ? styles.documentTabActive : styles.documentTab} key={tab.id}>
                <button
                  className={styles.documentTabButton}
                  onClick={() => handleSelectTab(tab)}
                  type="button"
                >
                  {tab.type === "canvas"
                    ? projectCanvases.find((canvas) => canvas.id === tab.canvasId)?.title ?? activeCanvasSummary?.title ?? "Canvas"
                    : tab.type === "note"
                      ? canvasDocument?.nodes.find((node) => node.id === tab.nodeId)?.title ?? "Note"
                      : explorationTabTitle(canvasDocument, explorationTabs[tab.explorationId] ?? null)}
                </button>
                <button className={styles.documentTabClose} onClick={() => closeTab(tab.id)} type="button">
                  ×
                </button>
              </div>
            ))}
          </div>

          {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}

          <section
            className={[
              activeTab?.type === "exploration" || activeTab?.type === "canvas"
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
      {canvasRailMenu && typeof document !== "undefined"
        ? createPortal(
            <div
              className={styles.projectTreeContextOverlay}
              onClick={() => setCanvasRailMenu(null)}
              onContextMenu={(event) => {
                event.preventDefault();
                setCanvasRailMenu(null);
              }}
              role="presentation"
            >
              <div
                className={styles.projectTreeContextMenu}
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
                role="menu"
                style={{ left: canvasRailMenu.x, top: canvasRailMenu.y }}
              >
                <button
                  className={styles.projectTreeContextItem}
                  onClick={() => {
                    beginCanvasRename(canvasRailMenu.canvas);
                  }}
                  type="button"
                >
                  Rename
                </button>
                <button
                  className={styles.projectTreeContextItem}
                  onClick={() => {
                    void handleDuplicateProjectCanvas(canvasRailMenu.canvas);
                  }}
                  type="button"
                >
                  Duplicate
                </button>
                <button
                  className={styles.projectTreeContextItemDanger}
                  onClick={() => {
                    void handleDeleteProjectCanvas(canvasRailMenu.canvas);
                  }}
                  type="button"
                >
                  Delete
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className={styles.helperText}>{message}</p>;
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

function compactProjectLabel(value: string) {
  const cleaned = value.trim();
  if (!cleaned) {
    return "?";
  }

  const parts = cleaned.split(/[\s-_]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }

  return cleaned.slice(0, 2).toUpperCase();
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

function createExplorationBranch(nodeId: string, document: CanvasDocument | null, canvasId: string): ExplorationBranch {
  const rootNode = document?.nodes.find((node) => node.id === nodeId) ?? null;
  return {
    id: `explore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    canvasId,
    draftCanvasId: null,
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
    draftCanvasId: branch.draftCanvasId ?? null,
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

  const relevantBranches = Object.values(branches).filter((branch) => branch.canvasId === document.id);
  const branchNodes = relevantBranches.map((branch) => {
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

  const branchEdges = relevantBranches.map((branch) => ({
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

function buildCanvasSnapshotFromSelection(
  document: CanvasDocument | null,
  nodeIds: string[],
) {
  if (!document || nodeIds.length === 0) {
    return { nodes: [] as CanvasNode[], edges: [] as CanvasEdge[] };
  }

  const selectedIdSet = new Set(uniqueNodeIds(nodeIds));
  const nodes = document.nodes
    .filter((node) => selectedIdSet.has(node.id))
    .map((node) => ({ ...node }));
  const edges = document.edges
    .filter((edge) => selectedIdSet.has(edge.source_node_id) && selectedIdSet.has(edge.target_node_id))
    .map((edge) => ({ ...edge }));
  return { nodes, edges };
}

function deriveCurrentCanvasSelectionIds(
  document: CanvasDocument | null,
  explorationBranch: ExplorationBranch | null,
  selectedNodeIds: string[],
  activeTab: OpenTab | null,
  activeCanvasId: string | null,
) {
  const contextDocument = buildExplorationContextDocument(document, explorationBranch);
  const ids = selectedNodeIds.filter((nodeId) => {
    if (nodeId.startsWith("branch-summary:")) {
      return false;
    }
    const node = contextDocument?.nodes.find((item) => item.id === nodeId) ?? null;
    if (!node) {
      return false;
    }
    return !node.tags.includes("suggestion") && !node.tags.includes("suggestion-loading");
  });
  if (ids.length > 0) {
    return ids;
  }
  if (
    activeTab?.type === "note" &&
    activeTab.canvasId === activeCanvasId &&
    contextDocument?.nodes.some((node) => node.id === activeTab.nodeId)
  ) {
    return [activeTab.nodeId];
  }
  return [];
}

function buildCanvasTitleFromSelection(
  document: CanvasDocument | null,
  nodeIds: string[],
) {
  const nodes = nodeIds
    .map((nodeId) => document?.nodes.find((node) => node.id === nodeId) ?? null)
    .filter((node): node is CanvasNode => Boolean(node));
  if (nodes.length === 1) {
    return `${nodes[0].title} Focus`;
  }
  if (nodes.length === 2) {
    return `${nodes[0].title} + ${nodes[1].title}`;
  }
  return `Focused Canvas (${nodes.length})`;
}

function deriveCanvasTitleFromPrompt(prompt: string) {
  const cleaned = prompt
    .replace(/^\/?new-canvas\s+/i, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) {
    return "New canvas";
  }
  return cleaned.length > 56 ? `${cleaned.slice(0, 53).trimEnd()}...` : cleaned;
}

function buildExplorationDraftSnapshot(
  document: CanvasDocument | null,
  branch: ExplorationBranch | null,
) {
  if (!document || !branch) {
    return { nodes: [] as CanvasNode[], edges: [] as CanvasEdge[] };
  }

  const contextDocument = buildExplorationContextDocument(document, branch);
  if (!contextDocument) {
    return { nodes: [] as CanvasNode[], edges: [] as CanvasEdge[] };
  }

  return buildCanvasSnapshotFromSelection(contextDocument, branch.revealedNodeIds);
}

function buildExplorationDraftTitle(
  document: CanvasDocument | null,
  branch: ExplorationBranch,
) {
  const rootTitle = findCanvasNodeTitle(buildExplorationContextDocument(document, branch), branch.rootNodeId);
  return `${rootTitle} Exploration`;
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
    left.canvasId === right.canvasId &&
    left.draftCanvasId === right.draftCanvasId &&
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

function resolvePromptContextNodeIds(prompt: string, document: CanvasDocument | null, baseNodeIds: string[]) {
  const explicitMentionIds = extractMentionedCanvasNodes(prompt, document).map((node) => node.id);
  return uniqueNodeIds([...baseNodeIds, ...explicitMentionIds]);
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

function getChangedCanvasFields(beforeNode: CanvasNode | null | undefined, afterNode: CanvasNode | null | undefined) {
  if (!beforeNode || !afterNode) {
    return [];
  }
  const fields: string[] = [];
  if (beforeNode.title !== afterNode.title) {
    fields.push("title");
  }
  if (beforeNode.description !== afterNode.description) {
    fields.push("description");
  }
  if (beforeNode.tags.join("\n") !== afterNode.tags.join("\n")) {
    fields.push("tags");
  }
  if (beforeNode.linked_files.join("\n") !== afterNode.linked_files.join("\n")) {
    fields.push("files");
  }
  if (beforeNode.linked_symbols.join("\n") !== afterNode.linked_symbols.join("\n")) {
    fields.push("symbols");
  }
  return fields;
}

function getCanvasChangeKindLabel(kind: CanvasEditChangeRecord["kind"]) {
  switch (kind) {
    case "create_node":
      return "Create note";
    case "delete_node":
      return "Delete note";
    case "create_edge":
      return "Create link";
    case "update_node":
    default:
      return "Update note";
  }
}

function describeCanvasEdgeChange(
  edge: NonNullable<CanvasEditChangeRecord["after_edge"]>,
  preview: CanvasEditPreviewResponse,
) {
  const nodesById = new Map<string, string>();
  for (const change of preview.changes) {
    if (change.after_node?.id && change.after_node.title) {
      nodesById.set(change.after_node.id, change.after_node.title);
    }
    if (change.before_node?.id && change.before_node.title) {
      nodesById.set(change.before_node.id, change.before_node.title);
    }
  }
  const sourceTitle = nodesById.get(edge.source_node_id) ?? edge.source_node_id;
  const targetTitle = nodesById.get(edge.target_node_id) ?? edge.target_node_id;
  return `${sourceTitle} ${edge.label || "links to"} ${targetTitle}`;
}

function findActiveNoteMention(prompt: string, caretIndex: number, document: CanvasDocument | null) {
  if (!document || document.nodes.length === 0 || caretIndex < 0) {
    return null;
  }

  const lineStart = Math.max(prompt.lastIndexOf("\n", Math.max(caretIndex - 1, 0)), prompt.lastIndexOf("\r", Math.max(caretIndex - 1, 0))) + 1;
  const beforeCaret = prompt.slice(lineStart, caretIndex);
  const atOffset = beforeCaret.lastIndexOf("@");
  if (atOffset === -1) {
    return null;
  }

  const start = lineStart + atOffset;
  const previousChar = start > 0 ? prompt[start - 1] : "";
  if (previousChar && !/\s|[(\[{'"`]/.test(previousChar)) {
    return null;
  }

  const query = prompt.slice(start + 1, caretIndex);
  if (query.includes("\n") || query.includes("\r") || query.endsWith(" ")) {
    return null;
  }

  const lowerQuery = query.toLowerCase();
  const titleClosesMention = document.nodes.some((node) => {
    const lowerTitle = node.title.trim().toLowerCase();
    return lowerTitle && lowerQuery.startsWith(`${lowerTitle} `);
  });
  if (titleClosesMention) {
    return null;
  }

  return { start, end: caretIndex, query };
}

function extractMentionedCanvasNodes(prompt: string, document: CanvasDocument | null) {
  if (!document || document.nodes.length === 0 || !prompt.includes("@")) {
    return [];
  }

  const nodes = [...document.nodes]
    .filter((node) => node.title.trim())
    .sort((left, right) => right.title.trim().length - left.title.trim().length);
  const lowerPrompt = prompt.toLowerCase();
  const matches = new Map<string, CanvasNode>();

  for (let index = 0; index < prompt.length; index += 1) {
    if (prompt[index] !== "@") {
      continue;
    }

    const previousChar = index > 0 ? prompt[index - 1] : "";
    if (previousChar && !/\s|[(\[{'"`]/.test(previousChar)) {
      continue;
    }

    for (const node of nodes) {
      const title = node.title.trim();
      const lowerTitle = title.toLowerCase();
      if (!lowerPrompt.startsWith(lowerTitle, index + 1)) {
        continue;
      }
      const afterIndex = index + 1 + lowerTitle.length;
      const afterChar = prompt[afterIndex] ?? "";
      if (afterChar && !/\s|[.,!?;:)\]}]/.test(afterChar)) {
        continue;
      }
      matches.set(node.id, node);
      break;
    }
  }

  return [...matches.values()];
}

function renderConsoleMessageContent(
  content: string,
  document: CanvasDocument | null,
  onOpenNode: (nodeId: string) => void,
  copiedLinkKey: string | null,
  onCopyLocalLink: (linkKey: string, href: string) => void,
) {
  const titleToId = new Map(
    (document?.nodes ?? [])
      .filter((node) => node.title.trim())
      .map((node) => [node.title.trim(), node.id] as const),
  );
  const titles = [...titleToId.keys()].sort((left, right) => right.length - left.length);
  const notePattern = titles.length
    ? new RegExp(`\\b(${titles.map(escapeRegExp).join("|")})\\b`, "g")
    : null;
  const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

  function renderPlainText(text: string, lineIndex: number, segmentKey: string) {
    if (!text) {
      return [];
    }
    if (!notePattern || titles.length === 0) {
      return [text];
    }

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    notePattern.lastIndex = 0;

    while ((match = notePattern.exec(text)) !== null) {
      const [matchedText] = match;
      const start = match.index;
      if (start > lastIndex) {
        parts.push(text.slice(lastIndex, start));
      }
      const nodeId = titleToId.get(matchedText.trim());
      if (nodeId) {
        parts.push(
          <button
            className={styles.consoleNoteLink}
            key={`${lineIndex}-${segmentKey}-${start}-${matchedText}`}
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

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : [text];
  }

  const lines = content.split("\n");

  return lines.map((line, lineIndex) => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    markdownLinkPattern.lastIndex = 0;

    while ((match = markdownLinkPattern.exec(line)) !== null) {
      const [fullMatch, label, href] = match;
      const start = match.index;
      if (start > lastIndex) {
        parts.push(...renderPlainText(line.slice(lastIndex, start), lineIndex, `plain-${start}`));
      }

      if (/^https?:\/\//i.test(href)) {
        parts.push(
          <a
            className={styles.consoleFileLink}
            href={href}
            key={`${lineIndex}-md-${start}-${label}`}
            rel="noreferrer"
            target="_blank"
          >
            {label}
          </a>,
        );
      } else {
        const linkKey = `${lineIndex}-md-${start}-${href}`;
        parts.push(
          <span className={styles.consoleFileLinkWrap} key={linkKey}>
            <button
              className={styles.consoleFileLink}
              onClick={() => onCopyLocalLink(linkKey, href)}
              title={href}
              type="button"
            >
              {label}
            </button>
            {copiedLinkKey === linkKey ? (
              <span className={styles.consoleFileLinkCopiedBubble} role="status">
                Copied path
              </span>
            ) : null}
          </span>,
        );
      }
      lastIndex = start + fullMatch.length;
    }

    if (lastIndex < line.length) {
      parts.push(...renderPlainText(line.slice(lastIndex), lineIndex, `tail-${lastIndex}`));
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

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  const kb = value / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
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

  const computedStyle = window.getComputedStyle(element);
  const cssMinHeight = Number.parseFloat(computedStyle.minHeight) || 62;
  const measuredHeight = element.getBoundingClientRect().height;
  const storedBaseHeight = Number.parseFloat(element.dataset.baseHeight || "");
  const baseHeight =
    Number.isFinite(storedBaseHeight) && storedBaseHeight > 0
      ? storedBaseHeight
      : Math.max(cssMinHeight, measuredHeight || 0);

  if (!element.dataset.baseHeight && baseHeight > 0) {
    element.dataset.baseHeight = `${baseHeight}`;
  }

  element.style.height = "0px";
  const nextHeight = Math.min(Math.max(element.scrollHeight, baseHeight), 148);
  element.style.height = `${nextHeight}px`;
}
