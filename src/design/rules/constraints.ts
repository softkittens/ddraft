import type { LayoutNode } from "../../layout/types";
import type { Document, TextNode, PenNode, FrameNode } from "../../model/types";
import { indexDocument } from "../../model/tree";
import {
  type AuditFinding,
  type AuditSeverity,
  type AuditRule,
  type AuditContext,
  boxesOverlap,
  boxContains,
  walkEnabled
} from "../helpers";

export type FindingRule = "collision" | "overflow" | "unreadable_size" | "off_canvas";

/** Below this, text is unreadable on any device. A blocker anywhere. */
export const HARD_MIN_FONT_SIZE = 9;
/** Smallest text the composition rules allow. */
export const MIN_FONT_SIZE = 11;
/** Smallest comfortable touch target, in points. */
export const MIN_TAP_TARGET = 44;

export interface Finding {
  rule: FindingRule;
  nodeId: string;
  parentId?: string;
  message: string;
}

export function checkCollision(nodes: LayoutNode[], doc: Document): Finding[] {
  const findings: Finding[] = [];
  const map = indexDocument(doc);

  function checkSiblings(siblings: LayoutNode[]) {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = siblings[i];
        const b = siblings[j];
        const aDoc = map.get(a.id);
        const bDoc = map.get(b.id);

        if (aDoc?.enabled === false || bDoc?.enabled === false) continue;

        if (a.box.width > 0 && a.box.height > 0 && b.box.width > 0 && b.box.height > 0) {
          if (boxesOverlap(a.box, b.box)) {
            const deliberateOverlay =
              (aDoc?.layoutPosition === "absolute" && boxContains(b.box, a.box)) ||
              (bDoc?.layoutPosition === "absolute" && boxContains(a.box, b.box));
            if (deliberateOverlay) continue;
            findings.push({
              rule: "collision",
              nodeId: a.id,
              message: `Node "${a.id}" collides with sibling "${b.id}"`
            });
          }
        }
      }
      if (map.get(siblings[i].id)?.enabled !== false && siblings[i].children.length > 0) {
        checkSiblings(siblings[i].children);
      }
    }
  }

  checkSiblings(nodes);
  return findings;
}

export function checkOverflow(nodes: LayoutNode[], doc: Document): Finding[] {
  const findings: Finding[] = [];
  const map = indexDocument(doc);

  function walk(parent: LayoutNode) {
    if (map.get(parent.id)?.enabled === false) return;
    if (parent.type === "frame" && parent.box.width > 0 && parent.box.height > 0) {
      const parentDoc = map.get(parent.id) as FrameNode | undefined;
      const isClipped = parentDoc?.clip === true;

      for (const child of parent.children) {
        const childDoc = map.get(child.id);
        if (childDoc?.enabled === false) continue;
        const carriesText = childDoc?.type === "text";
        if (!isClipped && !carriesText) continue;

        const overRight = child.box.x + child.box.width - parent.box.width;
        const overBottom = child.box.y + child.box.height - parent.box.height;
        const parts: string[] = [];
        if (child.box.x < -1.0) parts.push(`${Math.round(-child.box.x)}px past the left edge`);
        if (overRight > 1.0) parts.push(`${Math.round(overRight)}px past the right edge`);
        if (child.box.y < -1.0) parts.push(`${Math.round(-child.box.y)}px past the top edge`);
        if (overBottom > 1.0) parts.push(`${Math.round(overBottom)}px past the bottom edge`);
        if (parts.length > 0) {
          findings.push({
            rule: "overflow",
            nodeId: child.id,
            parentId: parent.id,
            message:
              `"${child.id}" (${Math.round(child.box.width)}x${Math.round(child.box.height)}px) extends ` +
              `${parts.join(" and ")} of parent "${parent.id}" ` +
              `(${Math.round(parent.box.width)}x${Math.round(parent.box.height)}px). ` +
              (isClipped ? "It will be clipped." : "It runs outside its container.")
          });
        }
      }
    }
    for (const child of parent.children) walk(child);
  }

  for (const root of nodes) walk(root);
  return findings;
}

export function checkUnreadableSize(document: Document): Finding[] {
  const findings: Finding[] = [];
  walkEnabled(document.children, (n) => {
    if (n.type === "text") {
      const textNode = n as TextNode;
      if (textNode.fontSize !== undefined && textNode.fontSize < HARD_MIN_FONT_SIZE) {
        findings.push({
          rule: "unreadable_size",
          nodeId: n.id,
          message: `"${n.id}" sets fontSize ${textNode.fontSize}px, below the ${HARD_MIN_FONT_SIZE}px readable floor.`
        });
      }
    }
  });
  return findings;
}

export function checkOffCanvas(nodes: LayoutNode[]): Finding[] {
  const findings: Finding[] = [];
  for (const root of nodes) {
    if (root.box.x < 0 || root.box.y < 0) {
      findings.push({
        rule: "off_canvas",
        nodeId: root.id,
        message: `Node "${root.id}" is placed off canvas (${root.box.x}, ${root.box.y})`
      });
    }
  }
  return findings;
}

export function evaluateLayoutConstraints(tree: LayoutNode[], doc: Document): Finding[] {
  return [
    ...checkCollision(tree, doc),
    ...checkOverflow(tree, doc),
    ...checkUnreadableSize(doc),
    ...checkOffCanvas(tree)
  ];
}

const SEVERITY_OF: Record<FindingRule, AuditSeverity> = {
  collision: "blocker",
  overflow: "blocker",
  unreadable_size: "blocker",
  off_canvas: "warning"
};

const RULE_OF: Record<FindingRule, AuditRule> = {
  collision: "collision",
  overflow: "clipped",
  unreadable_size: "text_too_small",
  off_canvas: "off_canvas"
};

const FIX_OF: Record<FindingRule, string> = {
  collision: "Put both nodes in a frame with layout: 'vertical' or 'horizontal' and a gap, instead of positioning them by hand.",
  overflow:
    "The child does not fit. Either set the child's width to 'fill_container' so it wraps inside the parent, or let the parent size to its content with height: 'fit_content'. Do not clip.",
  unreadable_size: `Raise to at least ${MIN_FONT_SIZE}px.`,
  off_canvas: "Move the frame to positive coordinates."
};

function overflowFix(node: PenNode | undefined, parent: PenNode | undefined): string {
  if (parent?.metadata?.screenKind === "mobile") {
    return "Keep the fixed mobile screen size. Shorten or remove content, or reduce inner gaps and padding until everything fits inside the viewport.";
  }
  if (
    (node && node.type === "frame" && (node as FrameNode).layout === "horizontal") ||
    (parent && parent.type === "frame" && (parent as FrameNode).layout === "horizontal")
  ) {
    return (
      "This row is wider than the space it has. Content does not wrap onto a " +
      "second line, so widening it will not help: remove an item, shorten the " +
      "labels, or reduce the gap and padding. If the items must all stay, put " +
      "them in a vertical stack instead."
    );
  }
  return FIX_OF.overflow;
}

export function runConstraintAudits(ctx: AuditContext): AuditFinding[] {
  const map = ctx.nodes;
  return evaluateLayoutConstraints(ctx.tree, ctx.doc).map((f) => ({
    rule: RULE_OF[f.rule],
    severity: SEVERITY_OF[f.rule],
    nodeId: f.nodeId,
    message: f.message,
    fix: f.rule === "overflow" ? overflowFix(map.get(f.nodeId), f.parentId ? map.get(f.parentId) : undefined) : FIX_OF[f.rule]
  }));
}
