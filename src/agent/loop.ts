import { complete, type Message, type Provider, type Tool } from "./provider";

export type { Tool };

export type ExecuteFn = (name: string, args: unknown) => Promise<string>;
export type CompleteFn = typeof complete;

export async function runAgent(
  p: Provider,
  messages: Message[],
  tools: Tool[],
  execute: ExecuteFn,
  maxTurns = 8,
  completeFn: CompleteFn = complete
): Promise<Message[]> {
  const out = [...messages];

  for (let turn = 0; turn < maxTurns; turn++) {
    const reply = await completeFn(p, out, tools);
    out.push(reply);
    if (!reply.tool_calls || reply.tool_calls.length === 0) return out;

    for (const call of reply.tool_calls) {
      let parsed: unknown;
      try {
        parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        out.push({
          role: "tool",
          content: `error: invalid JSON arguments: ${detail}`,
          tool_call_id: call.id
        });
        continue;
      }
      const result = await execute(call.function.name, parsed);
      out.push({ role: "tool", content: result, tool_call_id: call.id });
    }
  }

  return out;
}
