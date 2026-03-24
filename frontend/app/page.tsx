"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import styles from "./page.module.css";
import { CanvasBoard } from "@/components/canvas-board";
import { CanvasGraph } from "@/components/canvas-graph";
import { StructureTree } from "@/components/structure-tree";
import {
  API_BASE_URL,
  createCanvasNode,
  fetchCanvas,
  fetchProject,
  fetchRelationships,
  fetchStatus,
  fetchStructure,
  runCodexChange,
  runImpactAnalysis,
  runIndex,
  runQuery,
  updateProject,
  updateCanvasNode,
  type AssistImpactResponse,
  type CanvasDocument,
  type CodexChangeResponse,
  type ProjectProfile,
  type QueryMode,
  type QueryResponse,
  type RelationshipRecord,
  type StatusResponse,
  type StructureNode,
  type SymbolRecord,
} from "@/lib/api";

type WorkspaceView = "build" | "notes" | "graph" | "inspect" | "project";
type OpenTab =
  | { id: `view:${WorkspaceView}`; type: "view"; view: WorkspaceView; preview: boolean }
  | { id: `note:${string}`; type: "note"; nodeId: string };

const VIEW_ITEMS: Array<{ id: WorkspaceView; label: string }> = [
  { id: "build", label: "Build" },
  { id: "notes", label: "Notes" },
  { id: "graph", label: "Graph" },
  { id: "inspect", label: "Inspect" },
  { id: "project", label: "Project" },
];

export default function Home() {
  const [isRailExpanded, setIsRailExpanded] = useState(true);
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([
    { id: "view:build", type: "view", view: "build", preview: false },
  ]);
  const [activeTabId, setActiveTabId] = useState<OpenTab["id"]>("view:build");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [project, setProject] = useState<ProjectProfile | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectStack, setProjectStack] = useState("");
  const [projectGoals, setProjectGoals] = useState("");
  const [projectConstraints, setProjectConstraints] = useState("");
  const [projectDesignDirection, setProjectDesignDirection] = useState("");
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
  const [codexPrompt, setCodexPrompt] = useState(
    "Add a short note to src/styles.css saying the UI is managed by Konceptura.",
  );
  const [codexDryRun, setCodexDryRun] = useState(true);
  const [codexUseGraphContext, setCodexUseGraphContext] = useState(true);
  const [codexBypassSandbox, setCodexBypassSandbox] = useState(true);
  const [codexResult, setCodexResult] = useState<CodexChangeResponse | null>(null);
  const [canvasDocument, setCanvasDocument] = useState<CanvasDocument | null>(null);
  const [selectedCanvasNodeId, setSelectedCanvasNodeId] = useState<string | null>(null);
  const [openCanvasNodeIds, setOpenCanvasNodeIds] = useState<string[]>([]);
  const [selectedCanvasNodeIds, setSelectedCanvasNodeIds] = useState<Set<string>>(new Set());
  const [canvasDraftTitle, setCanvasDraftTitle] = useState("");
  const [canvasDraftDescription, setCanvasDraftDescription] = useState("");
  const [canvasDraftTags, setCanvasDraftTags] = useState("");
  const [canvasDraftFiles, setCanvasDraftFiles] = useState("");
  const [canvasDraftSymbols, setCanvasDraftSymbols] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [statusPending, startStatusTransition] = useTransition();
  const [projectPending, startProjectTransition] = useTransition();
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
  const semanticContextPreview = buildSemanticContext(canvasDocument, selectedCanvasNodeIds);
  const sampleRepos = Object.entries(status?.sample_repos ?? {});

  useEffect(() => {
    startStatusTransition(() => {
      void refreshStatus();
    });
    startProjectTransition(() => {
      void refreshProject();
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
    if (!project) {
      return;
    }
    setProjectName(project.name);
    setProjectDescription(project.description);
    setProjectStack(project.stack);
    setProjectGoals(project.goals);
    setProjectConstraints(project.constraints);
    setProjectDesignDirection(project.design_direction);
    setRepoPath((current) => current || project.repo_path || status?.active_repo_path || status?.default_repo_path || "");
  }, [project, status]);

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
    setSelectedCanvasNodeIds((current) => {
      const next = new Set<string>();
      current.forEach((nodeId) => {
        if (validNodeIds.has(nodeId)) {
          next.add(nodeId);
        }
      });
      return next;
    });

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
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function refreshCanvas() {
    try {
      setErrorMessage(null);
      const response = await fetchCanvas();
      setCanvasDocument(response.document);
    } catch (error) {
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
          void refreshCanvas();
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

  async function submitCodexChange() {
    try {
      setErrorMessage(null);
      const response = await runCodexChange(
        repoPath,
        codexPrompt,
        codexDryRun,
        codexUseGraphContext,
        codexBypassSandbox,
        buildSemanticContext(canvasDocument, selectedCanvasNodeIds),
      );
      setCodexResult(response);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function handleSubmitCodexChange() {
    startCodexTransition(() => {
      void submitCodexChange();
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
      setCodexPrompt("Add a short note to src/styles.css saying the UI is managed by Konceptura.");
      return;
    }
    setQueryInput("user");
    setImpactPrompt("user");
    setCodexPrompt("Explain the smallest safe code change you would make for the current task.");
  }

  async function handleSaveProject() {
    startProjectTransition(() => {
      void (async () => {
        try {
          setErrorMessage(null);
          const response = await updateProject({
            name: projectName.trim(),
            description: projectDescription.trim(),
            repo_path: repoPath.trim(),
            stack: projectStack.trim(),
            goals: projectGoals.trim(),
            constraints: projectConstraints.trim(),
            design_direction: projectDesignDirection.trim(),
          });
          setProject(response.project);
          openViewTab("build");
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
        setActiveTabId(next.at(-1)?.id ?? "view:build");
      }
      return next;
    });
  }

  function openViewTab(view: WorkspaceView) {
    const id = `view:${view}` as const;
    if (view === "build") {
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
        (tab) => tab.type === "view" && tab.view !== "build" && tab.preview,
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
    if (tabId === "view:build") {
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
        setActiveTabId(next.at(-1)?.id ?? "view:build");
      }
      return next;
    });
  }

  function handleToggleCanvasNodeForCodex(nodeId: string) {
    setSelectedCanvasNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  function handleMoveCanvasNode(nodeId: string, x: number, y: number) {
    setCanvasDocument((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        nodes: current.nodes.map((item) => (item.id === nodeId ? { ...item, x, y } : item)),
      };
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
      <div className={styles.workspaceSingle}>
        <div className={styles.canvasFrame}>
          {!canvasDocument ? (
            <EmptyState message="Load or create a canvas for this repo. Double-click empty space to add a node." />
          ) : (
            <CanvasBoard
              document={canvasDocument}
              onCreateNodeAt={(x, y) => {
                startCanvasTransition(() => {
                  void handleCreateCanvasNodeAt(x, y);
                });
              }}
              onMoveNode={handleMoveCanvasNode}
              onMoveNodeEnd={(nodeId, x, y) => {
                startCanvasTransition(() => {
                  void handlePersistCanvasNodePosition(nodeId, x, y);
                });
              }}
              onOpenNode={openCanvasNode}
              onSelectNode={setSelectedCanvasNodeId}
              onToggleNodeForCodex={handleToggleCanvasNodeForCodex}
              selectedNodeId={selectedCanvasNodeId}
              selectedNodeIds={selectedCanvasNodeIds}
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

  function renderGraphView() {
    return (
      <div className={styles.workspaceSplit}>
        <div className={styles.workspacePrimary}>
          <div className={styles.graphFrame}>
            <CanvasGraph
              document={canvasDocument}
              onOpenNode={openCanvasNode}
              onSelectNode={openCanvasNode}
              selectedNodeId={selectedCanvasNodeId}
            />
          </div>
        </div>

        <div className={styles.workspaceSidebar}>
          <div className={styles.panelSurface}>
            {!selectedCanvasNode ? (
              <EmptyState message="Select a note in the graph to inspect it." />
            ) : (
              <div className={styles.inspectorPane}>
                <div className={styles.tagRow}>
                  {selectedCanvasNode.tags.length === 0 ? (
                    <span className={styles.tagChip}>untagged</span>
                  ) : (
                    selectedCanvasNode.tags.map((tag) => (
                      <span className={styles.tagChip} key={tag}>
                        {tag}
                      </span>
                    ))
                  )}
                </div>
                <strong className={styles.resultTitle}>{selectedCanvasNode.title}</strong>
                <p className={styles.resultMeta}>{selectedCanvasNode.description}</p>

                <div className={styles.actionsRow}>
                  <button className={styles.primaryButton} onClick={handleSaveCanvasNode} type="button">
                    Save changes
                  </button>
                  <button className={styles.secondaryButton} onClick={() => openCanvasNode(selectedCanvasNode.id)} type="button">
                    Open note tab
                  </button>
                </div>

                <div className={styles.detailGrid}>
                  <DetailRow label="Outgoing" value={String(canvasOutgoingEdges.length)} />
                  <DetailRow label="Incoming" value={String(canvasIncomingEdges.length)} />
                </div>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Title</span>
                  <input
                    className={styles.input}
                    onChange={(event) => setCanvasDraftTitle(event.target.value)}
                    value={canvasDraftTitle}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Tags</span>
                  <input
                    className={styles.input}
                    onChange={(event) => setCanvasDraftTags(event.target.value)}
                    placeholder="screen, users, crud"
                    value={canvasDraftTags}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Description</span>
                  <textarea
                    className={styles.textarea}
                    onChange={(event) => setCanvasDraftDescription(event.target.value)}
                    rows={6}
                    value={canvasDraftDescription}
                  />
                </label>

                <div>
                  <span className={styles.fieldLabel}>Connections</span>
                  <ul className={styles.relationshipList}>
                    {canvasOutgoingEdges.map((edge) => (
                      <li className={styles.relationshipItem} key={edge.id}>
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
                      <li className={styles.relationshipItem} key={edge.id}>
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

  function renderBuildView() {
    return (
      <div className={styles.workspaceSplit}>
        <div className={styles.workspacePrimary}>
          <div className={styles.panelSurface}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>What should Konceptura build next?</span>
              <textarea
                className={styles.textarea}
                onChange={(event) => setCodexPrompt(event.target.value)}
                rows={7}
                value={codexPrompt}
              />
            </label>

            <div className={styles.optionGrid}>
              <label className={styles.checkboxRow}>
                <input checked={codexDryRun} onChange={(event) => setCodexDryRun(event.target.checked)} type="checkbox" />
                <span>Dry run only</span>
              </label>
              <label className={styles.checkboxRow}>
                <input
                  checked={codexUseGraphContext}
                  onChange={(event) => setCodexUseGraphContext(event.target.checked)}
                  type="checkbox"
                />
                <span>Use graph context</span>
              </label>
              <label className={styles.checkboxRow}>
                <input
                  checked={codexBypassSandbox}
                  onChange={(event) => setCodexBypassSandbox(event.target.checked)}
                  type="checkbox"
                />
                <span>Bypass sandbox</span>
              </label>
            </div>

            <div className={styles.actionsRow}>
              <button
                className={styles.primaryButton}
                disabled={codexPending || !status?.codex_ok}
                onClick={handleSubmitCodexChange}
                type="button"
              >
                {codexPending ? "Working..." : "Build"}
              </button>
            </div>

            <div className={styles.resultsPane}>
              {!codexResult ? (
                <EmptyState message="Describe the next feature or change and let Konceptura implement it." />
              ) : codexResult.changed_files.length === 0 ? (
                <EmptyState
                  message={
                    codexResult.dry_run
                      ? "Dry run completed without writing files."
                      : "Konceptura finished without detecting text-file changes."
                  }
                />
              ) : (
                <div className={styles.inspectorPane}>
                  <p className={styles.helperText}>{codexResult.summary}</p>
                  <div className={styles.detailGrid}>
                    <DetailRow label="Changed areas" value={String(codexResult.changed_files.length)} />
                    <DetailRow label="Commands" value={String(codexResult.commands.length)} />
                    <DetailRow label="Graph context" value={codexResult.used_graph_context ? "yes" : "no"} />
                    <DetailRow label="Mode" value={codexResult.dry_run ? "preview" : "write"} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className={styles.workspaceSidebar}>
          <div className={styles.panelSurface}>
            <span className={styles.fieldLabel}>Project context</span>
            {project?.name ? <strong className={styles.resultTitle}>{project.name}</strong> : null}
            {project?.description ? <p className={styles.resultMeta}>{project.description}</p> : null}
            {semanticContextPreview ? (
              <pre className={styles.codeBlockInline}>{semanticContextPreview}</pre>
            ) : (
              <p className={styles.helperText}>Select notes with the `Codex` checkbox to steer the current build task.</p>
            )}
            <div className={styles.detailGrid}>
              <DetailRow label="Repo" value={repoPath ? "ready" : "missing"} />
              <DetailRow label="Codex" value={status?.codex_ok ? "ready" : "missing"} />
              <DetailRow label="Index" value={status?.index_job.status ?? "idle"} />
              <DetailRow label="Notes" value={String(selectedCanvasNodeIds.size)} />
            </div>
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
            <span className={styles.fieldLabel}>Project name</span>
            <input className={styles.input} onChange={(event) => setProjectName(event.target.value)} value={projectName} />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>What is this project?</span>
            <textarea className={styles.textarea} onChange={(event) => setProjectDescription(event.target.value)} rows={3} value={projectDescription} />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Repository path</span>
            <input className={styles.input} onChange={(event) => setRepoPath(event.target.value)} value={repoPath} />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Stack</span>
            <input className={styles.input} onChange={(event) => setProjectStack(event.target.value)} placeholder="Next.js, React, TypeScript, SQLite" value={projectStack} />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Goals</span>
            <textarea className={styles.textarea} onChange={(event) => setProjectGoals(event.target.value)} rows={4} value={projectGoals} />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Constraints</span>
            <textarea className={styles.textarea} onChange={(event) => setProjectConstraints(event.target.value)} rows={4} value={projectConstraints} />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Design direction</span>
            <textarea className={styles.textarea} onChange={(event) => setProjectDesignDirection(event.target.value)} rows={3} value={projectDesignDirection} />
          </label>

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
              {projectPending ? "Saving..." : "Save project"}
            </button>
            <button className={styles.secondaryButton} disabled={indexPending} onClick={handleIndex} type="button">
              {indexPending ? "Submitting..." : dryRunIndex ? "Preview index" : "Index repo"}
            </button>
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

          {status?.active_repo_path ? <p className={styles.sidebarText}>{status.active_repo_path}</p> : null}
          {status?.index_job.message ? <pre className={styles.noteBlock}>{status.index_job.message}</pre> : null}
          {status?.preview ? <pre className={styles.noteBlock}>{status.preview}</pre> : null}

          <div className={styles.metaList}>
            <MetaRow label="Config" value={status?.config_path ?? "—"} />
            <MetaRow label="Log" value={status?.log_path ?? "—"} />
            <MetaRow label="Codex" value={status?.codex_binary ?? "—"} />
          </div>
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

  function renderActiveView() {
    if (activeTab?.type === "note") {
      return renderNoteTabView(activeTab.nodeId);
    }

    switch (activeView) {
      case "build":
        return renderBuildView();
      case "notes":
        return renderNotesView();
      case "graph":
        return renderGraphView();
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
        <aside className={isRailExpanded ? styles.leftRailExpanded : styles.leftRail}>
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
          </nav>

          <div className={styles.railFooter}>
            {isRailExpanded ? (
              <>
                <span className={styles.railMeta}>Nodes {canvasDocument?.nodes.length ?? 0}</span>
                <span className={styles.railMeta}>Open {openCanvasNodes.length}</span>
                <span className={styles.railMeta}>Codex {selectedCanvasNodeIds.size}</span>
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
        </aside>

        <main className={styles.workspace}>
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
                {tab.id !== "view:build" ? (
                  <button className={styles.documentTabClose} onClick={() => closeTab(tab.id)} type="button">
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}

          <section className={styles.workspaceStage}>{renderActiveView()}</section>
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

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaRow}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{value}</span>
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
    case "build":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M3 4.5h10M3 8h7M3 11.5h5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="m10.5 10.2 1.6 1.6 2.4-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "notes":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <path d="M4 4.5h8M4 8h8M4 11.5h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "graph":
      return (
        <svg aria-hidden="true" viewBox="0 0 16 16">
          <circle cx="4" cy="4" r="1.6" fill="currentColor" />
          <circle cx="12" cy="5" r="1.6" fill="currentColor" />
          <circle cx="8" cy="12" r="1.6" fill="currentColor" />
          <path d="M5.3 4.5 10.7 5.1M4.9 5.2 7.2 10.8M11.1 6.2 8.8 10.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
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

function buildSemanticContext(document: CanvasDocument | null, selectedNodeIds: Set<string>) {
  if (!document || selectedNodeIds.size === 0) {
    return "";
  }
  const selectedNodes = document.nodes.filter((item) => selectedNodeIds.has(item.id));
  if (selectedNodes.length === 0) {
    return "";
  }
  return selectedNodes
    .map((node) => {
      const tags = node.tags.length > 0 ? `Tags: ${node.tags.join(", ")}` : "";
      const files = node.linked_files.length > 0 ? `Files: ${node.linked_files.join(", ")}` : "";
      const symbols = node.linked_symbols.length > 0 ? `Symbols: ${node.linked_symbols.join(", ")}` : "";
      return [node.title, tags, node.description, files, symbols].filter(Boolean).join("\n");
    })
    .join("\n\n");
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
