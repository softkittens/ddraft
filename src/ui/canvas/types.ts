import type { Document, PenNode } from "../../model/types";
import type { LayoutNode } from "../../layout/types";
import type { Camera, Point } from "../../interaction/camera";
import type { DragSession } from "../../interaction/drag";
import { hitTestSceneWorld, nearestFrameHit, worldPointToFrameLocal } from "../../interaction/hittest";
import { insertChild } from "../../model/edit";
import { cloneDocument } from "../../model/tree";
import { doc, layoutTree, nodeMap } from "../store";

export interface CanvasRenderState {
  camera: Camera;
  tree: LayoutNode[];
  map: Map<string, PenNode>;
  variables?: Record<string, any>;
  selectedIds: Set<string>;
  hoveredId: string | null;
  dragSession: DragSession | null;
  isAltHeld: boolean;
  shapeStart: Point | null;
  shapeCurrent: Point | null;
  marqueeStart?: Point | null;
  marqueeCurrent?: Point | null;
  editingTextId?: string | null;
}

export function insertNodeAtWorld(node: PenNode, world: Point, skipFrameId?: string): Document {
  const hit = hitTestSceneWorld(layoutTree(), world, nodeMap());
  const frameHit = hit ? nearestFrameHit(hit) : null;
  if (frameHit && frameHit.node.id !== skipFrameId) {
    const local = worldPointToFrameLocal(world, frameHit);
    node.x = Math.round(local.x);
    node.y = Math.round(local.y);
    return insertChild(doc(), frameHit.node.id, node);
  }
  const next = cloneDocument(doc());
  next.children.push(node);
  return next;
}
