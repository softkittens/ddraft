import { createSignal, onMount, onCleanup } from "solid-js";

export function useKeyboardControls(opts: {
  onAltChange?: (held: boolean) => void;
}) {
  const [isAltHeld, setIsAltHeld] = createSignal(false);
  let isSpace = false;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space") isSpace = true;
    if (e.key === "Alt") {
      setIsAltHeld(true);
      opts.onAltChange?.(true);
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
