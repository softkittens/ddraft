import { Component, Show, createSignal, createEffect } from "solid-js";
import { camera, layoutTree } from "../store";
import { findNodeWorldBox } from "../../interaction/hittest";
import { agentEditTarget } from "./agentEditTargets";

export const AgentPens: Component = () => {
  const [canJump, setCanJump] = createSignal(false);

  createEffect(() => {
    const id = agentEditTarget()?.nodeId;
    if (!id) {
      setCanJump(false);
      return;
    }
    if (!canJump()) {
      requestAnimationFrame(() => setCanJump(true));
    }
  });

  const box = () => {
    const target = agentEditTarget();
    if (!target) return null;
    const world = findNodeWorldBox(layoutTree(), target.nodeId);
    if (!world) return null;
    const cam = camera();
    return {
      left: world.x * cam.zoom + cam.x,
      top: world.y * cam.zoom + cam.y,
      width: Math.max(8, world.width * cam.zoom),
      height: Math.max(8, world.height * cam.zoom)
    };
  };

  const orbitPath = () => {
    const current = box();
    if (!current) return "";
    const inset = 2;
    return `M ${inset} ${inset} H ${Math.max(inset, current.width - inset)} V ${Math.max(inset, current.height - inset)} H ${inset} Z`;
  };

  return (
    <Show when={agentEditTarget() !== null}>
      <div class="absolute inset-0 pointer-events-none overflow-hidden z-20">
        <Show when={box() !== null}>
          <div
            class={`absolute ${canJump() ? "agent-pen-track" : ""}`}
            style={{
              left: `${box()?.left ?? 0}px`,
              top: `${box()?.top ?? 0}px`,
              width: `${box()?.width ?? 0}px`,
              height: `${box()?.height ?? 0}px`
            }}
          >
            <div class="absolute inset-0 rounded-md border-[1.5px] border-neutral-900/25" />
            <div class="agent-pen text-neutral-900" style={{ "offset-path": `path("${orbitPath()}")` }}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M14.8 3.2a1.6 1.6 0 0 1 2.3 0l3.7 3.7a1.6 1.6 0 0 1 0 2.3L9.4 21H3v-6.4L14.8 3.2Z"
                  fill="currentColor"
                  stroke="#fff"
                  stroke-width="1.4"
                  stroke-linejoin="round"
                />
                <path
                  d="M13.6 5.4 18.6 10.4"
                  stroke="#fff"
                  stroke-width="1.2"
                  stroke-linecap="round"
                  opacity="0.45"
                />
              </svg>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
};
