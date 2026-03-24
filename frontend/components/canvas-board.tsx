"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import styles from "@/app/page.module.css";
import type { CanvasDocument, CanvasNode } from "@/lib/api";

interface CanvasBoardProps {
  document: CanvasDocument | null;
  selectedNodeId: string | null;
  selectedNodeIds: Set<string>;
  onCreateNodeAt: (x: number, y: number) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onMoveNodeEnd: (nodeId: string, x: number, y: number) => void;
  onSelectNode: (nodeId: string) => void;
  onOpenNode: (nodeId: string) => void;
  onToggleNodeForCodex: (nodeId: string) => void;
}

interface DragState {
  nodeId: string;
  offsetX: number;
  offsetY: number;
}

const NODE_WIDTH = 240;
const NODE_HEIGHT = 148;

export function CanvasBoard({
  document,
  selectedNodeId,
  selectedNodeIds,
  onCreateNodeAt,
  onMoveNode,
  onMoveNodeEnd,
  onSelectNode,
  onOpenNode,
  onToggleNodeForCodex,
}: CanvasBoardProps) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  useEffect(() => {
    const currentDrag = dragState;
    if (!currentDrag) {
      return;
    }
    const drag = currentDrag;

    function handlePointerMove(event: PointerEvent) {
      const board = boardRef.current;
      if (!board) {
        return;
      }
      const bounds = board.getBoundingClientRect();
      const nextX = Math.max(16, Math.round(event.clientX - bounds.left - drag.offsetX));
      const nextY = Math.max(16, Math.round(event.clientY - bounds.top - drag.offsetY));
      onMoveNode(drag.nodeId, nextX, nextY);
    }

    function handlePointerUp(event: PointerEvent) {
      const board = boardRef.current;
      if (board) {
        const bounds = board.getBoundingClientRect();
        const nextX = Math.max(16, Math.round(event.clientX - bounds.left - drag.offsetX));
        const nextY = Math.max(16, Math.round(event.clientY - bounds.top - drag.offsetY));
        onMoveNodeEnd(drag.nodeId, nextX, nextY);
      }
      setDragState(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragState, onMoveNode, onMoveNodeEnd]);

  function handleBoardDoubleClick(event: MouseEvent<HTMLDivElement>) {
    const board = boardRef.current;
    if (!board || event.target !== board) {
      return;
    }
    const bounds = board.getBoundingClientRect();
    onCreateNodeAt(
      Math.round(event.clientX - bounds.left - NODE_WIDTH / 2),
      Math.round(event.clientY - bounds.top - NODE_HEIGHT / 2),
    );
  }

  return (
    <div
      className={styles.canvasBoard}
      onDoubleClick={handleBoardDoubleClick}
      ref={boardRef}
    >
      {!document ? null : (
        <>
          <svg className={styles.canvasEdges} viewBox="0 0 1400 900" preserveAspectRatio="none">
            {document.edges.map((edge) => {
              const source = document.nodes.find((item) => item.id === edge.source_node_id);
              const target = document.nodes.find((item) => item.id === edge.target_node_id);
              if (!source || !target) {
                return null;
              }
              const sourceX = source.x + NODE_WIDTH;
              const sourceY = source.y + NODE_HEIGHT / 2;
              const targetX = target.x;
              const targetY = target.y + NODE_HEIGHT / 2;
              const midX = (sourceX + targetX) / 2;
              const path = `M ${sourceX} ${sourceY} C ${midX} ${sourceY}, ${midX} ${targetY}, ${targetX} ${targetY}`;
              return (
                <g key={edge.id}>
                  <path className={styles.canvasEdgePath} d={path} />
                  {edge.label ? (
                    <text
                      className={styles.canvasEdgeLabel}
                      x={midX}
                      y={(sourceY + targetY) / 2 - 6}
                    >
                      {edge.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>

          {document.nodes.map((node) => (
            <CanvasNodeCard
              isCodexSelected={selectedNodeIds.has(node.id)}
              isSelected={selectedNodeId === node.id}
              key={node.id}
              node={node}
              onPointerDown={(event) => {
                const bounds = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                setDragState({
                  nodeId: node.id,
                  offsetX: event.clientX - bounds.left,
                  offsetY: event.clientY - bounds.top,
                });
              }}
              onOpenNode={onOpenNode}
              onSelectNode={onSelectNode}
              onToggleNodeForCodex={onToggleNodeForCodex}
            />
          ))}
        </>
      )}
    </div>
  );
}

function CanvasNodeCard({
  isCodexSelected,
  isSelected,
  node,
  onPointerDown,
  onOpenNode,
  onSelectNode,
  onToggleNodeForCodex,
}: {
  isCodexSelected: boolean;
  isSelected: boolean;
  node: CanvasNode;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onOpenNode: (nodeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onToggleNodeForCodex: (nodeId: string) => void;
}) {
  return (
    <button
      className={isSelected ? styles.canvasNodeActive : styles.canvasNode}
      onClick={() => onSelectNode(node.id)}
      onDoubleClick={() => onOpenNode(node.id)}
      onPointerDown={onPointerDown}
      style={{ left: node.x, top: node.y }}
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
        <label
          className={styles.canvasToggle}
          onClick={(event) => event.stopPropagation()}
        >
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
