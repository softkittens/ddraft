import { describe, it, expect } from "bun:test";
import type { Message } from "../src/agent/provider";
import { commitAgentPass, isToolMessage, groupTranscriptEntries } from "../src/ui/chat/types";
import type { Entry } from "../src/ui/chat/types";

function msg(role: Message["role"], content: string, extra: Partial<Message> = {}): Message {
  return { role, content, ...extra };
}

describe("commitAgentPass", () => {
  it("rebuilds from done when the finished messages still include tools", () => {
    const user = msg("user", "design a site");
    const tool = msg("tool", "ok: built screen", { tool_call_id: "c1" });
    const assistant = msg("assistant", "Done.");
    const visibleBase: ReturnType<typeof commitAgentPass> = [];
    const live = [
      { kind: "message" as const, message: user },
      { kind: "message" as const, message: tool, tool: "create_screen" }
    ];

    const next = commitAgentPass({
      live,
      visibleBase,
      finalMessages: [user, assistant, tool, assistant],
      contextLength: 0
    });

    expect(next.filter(isToolMessage)).toHaveLength(1);
    expect(next.some((e) => e.kind === "message" && e.message.role === "assistant")).toBe(true);
  });

  it("keeps streamed tools when done omits them", () => {
    const user = msg("user", "design a site");
    const tool = msg("tool", "ok: built screen", { tool_call_id: "c1" });
    const assistant = msg("assistant", "A booking site for Lume.");
    const live = [
      { kind: "message" as const, message: user },
      { kind: "message" as const, message: tool, tool: "create_screen" }
    ];

    const next = commitAgentPass({
      live,
      visibleBase: [],
      finalMessages: [user, assistant],
      contextLength: 0
    });

    expect(next.filter(isToolMessage)).toHaveLength(1);
    expect(
      next.some(
        (e) => e.kind === "message" && e.message.role === "assistant" && e.message.content === assistant.content
      )
    ).toBe(true);
  });

  it("filters out the internal user revision instruction when visibleInput is false", () => {
    const internalPrompt = msg("user", "[Visual review revision]\nOriginal brief: Space site\n- Fix button");
    const tool = msg("tool", "ok: updated", { tool_call_id: "c1" });
    const assistant = msg("assistant", "Adjusted button alignment and padding.");
    const visibleBase: Entry[] = [
      { kind: "message", message: msg("user", "Create a space site") }
    ];
    const live: Entry[] = [
      ...visibleBase,
      { kind: "message", message: tool, tool: "set_property" }
    ];

    const next = commitAgentPass({
      live,
      visibleBase,
      finalMessages: [internalPrompt, assistant, tool, assistant],
      contextLength: 0,
      visibleInput: false
    });

    expect(next.some((e) => e.kind === "message" && e.message.content === internalPrompt.content)).toBe(false);
    expect(next.some((e) => e.kind === "message" && e.message.content === "Create a space site")).toBe(true);
    expect(next.some((e) => e.kind === "message" && e.message.role === "assistant")).toBe(true);
  });
});

describe("groupTranscriptEntries", () => {
  it("groups consecutive tool calls into a single tool_group display item", () => {
    const entries: Entry[] = [
      { kind: "message", message: msg("user", "make a button") },
      { kind: "message", message: msg("tool", "ok"), tool: "insert_node" },
      { kind: "message", message: msg("tool", "ok"), tool: "set_property" },
      { kind: "message", message: msg("tool", "ok"), tool: "set_style" },
      { kind: "message", message: msg("assistant", "Done!") }
    ];

    const grouped = groupTranscriptEntries(entries);
    expect(grouped).toHaveLength(3);
    expect(grouped[0].type).toBe("entry");
    const g1 = grouped[1];
    expect(g1.type).toBe("tool_group");
    if (g1.type === "tool_group") {
      expect(g1.entries).toHaveLength(3);
    }
    expect(grouped[2].type).toBe("entry");
  });

  it("leaves individual non-consecutive items as entries", () => {
    const entries: Entry[] = [
      { kind: "message", message: msg("user", "first") },
      { kind: "message", message: msg("tool", "ok"), tool: "insert_node" },
      { kind: "message", message: msg("assistant", "Done 1") },
      { kind: "message", message: msg("user", "second") },
      { kind: "message", message: msg("tool", "ok"), tool: "set_property" }
    ];

    const grouped = groupTranscriptEntries(entries);
    expect(grouped).toHaveLength(5);
  });

  it("groups tools even when intermediate empty assistant messages exist in the transcript", () => {
    const entries: Entry[] = [
      { kind: "message", message: msg("user", "build layout") },
      { kind: "message", message: msg("assistant", "") },
      { kind: "message", message: msg("tool", "ok"), tool: "insert_node" },
      { kind: "message", message: msg("assistant", "") },
      { kind: "message", message: msg("tool", "ok"), tool: "set_property" },
      { kind: "message", message: msg("assistant", "") },
      { kind: "message", message: msg("tool", "ok"), tool: "set_style" },
      { kind: "message", message: msg("assistant", "Finished.") }
    ];

    const grouped = groupTranscriptEntries(entries);
    expect(grouped).toHaveLength(3);
    expect(grouped[0].type).toBe("entry");
    const g1 = grouped[1];
    expect(g1.type).toBe("tool_group");
    if (g1.type === "tool_group") {
      expect(g1.entries).toHaveLength(3);
    }
    expect(grouped[2].type).toBe("entry");
  });
});
