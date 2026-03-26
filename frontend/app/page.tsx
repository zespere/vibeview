"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import styles from "./page.module.css";
import { CanvasBoard } from "@/components/canvas-board";
import { StructureTree } from "@/components/structure-tree";
import {
  API_BASE_URL,
  buildProjectFromPrompt,
  createCanvasNode,
  createProjectCommit,
  deleteCanvasNode,
  fetchCanvas,
  fetchCommitStatus,
  fetchProjectConversation,
  fetchProjectsTree,
  fetchProject,
  fetchProjectAgents,
  fetchRelationships,
  fetchStatus,
  fetchStructure,
  createProjectConversation,
  runImpactAnalysis,
  runIndex,
  runQuery,
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
  type QueryMode,
  type QueryResponse,
  type RelationshipRecord,
  type StatusResponse,
  type StructureNode,
  type SymbolRecord,
} from "@/lib/api";

type WorkspaceView = "notes" | "inspect" | "project";
type OpenTab =
  | { id: `view:${WorkspaceView}`; type: "view"; view: WorkspaceView; preview: boolean }
  | { id: `note:${string}`; type: "note"; nodeId: string };

const VIEW_ITEMS: Array<{ id: WorkspaceView; label: string }> = [
  { id: "notes", label: "Notes" },
  { id: "inspect", label: "Inspect" },
  { id: "project", label: "Project" },
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
  const [projectsTree, setProjectsTree] = useState<ProjectTreeItem[]>([]);
  const [isProjectsSectionExpanded, setIsProjectsSectionExpanded] = useState(true);
  const [expandedProjectPaths, setExpandedProjectPaths] = useState<Set<string>>(new Set());
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationRepoPath, setActiveConversationRepoPath] = useState<string | null>(null);
  const [agentsDocument, setAgentsDocument] = useState<AgentsDocumentResponse | null>(null);
  const [agentsContent, setAgentsContent] = useState("");
  const [repoPath, setRepoPath] = useState("");
  const [cleanIndex, setCleanIndex] = useState(true);
  const [dryRunIndex, setDryRunIndex] = useState(false);
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
  const [composerStatus, setComposerStatus] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitStatus, setCommitStatus] = useState<CommitStatusResponse | null>(null);
  const [isConsoleExpanded, setIsConsoleExpanded] = useState(false);
  const [consoleMessages, setConsoleMessages] = useState<ConversationMessage[]>([]);
  const [canvasDocument, setCanvasDocument] = useState<CanvasDocument | null>(null);
  const [selectedCanvasNodeId, setSelectedCanvasNodeId] = useState<string | null>(null);
  const [openCanvasNodeIds, setOpenCanvasNodeIds] = useState<string[]>([]);
  const [canvasDraftTitle, setCanvasDraftTitle] = useState("");
  const [canvasDraftDescription, setCanvasDraftDescription] = useState("");
  const [canvasDraftTags, setCanvasDraftTags] = useState("");
  const [canvasDraftFiles, setCanvasDraftFiles] = useState("");
  const [canvasDraftSymbols, setCanvasDraftSymbols] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [statusPending, startStatusTransition] = useTransition();
  const [projectPending, startProjectTransition] = useTransition();
  const [agentsPending, startAgentsTransition] = useTransition();
  const [indexPending, startIndexTransition] = useTransition();
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
  const activeProjectTreeItem = useMemo(
    () => projectsTree.find((item) => item.repo_path === activeRepoPath) ?? null,
    [activeRepoPath, projectsTree],
  );
  const activeConversationSummary = useMemo(
    () =>
      activeProjectTreeItem?.conversations.find(
        (item) => item.id === activeConversationId && activeConversationRepoPath === activeProjectTreeItem.repo_path,
      ) ?? null,
    [activeConversationId, activeConversationRepoPath, activeProjectTreeItem],
  );
  const latestConsoleSummary = useMemo(() => {
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
  }, [activeConversationSummary, composerStatus, consoleMessages, isBuilding]);

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
      setCommitStatus(null);
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
  }, [project?.repo_path]);

  useEffect(() => {
    if (!canvasDocument?.repo_path) {
      return;
    }
    void refreshCommitStatus(canvasDocument.repo_path);
  }, [canvasDocument]);

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
    if (!canvasDocument) {
      return;
    }

    const validNodeIds = new Set(canvasDocument.nodes.map((node) => node.id));
    setOpenCanvasNodeIds((current) => current.filter((nodeId) => validNodeIds.has(nodeId)));
    setOpenTabs((current) =>
      current.filter((tab) => tab.type === "view" || validNodeIds.has(tab.nodeId)),
    );

    if (selectedCanvasNodeId && !validNodeIds.has(selectedCanvasNodeId)) {
      const fallbackNodeId = canvasDocument.nodes[0]?.id ?? null;
      setSelectedCanvasNodeId(fallbackNodeId);
      if (fallbackNodeId) {
        setOpenCanvasNodeIds((current) =>
          current.includes(fallbackNodeId) ? current : [fallbackNodeId, ...current],
        );
      }
    }
  }, [canvasDocument, selectedCanvasNodeId]);

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

  async function refreshAgentsDocument(nextRepoPath?: string) {
    try {
      setErrorMessage(null);
      const response = await fetchProjectAgents(nextRepoPath);
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
      setComposerStatus(`Ready in ${PathLabel(resolvedRepoPath)}.`);
      return;
    }

    try {
      setErrorMessage(null);
      const response = await fetchProjectConversation(resolvedRepoPath, conversation.id);
      setConsoleMessages(response.conversation.messages);
      setComposerStatus(`Opened ${response.conversation.title}.`);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function createConversationForProject(nextRepoPath: string, title = "New conversation") {
    try {
      setErrorMessage(null);
      const response = await createProjectConversation(nextRepoPath, title);
      setActiveConversationRepoPath(response.repo_path);
      setActiveConversationId(response.conversation.id);
      setConsoleMessages(response.conversation.messages);
      setComposerStatus(`Created ${response.conversation.title}.`);
      await refreshProjectsTree();
      openViewTab("notes");
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
      const targetRepoPath = nextRepoPath ?? (repoPath.trim() || project?.repo_path || undefined);
      const response = await fetchCanvas(targetRepoPath);
      setCanvasDocument(response.document);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function refreshCommitStatus(nextRepoPath?: string) {
    const targetRepoPath = nextRepoPath ?? repoPath.trim();
    if (!targetRepoPath) {
      setCommitStatus(null);
      return;
    }
    try {
      const response = await fetchCommitStatus(targetRepoPath);
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

  async function handleIndex() {
    startIndexTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const nextStatus = await runIndex(repoPath, cleanIndex, dryRunIndex);
          setStatus(nextStatus);
          if (!dryRunIndex) {
            setStructure(null);
            setSelectedTreeNode(null);
            setStructureRelationships([]);
          }
          void refreshCanvas(repoPath);
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
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

  async function submitArchitecturePrompt() {
    const prompt = codexPrompt.trim();
    if (!prompt) {
      return;
    }

    const userMessage: ConversationMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      title: "You",
      content: prompt,
      created_at: new Date().toISOString(),
    };
    const pendingMessages = [...consoleMessages, userMessage];
    setConsoleMessages(pendingMessages);
    setIsBuilding(true);
    let ensuredConversationId: string | null = null;
    try {
      setErrorMessage(null);
      setComposerStatus("Building the project and refreshing notes...");
      ensuredConversationId =
        activeConversationId && activeConversationRepoPath === activeRepoPath && activeConversationId !== "default"
          ? activeConversationId
          : await createConversationForProject(activeRepoPath, deriveConversationTitle(prompt));
      if (!ensuredConversationId) {
        setIsBuilding(false);
        return;
      }
      await persistConversationMessages(activeRepoPath, ensuredConversationId, pendingMessages);
      const response = await buildProjectFromPrompt(
        activeRepoPath,
        prompt,
        buildSelectedNoteContext(canvasDocument),
        [],
      );
      setCanvasDocument(response.document);
      setComposerStatus(response.summary);
      const assistantMessage: ConversationMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        title: response.summary,
        content: [response.code_summary, response.note_summary].filter(Boolean).join("\n\n"),
        created_at: new Date().toISOString(),
      };
      const nextMessages = [...pendingMessages, assistantMessage];
      setConsoleMessages(nextMessages);
      await persistConversationMessages(activeRepoPath, ensuredConversationId, nextMessages);
      setCodexPrompt("");
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
      void submitArchitecturePrompt();
    });
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

    try {
      setErrorMessage(null);
      if (isProjectSwitch) {
        const response = await updateProject({
          repo_path: normalizedRepoPath,
          name: "",
          recent_projects: [],
        });
        setProject(response.project);
        setCanvasDocument(null);
        setSelectedCanvasNodeId(null);
        setOpenCanvasNodeIds([]);
        setSelectedCanvasNodeIds(new Set());
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
        setComposerStatus(`Opened ${PathLabel(normalizedRepoPath)}.`);
      }
      await refreshProjectsTree();
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
          setActiveConversationId(null);
          setActiveConversationRepoPath(response.project.repo_path || null);
          setConsoleMessages([]);
          openViewTab("notes");
          await refreshProjectsTree();
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
          const response = await updateProjectAgents(agentsContent, repoPath.trim() || undefined);
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
          const targetRepoPath = repoPath.trim();
          const response = await resetCanvas(targetRepoPath);
          setCanvasDocument(response.document);
          setSelectedCanvasNodeId(null);
          setOpenCanvasNodeIds([]);
          setComposerStatus("Canvas reset.");
        } catch (error) {
          setErrorMessage(getErrorMessage(error));
        }
      })();
    });
  }

  function openCanvasNode(nodeId: string) {
    setSelectedCanvasNodeId(nodeId);
    setOpenCanvasNodeIds((current) => (current.includes(nodeId) ? current : [...current, nodeId]));
    setOpenTabs((current) =>
      current.some((tab) => tab.id === `note:${nodeId}`)
        ? current
        : [...current, { id: `note:${nodeId}`, type: "note", nodeId }],
    );
    setActiveTabId(`note:${nodeId}`);
  }

  function handleCloseCanvasTab(nodeId: string) {
    setOpenCanvasNodeIds((current) => {
      const next = current.filter((item) => item !== nodeId);
      if (selectedCanvasNodeId === nodeId) {
        setSelectedCanvasNodeId(next.at(-1) ?? null);
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
      setSelectedCanvasNodeId(tab.nodeId);
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

  function renderNotesView() {
    return (
      <div className={styles.notesWorkspace}>
        <div className={styles.notesConsoleShell}>
          <div className={styles.notesConsoleDock}>
            {isConsoleExpanded ? (
              <div className={styles.notesConsolePanel}>
                <div className={styles.notesConsoleMessages}>
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
                        <p className={styles.consoleMessageBody}>{message.content}</p>
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
                disabled={isBuilding}
                onChange={(event) => setCodexPrompt(event.target.value)}
                placeholder="Describe what to build in this project."
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
                <button
                  className={styles.primaryButton}
                  disabled={isBuilding || codexPending || !activeRepoPath || !codexPrompt.trim()}
                  onClick={handleSubmitArchitecturePrompt}
                  type="button"
                >
                  {isBuilding ? (
                    <>
                      <span aria-hidden="true" className={styles.buttonSpinner} />
                      <span>Building...</span>
                    </>
                  ) : (
                    "Build"
                  )}
                </button>
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
          ) : (
            <CanvasBoard
              onDeleteNode={handleDeleteCanvasNode}
              document={canvasDocument}
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
              onSelectNode={setSelectedCanvasNodeId}
              selectedNodeId={selectedCanvasNodeId}
            />
          )}
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

          {sampleRepos.length > 0 ? (
            <div className={styles.sampleRepoList}>
              {sampleRepos.map(([name, path]) => (
                <button className={styles.secondaryButton} key={name} onClick={() => applySampleRepo(path)} type="button">
                  {name}
                </button>
              ))}
            </div>
          ) : null}

          <div className={styles.optionGrid}>
            <label className={styles.checkboxRow}>
              <input checked={cleanIndex} onChange={(event) => setCleanIndex(event.target.checked)} type="checkbox" />
              <span>Clean rebuild</span>
            </label>
            <label className={styles.checkboxRow}>
              <input checked={dryRunIndex} onChange={(event) => setDryRunIndex(event.target.checked)} type="checkbox" />
              <span>Dry run only</span>
            </label>
          </div>

          <div className={styles.actionsRow}>
            <button className={styles.primaryButton} disabled={projectPending} onClick={handleSaveProject} type="button">
              {projectPending ? "Saving..." : "Open project"}
            </button>
            <button className={styles.secondaryButton} disabled={indexPending} onClick={handleIndex} type="button">
              {indexPending ? "Submitting..." : dryRunIndex ? "Preview index" : "Index repo"}
            </button>
            <button className={styles.secondaryButton} disabled={!repoPath.trim()} onClick={handleResetCanvas} type="button">
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
            <button className={styles.primaryButton} disabled={agentsPending || !repoPath.trim()} onClick={handleSaveAgentsDocument} type="button">
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

    switch (activeView) {
      case "notes":
        return renderNotesView();
      case "inspect":
        return renderInspectView();
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
            {VIEW_ITEMS.map((item) => (
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
                    ? VIEW_ITEMS.find((item) => item.id === tab.view)?.label ?? tab.view
                    : canvasDocument?.nodes.find((node) => node.id === tab.nodeId)?.title ?? "Note"}
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

function buildSelectedNoteContext(document: CanvasDocument | null) {
  if (!document || document.nodes.length === 0) {
    return undefined;
  }

  return rankRelevantNotes(document)
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
}

function rankRelevantNotes(document: CanvasDocument) {
  return [...document.nodes].sort((left, right) => {
    const leftScore = scoreNote(left);
    const rightScore = scoreNote(right);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return left.title.localeCompare(right.title);
  });
}

function scoreNote(node: CanvasNode) {
  return (
    node.linked_files.length * 5 +
    node.linked_symbols.length * 6 +
    node.tags.length * 2 +
    Math.min(node.description.trim().length, 220) / 55
  );
}

function summarizeNote(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "No description yet.";
  }
  const collapsed = trimmed.replace(/\s+/g, " ");
  return collapsed.length > 120 ? `${collapsed.slice(0, 117).trim()}...` : collapsed;
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
