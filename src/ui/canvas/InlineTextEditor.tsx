import { Component, createEffect, onCleanup, Show } from "solid-js";
import {
  editingTextId,
  setEditingTextId,
  doc,
  camera,
  layoutTree,
  nodeMap,
  setNodeProperty,
  beginEdit,
  endEdit
} from "../store";
import { resolveVariable } from "../../model/variables";
import { getLineHeight } from "../../layout/text";
import { findNodeWorldBox } from "../../interaction/hittest";
import type { TextNode } from "../../model/types";

export const InlineTextEditor: Component = () => {
  let textareaRef: HTMLTextAreaElement | undefined;

  const currentTextNode = () => {
    const id = editingTextId();
    if (!id) return null;
    const node = nodeMap().get(id);
    return node && node.type === "text" ? (node as TextNode) : null;
  };

  const boxStyle = () => {
    const id = editingTextId();
    const node = currentTextNode();
    if (!id || !node) return null;

    const box = findNodeWorldBox(layoutTree(), id);
    if (!box) return null;

    const cam = camera();
    const screenX = box.x * cam.zoom + cam.x;
    const screenY = box.y * cam.zoom + cam.y;
    const screenW = Math.max(80, box.width * cam.zoom);
    const screenH = Math.max(24, box.height * cam.zoom);
    const fontSize = (node.fontSize || 14) * cam.zoom;
    const lineHeight = getLineHeight(node, doc().variables) * cam.zoom;
    const fontFam = resolveVariable(node.fontFamily || "Inter", doc().variables);
    const color = resolveVariable(node.fill, doc().variables) || "#1e293b";

    return {
      left: `${screenX}px`,
      top: `${screenY}px`,
      width: `${screenW + 8}px`,
      minHeight: `${screenH}px`,
      fontSize: `${Math.max(10, fontSize)}px`,
      lineHeight: `${Math.max(12, lineHeight)}px`,
      fontFamily: fontFam,
      fontWeight: node.fontWeight || "normal",
      color,
      textAlign: node.textAlign || "left"
    };
  };

  createEffect(() => {
    const id = editingTextId();
    if (id && textareaRef) {
      setTimeout(() => {
        if (textareaRef) {
          textareaRef.focus();
          textareaRef.select();
        }
      }, 10);
    }
  });

  /*
   * One undo step for one typing session.
   *
   * Every keystroke writes a document, so Cmd+Z used to walk back through the
   * text one character at a time. Keyed on the id being edited rather than on
   * focus, so every way out — Escape, Enter, a click elsewhere, the selection
   * changing underneath — closes the step, and so does unmounting.
   */
  createEffect(() => {
    if (!editingTextId()) return;
    beginEdit();
    onCleanup(endEdit);
  });

  const handleInput = (e: InputEvent & { currentTarget: HTMLTextAreaElement }) => {
    const id = editingTextId();
    if (!id) return;
    // Writing an instance descendant as an override rather than through to the
    // component is setNodeProperty's job now, not this component's.
    setNodeProperty("content", e.currentTarget.value, [id]);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setEditingTextId(null);
    } else if (e.key === "Enter" && !e.shiftKey) {
      const node = currentTextNode();
      if (node && node.textGrowth !== "fixed-width") {
        e.preventDefault();
        setEditingTextId(null);
      }
    }
  };

  return (
    <Show when={boxStyle()}>
      {(style) => (
        <textarea
          ref={textareaRef}
          value={currentTextNode()?.content || ""}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onBlur={() => setEditingTextId(null)}
          style={{
            position: "absolute",
            left: style().left,
            top: style().top,
            width: style().width,
            "min-height": style().minHeight,
            "font-size": style().fontSize,
            "line-height": style().lineHeight,
            "font-family": style().fontFamily,
            "font-weight": style().fontWeight,
            color: style().color,
            "caret-color": style().color || "#0d99ff",
            "text-align": style().textAlign as any,
            background: "transparent",
            border: "none",
            outline: "none",
            padding: "0",
            margin: "0",
            resize: "none",
            overflow: "hidden",
            "z-index": "40"
          }}
        />
      )}
    </Show>
  );
};
