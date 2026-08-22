import { Component, For, Show } from "solid-js";
import { camera, layoutTree, nodeMap, selectedIds } from "../store";
import { findNodeWorldBox } from "../../interaction/hittest";
import type { FrameNode } from "../../model/types";
import { workingFrameIds } from "./workingFrames";

function frameCornerRadius(id: string, zoom: number): number {
  const node = nodeMap().get(id) as FrameNode | undefined;
  const raw = node?.cornerRadius;
  const world = typeof raw === "number" ? raw : Array.isArray(raw) ? (raw[0] ?? 0) : 0;
  return Math.max(0, world * zoom);
}

export const WorkingFrameIndicator: Component = () => {
  return (
    <div class="absolute inset-0 pointer-events-none z-20">
      <For each={workingFrameIds()}>
        {(id) => {
          const frame = () => {
            const box = findNodeWorldBox(layoutTree(), id);
            if (!box) return null;
            const cam = camera();
            const pad = 2;
            const name = nodeMap().get(id)?.name || id;
            const selected = selectedIds().has(id);
            return {
              name,
              selected,
              left: box.x * cam.zoom + cam.x - pad,
              top: box.y * cam.zoom + cam.y - pad,
              width: Math.max(8, box.width * cam.zoom) + pad * 2,
              height: Math.max(8, box.height * cam.zoom) + pad * 2,
              radius: frameCornerRadius(id, cam.zoom) + pad,
              labelLeft: box.x * cam.zoom + cam.x,
              labelTop: box.y * cam.zoom + cam.y - 20
            };
          };

          return (
            <Show when={frame()}>
              {(item) => (
                <>
                  <div
                    class="agent-work-ring absolute left-0 top-0"
                    style={{
                      transform: `translate3d(${item().left}px, ${item().top}px, 0)`,
                      width: `${item().width}px`,
                      height: `${item().height}px`,
                      "border-radius": `${item().radius}px`
                    }}
                  />
                  <div
                    class="absolute left-0 top-0 flex items-center gap-1.5"
                    style={{
                      transform: `translate3d(${item().labelLeft}px, ${item().labelTop}px, 0)`,
                      color: item().selected ? "#0d99ff" : "rgba(0, 0, 0, 0.45)",
                      "font-size": "11px",
                      "line-height": "14px"
                    }}
                  >
                    <span class="whitespace-nowrap">{item().name}</span>
                    <span class="agent-work-dot shrink-0" />
                  </div>
                </>
              )}
            </Show>
          );
        }}
      </For>
    </div>
  );
};
