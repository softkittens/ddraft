import { Component, Show } from "solid-js";
import { camera, layoutTree } from "../store";
import { findNodeWorldBox } from "../../interaction/hittest";
import { activeEditTarget } from "./agentPen";

export const AgentPens: Component = () => {
  return (
    <Show when={activeEditTarget()}>
      {(target) => {
        const liveBox = () => {
          const tree = layoutTree();
          return findNodeWorldBox(tree, target().nodeId) ?? target().box;
        };

        const cam = () => camera();
        const left = () => liveBox().x * cam().zoom + cam().x;
        const top = () => liveBox().y * cam().zoom + cam().y;
        const width = () => Math.max(8, liveBox().width * cam().zoom);
        const height = () => Math.max(8, liveBox().height * cam().zoom);

        return (
          <div class="absolute inset-0 pointer-events-none overflow-hidden z-20">
            <div
              class="absolute transition-all duration-200 ease-out"
              style={{
                transform: `translate3d(${left()}px, ${top()}px, 0)`,
                width: `${width()}px`,
                height: `${height()}px`
              }}
            >
              {/* Subtle edit bounding ring */}
              <div class="absolute inset-0 rounded-lg border-2 border-neutral-900/40 shadow-sm animate-pulse" />
              {/* Sleek pen badge at top-left corner */}
              <div class="absolute -top-2.5 -left-2.5 w-6 h-6 rounded-full bg-neutral-900 text-white shadow-md flex items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
};
