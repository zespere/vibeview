"use client";

import styles from "@/app/page.module.css";
import type { StructureNode } from "@/lib/api";

interface StructureTreeProps {
  expandedIds: Set<string>;
  onSelect: (node: StructureNode) => void;
  onToggle: (nodeId: string) => void;
  selectedNodeId: string | null;
  tree: StructureNode;
}

export function StructureTree({
  expandedIds,
  onSelect,
  onToggle,
  selectedNodeId,
  tree,
}: StructureTreeProps) {
  return (
    <ul className={styles.treeList}>
      <StructureTreeNode
        expandedIds={expandedIds}
        node={tree}
        onSelect={onSelect}
        onToggle={onToggle}
        selectedNodeId={selectedNodeId}
      />
    </ul>
  );
}

function StructureTreeNode({
  expandedIds,
  node,
  onSelect,
  onToggle,
  selectedNodeId,
}: {
  expandedIds: Set<string>;
  node: StructureNode;
  onSelect: (node: StructureNode) => void;
  onToggle: (nodeId: string) => void;
  selectedNodeId: string | null;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedNodeId === node.id;

  return (
    <li className={styles.treeItem}>
      <div className={styles.treeRow}>
        {hasChildren ? (
          <button
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            className={styles.treeToggle}
            onClick={() => onToggle(node.id)}
            type="button"
          >
            {isExpanded ? "-" : "+"}
          </button>
        ) : (
          <span className={styles.treeSpacer} />
        )}

        <button
          className={isSelected ? styles.treeNodeActive : styles.treeNode}
          onClick={() => onSelect(node)}
          type="button"
        >
          <span className={styles.treeNodeKind}>{node.kind}</span>
          <span className={styles.treeNodeName}>{node.name}</span>
        </button>
      </div>

      {hasChildren && isExpanded ? (
        <ul className={styles.treeChildren}>
          {node.children.map((child) => (
            <StructureTreeNode
              expandedIds={expandedIds}
              key={child.id}
              node={child}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedNodeId={selectedNodeId}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
