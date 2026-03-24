"use client";

import styles from "@/app/page.module.css";
import type { CanvasDocument } from "@/lib/api";

interface CanvasGraphProps {
  document: CanvasDocument | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onOpenNode: (nodeId: string) => void;
}

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 620;
const PADDING = 48;

export function CanvasGraph({ document, selectedNodeId, onOpenNode, onSelectNode }: CanvasGraphProps) {
  if (!document || document.nodes.length === 0) {
    return <div className={styles.graphBoard} />;
  }

  const bounds = computeBounds(document);
  const positionedNodes = document.nodes.map((node) => ({
    ...node,
    graphX: scalePoint(node.x, bounds.minX, bounds.maxX, VIEW_WIDTH),
    graphY: scalePoint(node.y, bounds.minY, bounds.maxY, VIEW_HEIGHT),
  }));

  return (
    <div className={styles.graphBoard}>
      <svg className={styles.graphEdges} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none">
        {document.edges.map((edge) => {
          const source = positionedNodes.find((item) => item.id === edge.source_node_id);
          const target = positionedNodes.find((item) => item.id === edge.target_node_id);
          if (!source || !target) {
            return null;
          }
          return (
            <g key={edge.id}>
              <line
                className={styles.graphEdgeLine}
                x1={source.graphX}
                x2={target.graphX}
                y1={source.graphY}
                y2={target.graphY}
              />
              {edge.label ? (
                <text
                  className={styles.graphEdgeText}
                  x={(source.graphX + target.graphX) / 2}
                  y={(source.graphY + target.graphY) / 2 - 8}
                >
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {positionedNodes.map((node) => (
        <button
          className={selectedNodeId === node.id ? styles.graphNodeActive : styles.graphNode}
          key={node.id}
          onClick={() => onSelectNode(node.id)}
          onDoubleClick={() => onOpenNode(node.id)}
          style={{ left: node.graphX, top: node.graphY }}
          type="button"
        >
          <strong className={styles.graphNodeTitle}>{node.title}</strong>
          <span className={styles.graphNodeMeta}>
            {node.tags.length > 0 ? node.tags.join(", ") : "untagged"}
          </span>
        </button>
      ))}
    </div>
  );
}

function computeBounds(document: CanvasDocument) {
  const xs = document.nodes.map((node) => node.x);
  const ys = document.nodes.map((node) => node.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function scalePoint(value: number, min: number, max: number, size: number) {
  if (min === max) {
    return size / 2;
  }
  const usable = size - PADDING * 2;
  return PADDING + ((value - min) / (max - min)) * usable;
}
