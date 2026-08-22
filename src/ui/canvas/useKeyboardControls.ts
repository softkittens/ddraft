import { createSignal, onMount, onCleanup } from "solid-js";
import { selectedIds, nodeMap, editingTextId, setEditingTextId, deleteSelectedNodes } from "../store";

export function useKeyboardControls(opts: {
  onAltChange?: (held: boolean) => void;
}) {
  const [isAltHeld, setIsAltHeld] = createSignal(false);
  let isSpace = false;

  const handleKeyDown = (e: KeyboardEvent) => {
    const isInput =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (e.target as HTMLElement)?.isContentEditable;

    if (e.code === "Space" && !isInput) isSpace = true;
    if (e.key === "Alt") {
      setIsAltHeld(true);
      opts.onAltChange?.(true);
    }

    if (!isInput) {
      if (e.key === "Enter" && selectedIds().size === 1) {
        const id = Array.from(selectedIds())[0];
        if (nodeMap().get(id)?.type === "text") {
          e.preventDefault();
          setEditingTextId(id);
        }
      } else if (e.key === "Escape") {
        if (editingTextId()) {
          setEditingTextId(null);
        }
      } else if (e.key === "Backspace" || e.key === "Delete") {
        if (!editingTextId() && selectedIds().size > 0) {
          e.preventDefault();
          deleteSelectedNodes();
        }
      }
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") isSpace = false;
    if (e.key === "Alt") {
      setIsAltHeld(false);
      opts.onAltChange?.(false);
    }
  };

  const handleBlur = () => {
    isSpace = false;
    setIsAltHeld(false);
    opts.onAltChange?.(false);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("blur", handleBlur);
  });

  return {
    isAltHeld,
    get isSpace() {
      return isSpace;
    }
  };
}
