"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type SyntheticEvent } from "react";

import "@xyflow/react/dist/style.css";
import {
  applyNodeChanges,
  Handle,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  PanOnScrollMode,
  type ReactFlowInstance,
  ReactFlow,
  type ReactFlowProps,
  Position,
  type Viewport,
} from "@xyflow/react";

import styles from "@/app/page.module.css";
import type { CanvasDocument, CanvasNode } from "@/lib/api";

interface CanvasBoardProps {
  document: CanvasDocument | null;
  selectedNodeIds: string[];
  edgeNodeIds?: string[];
  expandedNodeId?: string | null;
  explorationControls?: {
    activeNodeId: string | null;
    pathTitles: string[];
    relationQuery: string;
    persistent: boolean;
    onRelationQueryChange: (value: string) => void;
    onRelationSubmit: () => void;
    onReturnToOverview?: () => void;
  } | null;
  onCreateNodeAt: (x: number, y: number) => void;
  onDeleteNode: (nodeId: string) => void;
  onMoveNodeEnd: (nodeId: string, x: number, y: number) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectNodes: (nodeIds: string[]) => void;
  onOpenNode: (nodeId: string) => void;
  onToggleExpandNode: (nodeId: string) => void;
  onResetNodeSize: (nodeId: string) => void;
  onPaneClick?: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
  nodeId: string | null;
}

interface NoteNodeData extends Record<string, unknown> {
  node: CanvasNode;
  onOpenNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onToggleExpandNode: (nodeId: string) => void;
  onResetNodeSize: (nodeId: string) => void;
  detailLevel: "minimal" | "compact" | "full";
  isExpanded: boolean;
  explorationControls: CanvasBoardProps["explorationControls"];
}

const NODE_WIDTH = 240;
const NODE_HEIGHT = 148;
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };
const DOT_GAP = 24;

const nodeTypes: ReactFlowProps<Node<NoteNodeData>, Edge>["nodeTypes"] = {
  note: NoteFlowNode,
};

export function CanvasBoard({
  document,
  selectedNodeIds,
  edgeNodeIds,
  expandedNodeId,
  explorationControls,
  onCreateNodeAt,
  onDeleteNode,
  onMoveNodeEnd,
  onSelectNode,
  onSelectNodes,
  onOpenNode,
  onToggleExpandNode,
  onResetNodeSize,
  onPaneClick,
}: CanvasBoardProps) {
  const flowRef = useRef<ReactFlowInstance<Node<NoteNodeData>, Edge> | null>(null);
  const isDraggingRef = useRef(false);
  const openNodeRef = useRef(onOpenNode);
  const selectNodeRef = useRef(onSelectNode);
  const repoPath = document?.repo_path ?? "";
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [localNodes, setLocalNodes] = useState<Array<Node<NoteNodeData>>>([]);
  const [pendingSelectionIds, setPendingSelectionIds] = useState<string[] | null>(null);
  const [zoom, setZoom] = useState(1);
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const gridSize = Math.max(DOT_GAP * viewport.zoom, 8);

  useEffect(() => {
    openNodeRef.current = onOpenNode;
    selectNodeRef.current = onSelectNode;
  }, [onOpenNode, onSelectNode]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function handleClose() {
      setContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("pointerdown", handleClose);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handleClose);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const detailLevel: NoteNodeData["detailLevel"] = useMemo(() => {
    if (zoom < 0.68) {
      return "minimal";
    }
    if (zoom < 0.95) {
      return "compact";
    }
    return "full";
  }, [zoom]);

  const derivedNodes = useMemo<Array<Node<NoteNodeData>>>(() => {
    return (document?.nodes ?? []).map((node) => ({
      id: node.id,
      type: "note",
      position: { x: node.x, y: node.y },
      data: {
        node,
        onOpenNode: (nodeId: string) => openNodeRef.current(nodeId),
        onSelectNode: (nodeId: string) => selectNodeRef.current(nodeId),
        onToggleExpandNode,
        onResetNodeSize,
        detailLevel,
        isExpanded: expandedNodeId === node.id,
        explorationControls,
      },
      selected: selectedNodeIds.includes(node.id),
      draggable: true,
    }));
  }, [detailLevel, document, expandedNodeId, explorationControls, onResetNodeSize, onToggleExpandNode, selectedNodeIds]);

  useEffect(() => {
    if (isDraggingRef.current) {
      return;
    }
    setLocalNodes((current) => {
      if (areFlowNodesEquivalent(current, derivedNodes)) {
        return current;
      }
      return derivedNodes;
    });
  }, [derivedNodes]);

  useEffect(() => {
    if (!pendingSelectionIds) {
      return;
    }
    onSelectNodes(pendingSelectionIds);
    setPendingSelectionIds(null);
  }, [onSelectNodes, pendingSelectionIds]);

  const edges: Edge[] = useMemo(
    () => {
      const nodesById = new Map((document?.nodes ?? []).map((node) => [node.id, node]));
      const visibleEdgeNodeIds = edgeNodeIds ?? selectedNodeIds;

      return (document?.edges ?? [])
        .filter((edge) =>
          visibleEdgeNodeIds.length > 0
            ? visibleEdgeNodeIds.includes(edge.source_node_id) || visibleEdgeNodeIds.includes(edge.target_node_id)
            : false,
        )
        .map((edge) => {
          const sourceNode = nodesById.get(edge.source_node_id);
          const targetNode = nodesById.get(edge.target_node_id);
          const sourceSide = sourceNode && targetNode ? resolveHandleSide(sourceNode, targetNode) : "bottom";
          const targetSide = sourceNode && targetNode ? resolveHandleSide(targetNode, sourceNode) : "top";
          const isSuggestionEdge =
            edge.id.startsWith("suggestion-edge:") || edge.id.startsWith("suggestion-edge-loading:");

          return {
          id: edge.id,
          source: edge.source_node_id,
          sourceHandle: `${edge.source_node_id}-source-${sourceSide}`,
          target: edge.target_node_id,
          targetHandle: `${edge.target_node_id}-target-${targetSide}`,
          label: edge.label || undefined,
          type: "smoothstep",
          animated: false,
          style: isSuggestionEdge
            ? { stroke: "#ab8d6e", strokeWidth: 1.8, strokeDasharray: "6 6" }
            : { stroke: "#8b5c32", strokeWidth: 2.25 },
          labelStyle: isSuggestionEdge
            ? { fill: "#8a745d", fontWeight: 600 }
            : { fill: "#6f451f", fontWeight: 600 },
          labelBgStyle: isSuggestionEdge
            ? { fill: "#fffaf4", fillOpacity: 0.88 }
            : { fill: "#fff8ef", fillOpacity: 0.92 },
          labelBgPadding: [6, 4],
          labelBgBorderRadius: 6,
          };
        });
    },
    [document?.edges, document?.nodes, edgeNodeIds, selectedNodeIds],
  );

  const handleNodeDragStart: NodeMouseHandler<Node<NoteNodeData>> = () => {
    isDraggingRef.current = true;
  };

  const handleNodeDragStop: NodeMouseHandler<Node<NoteNodeData>> = (_event, node) => {
    isDraggingRef.current = false;
    setLocalNodes((current) =>
      current.map((item) =>
        item.id === node.id
          ? { ...item, position: { x: Math.round(node.position.x), y: Math.round(node.position.y) } }
          : item,
      ),
    );
    onMoveNodeEnd(node.id, Math.round(node.position.x), Math.round(node.position.y));
  };

  const handleNodesChange = (changes: NodeChange<Node<NoteNodeData>>[]) => {
    const nextNodes = applyNodeChanges(changes, localNodes);
    setLocalNodes(nextNodes);

    if (changes.some((change) => change.type === "select")) {
      const nextNodeIds = nextNodes
        .filter((node) => !!node.selected)
        .map((node) => node.id)
        .sort();
      const currentNodeIds = [...selectedNodeIds].sort();

      if (
        nextNodeIds.length !== currentNodeIds.length ||
        nextNodeIds.some((nodeId, index) => nodeId !== currentNodeIds[index])
      ) {
        setPendingSelectionIds(nextNodeIds);
      }
    }
  };

  const handleNodeClick: NodeMouseHandler<Node<NoteNodeData>> = (_event, node) => {
    onSelectNode(node.id);
  };

  const handleNodeDoubleClick: NodeMouseHandler<Node<NoteNodeData>> = (_event, node) => {
    onOpenNode(node.id);
  };

  useEffect(() => {
    if (!flowRef.current || !repoPath) {
      return;
    }

    const storedViewport = readStoredViewport(repoPath);
    if (storedViewport) {
      flowRef.current.setViewport(storedViewport, { duration: 0 });
      setZoom(storedViewport.zoom);
      return;
    }

    flowRef.current.setViewport(DEFAULT_VIEWPORT, { duration: 0 });
    setZoom(DEFAULT_VIEWPORT.zoom);
  }, [repoPath]);

  return (
    <div
      className={styles.canvasBoard}
      onMouseLeave={() => setCursorPosition(null)}
      onMouseMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        setCursorPosition({
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });
      }}
      onDoubleClick={(event) => {
        if (!flowRef.current) {
          return;
        }
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        if (target.closest(".react-flow__node")) {
          return;
        }
        const point = flowRef.current.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        onCreateNodeAt(Math.round(point.x - NODE_WIDTH / 2), Math.round(point.y - NODE_HEIGHT / 2));
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!flowRef.current) {
          return;
        }
        const point = flowRef.current.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          canvasX: Math.round(point.x - NODE_WIDTH / 2),
          canvasY: Math.round(point.y - NODE_HEIGHT / 2),
          nodeId: null,
        });
      }}
    >
      <div
        className={styles.canvasDotField}
        style={
          {
            "--grid-size": `${gridSize}px`,
            "--grid-x": `${normalizeGridOffset(viewport.x, gridSize)}px`,
            "--grid-y": `${normalizeGridOffset(viewport.y, gridSize)}px`,
          } as CSSProperties
        }
      />
      <div
        className={styles.canvasDotHighlight}
        style={
          {
            "--grid-size": `${gridSize}px`,
            "--grid-x": `${normalizeGridOffset(viewport.x, gridSize)}px`,
            "--grid-y": `${normalizeGridOffset(viewport.y, gridSize)}px`,
            "--cursor-x": cursorPosition ? `${cursorPosition.x}px` : "50%",
            "--cursor-y": cursorPosition ? `${cursorPosition.y}px` : "50%",
            opacity: cursorPosition ? 1 : 0,
          } as CSSProperties
        }
      />
      <ReactFlow
        defaultEdgeOptions={{ style: { stroke: "#b6a391", strokeWidth: 2 } }}
        edges={edges}
        fitView={false}
        maxZoom={1.8}
        minZoom={0.35}
        nodeOrigin={[0, 0]}
        nodes={localNodes}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          flowRef.current = instance;
          const storedViewport = repoPath ? readStoredViewport(repoPath) : null;
          if (storedViewport) {
            instance.setViewport(storedViewport, { duration: 0 });
            setZoom(storedViewport.zoom);
            setViewport(storedViewport);
            return;
          }
          setZoom(instance.getZoom());
          setViewport(DEFAULT_VIEWPORT);
        }}
        onMove={(_event, viewport) => {
          setZoom(viewport.zoom);
          setViewport(viewport);
        }}
        onMoveEnd={(_event, viewport) => {
          if (!repoPath) {
            return;
          }
          writeStoredViewport(repoPath, {
            x: viewport.x,
            y: viewport.y,
            zoom: viewport.zoom,
          });
        }}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => {
          if (onPaneClick) {
            onSelectNodes([]);
            onPaneClick();
          }
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          event.stopPropagation();
          const point = flowRef.current?.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY,
          });
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            canvasX: Math.round((point?.x ?? node.position.x) - NODE_WIDTH / 2),
            canvasY: Math.round((point?.y ?? node.position.y) - NODE_HEIGHT / 2),
            nodeId: node.id,
          });
        }}
        autoPanOnNodeDrag
        autoPanSpeed={8}
        panOnDrag={[2]}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        proOptions={{ hideAttribution: true }}
        selectionOnDrag
      />
      {contextMenu ? (
        <div
          className={styles.canvasContextMenu}
          onPointerDown={(event) => event.stopPropagation()}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className={styles.canvasContextItem}
            onClick={() => {
              onCreateNodeAt(contextMenu.canvasX, contextMenu.canvasY);
              setContextMenu(null);
            }}
            type="button"
          >
            Create note
          </button>
          {contextMenu.nodeId ? (
            <button
              className={styles.canvasContextItemDanger}
              onClick={() => {
                onDeleteNode(contextMenu.nodeId as string);
                setContextMenu(null);
              }}
              type="button"
            >
              Delete note
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function NoteFlowNode({ data, selected }: { data: NoteNodeData; selected?: boolean }) {
  const {
    node,
    onOpenNode,
    onResetNodeSize,
    onSelectNode,
    onToggleExpandNode,
    detailLevel,
    explorationControls,
    isExpanded,
  } = data;
  const isMinimal = detailLevel === "minimal";
  const isCompact = detailLevel === "compact";
  const isSuggestion = node.tags.includes("suggestion");
  const isLoadingSuggestion = node.tags.includes("suggestion-loading");
  const isBranchSummary = node.id.startsWith("branch-summary:");
  const isTransientExploration = node.id.startsWith("explore-node:");
  const canOpenInTab = !isSuggestion && !isLoadingSuggestion && !isBranchSummary && !isTransientExploration;
  const canExpand = !isSuggestion && !isLoadingSuggestion && !isBranchSummary;
  const isExplorationActive = explorationControls?.activeNodeId === node.id;
  const nodeClassName = selected
    ? `${styles.canvasNodeActive} ${isSuggestion ? styles.canvasNodeSuggestionActive : ""} ${isLoadingSuggestion ? styles.canvasNodeSuggestionLoading : ""} ${isExpanded ? styles.canvasNodeExpanded : ""} ${isMinimal ? styles.canvasNodeMinimal : isCompact ? styles.canvasNodeCompact : ""}`.trim()
    : `${styles.canvasNode} ${isSuggestion ? styles.canvasNodeSuggestion : ""} ${isLoadingSuggestion ? styles.canvasNodeSuggestionLoading : ""} ${isExpanded ? styles.canvasNodeExpanded : ""} ${isMinimal ? styles.canvasNodeMinimal : isCompact ? styles.canvasNodeCompact : ""}`.trim();

  function stopInteraction(event: SyntheticEvent) {
    event.stopPropagation();
  }

  return (
    <div className={styles.canvasNodeShell}>
      <Handle className={styles.canvasNodeHandle} id={`${node.id}-source-top`} position={Position.Top} type="source" />
      <Handle className={styles.canvasNodeHandle} id={`${node.id}-source-right`} position={Position.Right} type="source" />
      <Handle className={styles.canvasNodeHandle} id={`${node.id}-source-bottom`} position={Position.Bottom} type="source" />
      <Handle className={styles.canvasNodeHandle} id={`${node.id}-source-left`} position={Position.Left} type="source" />
      <Handle className={styles.canvasNodeHandle} id={`${node.id}-target-top`} position={Position.Top} type="target" />
      <Handle className={styles.canvasNodeHandle} id={`${node.id}-target-right`} position={Position.Right} type="target" />
      <Handle className={styles.canvasNodeHandle} id={`${node.id}-target-bottom`} position={Position.Bottom} type="target" />
      <Handle className={styles.canvasNodeHandle} id={`${node.id}-target-left`} position={Position.Left} type="target" />
      <div
        className={nodeClassName}
        onClick={() => {
          if (!isLoadingSuggestion) {
            onSelectNode(node.id);
          }
        }}
        onDoubleClick={() => {
          if (!isLoadingSuggestion) {
            onOpenNode(node.id);
          }
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !isLoadingSuggestion) {
            event.preventDefault();
            onSelectNode(node.id);
          }
        }}
      >
        {(!isMinimal || isExpanded) && !isLoadingSuggestion ? (
          <div className={styles.canvasNodeHeader}>
            <div className={styles.canvasTagList}>
              {isSuggestion ? (
                <span className={styles.canvasSuggestionLabel}>suggestion</span>
              ) : (
                <>
                  {node.tags.length === 0 ? <span className={styles.canvasTag}>untagged</span> : null}
                  {node.tags.slice(0, isCompact ? 2 : 3).map((tag) => (
                    <span className={styles.canvasTag} key={tag}>
                      {tag}
                    </span>
                  ))}
                </>
              )}
            </div>
            <div className={`${styles.canvasNodeActions} nodrag nopan`}>
              {canOpenInTab ? (
                <button
                  className={styles.canvasNodeAction}
                  onClick={(event) => {
                    stopInteraction(event);
                    onOpenNode(node.id);
                  }}
                  type="button"
                >
                  Open
                </button>
              ) : null}
              {canExpand ? (
                isExpanded ? (
                  <button
                    className={styles.canvasNodeAction}
                    onClick={(event) => {
                      stopInteraction(event);
                      onResetNodeSize(node.id);
                    }}
                    type="button"
                  >
                    Shrink
                  </button>
                ) : (
                  <button
                    className={styles.canvasNodeAction}
                    onClick={(event) => {
                      stopInteraction(event);
                      onToggleExpandNode(node.id);
                    }}
                    type="button"
                  >
                    Expand
                  </button>
                )
              ) : null}
            </div>
          </div>
        ) : null}
        {isLoadingSuggestion ? (
          <div className={styles.canvasLoadingCard}>
            <span aria-hidden="true" className={styles.canvasLoadingSpinner} />
            <strong className={styles.canvasLoadingTitle}>Generating suggestion</strong>
          </div>
        ) : (
          <>
            <strong className={styles.canvasNodeTitle}>{node.title}</strong>
            {isExpanded ? (
              <div className={`${styles.canvasNodeExpandedBody} nodrag nopan nowheel`}>
                {isExplorationActive && explorationControls?.pathTitles.length ? (
                  <div className={styles.canvasExplorationPath}>
                    {explorationControls.pathTitles.map((title) => (
                      <span className={styles.canvasExplorationPathChip} key={title}>
                        {title}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className={styles.canvasNodeDescriptionExpanded}>{node.description || "No description yet."}</p>
                {isSuggestion ? (
                  <div className={styles.canvasSuggestionMeta}>Click to explore</div>
                ) : (
                  <>
                    <div className={styles.canvasNodeMetaExpanded}>
                      <span>{node.linked_files.length} files</span>
                      <span>{node.linked_symbols.length} symbols</span>
                    </div>
                    {node.linked_files.length > 0 ? (
                      <ul className={styles.canvasNodeList}>
                        {node.linked_files.slice(0, 6).map((file) => (
                          <li key={file}>{file}</li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
                {isExplorationActive && explorationControls ? (
                  <div className={styles.canvasExplorationComposer}>
                    <label className={styles.canvasExplorationField}>
                      <span>Explore another relation</span>
                      <input
                        className={`${styles.canvasExplorationInput} nodrag nopan nowheel`}
                        onChange={(event) => {
                          stopInteraction(event);
                          explorationControls.onRelationQueryChange(event.target.value);
                        }}
                        onClick={stopInteraction}
                        onDoubleClick={stopInteraction}
                        placeholder="e.g. persistence, UI state, side effects"
                        value={explorationControls.relationQuery}
                      />
                    </label>
                    <div className={styles.canvasExplorationActions}>
                      <button
                        className={styles.canvasNodeActionPrimary}
                        disabled={!explorationControls.relationQuery.trim()}
                        onClick={(event) => {
                          stopInteraction(event);
                          explorationControls.onRelationSubmit();
                        }}
                        type="button"
                      >
                        Add relation
                      </button>
                      {!explorationControls.persistent && explorationControls.onReturnToOverview ? (
                        <button
                          className={styles.canvasNodeAction}
                          onClick={(event) => {
                            stopInteraction(event);
                            explorationControls.onReturnToOverview?.();
                          }}
                          type="button"
                        >
                          Overview
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : detailLevel === "full" ? (
              <>
                <p className={styles.canvasNodeDescription}>{compactDescription(node.description)}</p>
                {isSuggestion ? (
                  <div className={styles.canvasSuggestionMeta}>Click to explore</div>
                ) : (
                  <div className={styles.canvasNodeMeta}>
                    <span>{node.linked_files.length} files</span>
                    <span>{node.linked_symbols.length} symbols</span>
                  </div>
                )}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function compactDescription(value: string) {
  if (!value.trim()) {
    return "No description yet.";
  }
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function areFlowNodesEquivalent(left: Array<Node<NoteNodeData>>, right: Array<Node<NoteNodeData>>) {
  return (
    left.length === right.length &&
    left.every((node, index) => {
      const other = right[index];
      return (
        node.id === other.id &&
        node.type === other.type &&
        node.position.x === other.position.x &&
        node.position.y === other.position.y &&
        node.selected === other.selected &&
        node.data.node.id === other.data.node.id &&
        node.data.node.title === other.data.node.title &&
        node.data.node.description === other.data.node.description &&
        node.data.detailLevel === other.data.detailLevel &&
        node.data.isExpanded === other.data.isExpanded &&
        node.data.explorationControls?.activeNodeId === other.data.explorationControls?.activeNodeId &&
        node.data.explorationControls?.relationQuery === other.data.explorationControls?.relationQuery &&
        (node.data.explorationControls?.pathTitles ?? []).join("|") ===
          (other.data.explorationControls?.pathTitles ?? []).join("|")
      );
    })
  );
}

function resolveHandleSide(from: CanvasNode, to: CanvasNode) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;

  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return deltaX >= 0 ? "right" : "left";
  }

  return deltaY >= 0 ? "bottom" : "top";
}

function buildViewportStorageKey(repoPath: string) {
  return `konceptura.viewport:${repoPath}`;
}

function readStoredViewport(repoPath: string): Viewport | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(buildViewportStorageKey(repoPath));
    if (!rawValue) {
      return null;
    }
    const parsed = JSON.parse(rawValue) as { x?: number; y?: number; zoom?: number };
    if (
      typeof parsed.x !== "number" ||
      typeof parsed.y !== "number" ||
      typeof parsed.zoom !== "number"
    ) {
      return null;
    }
    return {
      x: parsed.x,
      y: parsed.y,
      zoom: parsed.zoom,
    };
  } catch {
    return null;
  }
}

function writeStoredViewport(
  repoPath: string,
  viewport: Viewport,
) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(buildViewportStorageKey(repoPath), JSON.stringify(viewport));
  } catch {
    // Ignore localStorage failures and keep the canvas usable.
  }
}

function normalizeGridOffset(offset: number, gridSize: number) {
  if (!Number.isFinite(offset) || !Number.isFinite(gridSize) || gridSize <= 0) {
    return 0;
  }

  const normalized = offset % gridSize;
  return normalized < 0 ? normalized + gridSize : normalized;
}
