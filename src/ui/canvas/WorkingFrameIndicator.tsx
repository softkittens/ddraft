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
            const left = box.x * cam.zoom + cam.x - pad;
            const top = box.y * cam.zoom + cam.y - pad;
            const width = Math.max(8, box.width * cam.zoom) + pad * 2;
            return {
              name,
              selected,
              left,
              top,
              width,
              height: Math.max(8, box.height * cam.zoom) + pad * 2,
              radius: frameCornerRadius(id, cam.zoom) + pad,
              labelLeft: box.x * cam.zoom + cam.x,
              labelTop: box.y * cam.zoom + cam.y - 20,
              dotLeft: (box.x + box.width) * cam.zoom + cam.x - 10,
              dotTop: box.y * cam.zoom + cam.y - 18
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
                    class="absolute left-0 top-0"
                    style={{
                      transform: `translate3d(${item().labelLeft}px, ${item().labelTop}px, 0)`,
                      color: item().selected ? "#0d99ff" : "rgba(0, 0, 0, 0.45)",
                      "font-size": "11px",
                      "line-height": "14px"
                    }}
                  >
                    <span class="whitespace-nowrap">{item().name}</span>
                  </div>
                  <div
                    class="absolute left-0 top-0"
                    style={{
                      transform: `translate3d(${item().dotLeft}px, ${item().dotTop}px, 0)`
                    }}
                  >
                    <span class="agent-work-dot" />
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
