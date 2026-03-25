"use client";

import { useEffect, useRef, useState } from "react";

import "@xyflow/react/dist/style.css";
import {
  Background,
  type Edge,
  type Node,
  type NodeMouseHandler,
  PanOnScrollMode,
  type ReactFlowInstance,
  ReactFlow,
  type ReactFlowProps,
} from "@xyflow/react";

import styles from "@/app/page.module.css";
import type { CanvasDocument, CanvasNode } from "@/lib/api";

interface CanvasBoardProps {
  document: CanvasDocument | null;
  fitViewSignal: number;
  selectedNodeId: string | null;
  selectedNodeIds: Set<string>;
  onCreateNodeAt: (x: number, y: number) => void;
  onDeleteNode: (nodeId: string) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onMoveNodeEnd: (nodeId: string, x: number, y: number) => void;
  onSelectNode: (nodeId: string) => void;
  onOpenNode: (nodeId: string) => void;
  onToggleNodeForCodex: (nodeId: string) => void;
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
  isCodexSelected: boolean;
  onOpenNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onToggleNodeForCodex: (nodeId: string) => void;
}

const NODE_WIDTH = 240;
const NODE_HEIGHT = 148;

const nodeTypes: ReactFlowProps<Node<NoteNodeData>, Edge>["nodeTypes"] = {
  note: NoteFlowNode,
};

export function CanvasBoard({
  document,
  fitViewSignal,
  selectedNodeId,
  selectedNodeIds,
  onCreateNodeAt,
  onDeleteNode,
  onMoveNode,
  onMoveNodeEnd,
  onSelectNode,
  onOpenNode,
  onToggleNodeForCodex,
}: CanvasBoardProps) {
  const flowRef = useRef<ReactFlowInstance<Node<NoteNodeData>, Edge> | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

  useEffect(() => {
    if (!flowReady || !flowRef.current || !document || document.nodes.length === 0 || fitViewSignal === 0) {
      return;
    }
    window.requestAnimationFrame(() => {
      flowRef.current?.fitView({
        duration: 240,
        padding: 0.2,
      });
    });
  }, [document, fitViewSignal, flowReady]);

  const nodes: Array<Node<NoteNodeData>> = (document?.nodes ?? []).map((node) => ({
    id: node.id,
    type: "note",
    position: { x: node.x, y: node.y },
    data: {
      node,
      isCodexSelected: selectedNodeIds.has(node.id),
      onOpenNode,
      onSelectNode,
      onToggleNodeForCodex,
    },
    selected: node.id === selectedNodeId,
    draggable: true,
  }));

  const edges: Edge[] = (document?.edges ?? []).map((edge) => ({
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    label: edge.label || undefined,
    type: "default",
    animated: false,
  }));

  const handleNodeDrag: NodeMouseHandler<Node<NoteNodeData>> = (_event, node) => {
    onMoveNode(node.id, Math.round(node.position.x), Math.round(node.position.y));
  };

  const handleNodeDragStop: NodeMouseHandler<Node<NoteNodeData>> = (_event, node) => {
    onMoveNodeEnd(node.id, Math.round(node.position.x), Math.round(node.position.y));
  };

  const handleNodeClick: NodeMouseHandler<Node<NoteNodeData>> = (_event, node) => {
    onSelectNode(node.id);
  };

  const handleNodeDoubleClick: NodeMouseHandler<Node<NoteNodeData>> = (_event, node) => {
    onOpenNode(node.id);
  };

  return (
    <div
      className={styles.canvasBoard}
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
      <ReactFlow
        defaultEdgeOptions={{ style: { stroke: "#b6a391", strokeWidth: 2 } }}
        edges={edges}
        fitView={false}
        maxZoom={1.8}
        minZoom={0.35}
        nodeOrigin={[0, 0]}
        nodes={nodes}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          flowRef.current = instance;
          setFlowReady(true);
        }}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
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
        panOnDrag={[1, 2]}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        proOptions={{ hideAttribution: true }}
        selectionOnDrag={false}
      >
        <Background color="#e6ddd2" gap={24} />
      </ReactFlow>
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
  const { node, isCodexSelected, onOpenNode, onSelectNode, onToggleNodeForCodex } = data;

  return (
    <button
      className={selected ? styles.canvasNodeActive : styles.canvasNode}
      onClick={() => onSelectNode(node.id)}
      onDoubleClick={() => onOpenNode(node.id)}
      type="button"
    >
      <div className={styles.canvasNodeHeader}>
        <div className={styles.canvasTagList}>
          {node.tags.length === 0 ? <span className={styles.canvasTag}>untagged</span> : null}
          {node.tags.slice(0, 3).map((tag) => (
            <span className={styles.canvasTag} key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <label className={styles.canvasToggle} onClick={(event) => event.stopPropagation()}>
          <input
            checked={isCodexSelected}
            onChange={() => onToggleNodeForCodex(node.id)}
            type="checkbox"
          />
          <span>Codex</span>
        </label>
      </div>
      <strong className={styles.canvasNodeTitle}>{node.title}</strong>
      <p className={styles.canvasNodeDescription}>{compactDescription(node.description)}</p>
      <div className={styles.canvasNodeMeta}>
        <span>{node.linked_files.length} files</span>
        <span>{node.linked_symbols.length} symbols</span>
      </div>
    </button>
  );
}

function compactDescription(value: string) {
  if (!value.trim()) {
    return "No description yet.";
  }
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}
