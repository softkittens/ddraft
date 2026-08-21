import { createSignal } from "solid-js";
import { screenToWorld, type Point } from "../../interaction/camera";
import { getNextNodeId } from "../../model/edit";
import type { PenNode } from "../../model/types";
import { camera, doc, updateDoc, setSelectedIds } from "../store";
import { insertNodeAtWorld } from "./types";

export function useFileDrop(getCanvas: () => HTMLCanvasElement | undefined) {
  const [isDragOverCanvas, setIsDragOverCanvas] = createSignal(false);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    setIsDragOverCanvas(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOverCanvas(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOverCanvas(false);
    const canvas = getCanvas();
    if (!canvas || !e.dataTransfer?.files?.length) return;

    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;

    const rectBounds = canvas.getBoundingClientRect();
    const screenPt: Point = { x: e.clientX - rectBounds.left, y: e.clientY - rectBounds.top };
    const dropWorld = screenToWorld(screenPt, camera());

    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (!dataUrl) return;

        const img = new Image();
        img.onload = () => {
          const maxDimension = 420;
          let w = img.naturalWidth || 360;
          let h = img.naturalHeight || 360;

          if (w > maxDimension || h > maxDimension) {
            if (w > h) {
              h = Math.round((h * maxDimension) / w);
              w = maxDimension;
            } else {
              w = Math.round((w * maxDimension) / h);
              h = maxDimension;
            }
          }

          const id = getNextNodeId(doc(), "img");
          const imageName = file.name.replace(/\.[^/.]+$/, "") || "Reference Image";

          const imageNode: PenNode = {
            id,
            type: "frame",
            name: `Image — ${imageName}`,
            x: Math.round(dropWorld.x),
            y: Math.round(dropWorld.y),
            width: w,
            height: h,
            cornerRadius: 16,
            clip: true,
            fill: { type: "image", url: dataUrl },
            children: []
          };

          updateDoc(insertNodeAtWorld(imageNode, dropWorld, id));
          setSelectedIds(new Set([id]));
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    }
  };

  return {
    isDragOverCanvas,
    handleDragOver,
    handleDragLeave,
    handleDrop
  };
}
