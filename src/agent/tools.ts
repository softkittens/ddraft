import type { Document } from "../model/types";
import { pageScopedDocument } from "../model/pages";
import { findNode } from "../model/tree";
import type { FetchFn, Tool } from "./provider";
// Registers the full icon catalog. Without it every name outside the
// browser core map resolves to nothing and paints the fallback glyph.
import "../model/iconCatalog";
import { type DocumentToolDefinition, type ToolContext } from "./tools/types";
import type { ChromeArchetype } from "../design/chrome";
import { styleTools } from "./tools/styleTools";
import { propertyTools } from "./tools/propertyTools";
import { mutationTools } from "./tools/mutationTools";
import { mediaTools } from "./tools/mediaTools";
import { normalizeNodeTree, describeNormalization, type NormalizeReport } from "./tools/normalize";

export { normalizeNodeTree, describeNormalization, type NormalizeReport };

const ALL_DOCUMENT_TOOLS: DocumentToolDefinition[] = [
  ...styleTools,
  ...propertyTools,
  ...mutationTools,
  ...mediaTools
];

const TOOL_MAP = new Map<string, DocumentToolDefinition>(
  ALL_DOCUMENT_TOOLS.map((tool) => [tool.name, tool])
);

/**
 * What the model is offered, as the wire format the provider reads.
 * Derived directly from the unified TypeScript tool definitions.
 */
export const TOOL_DEFS: Tool[] = ALL_DOCUMENT_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters
}));

export function createDocumentTools(
  initial: Document,
  image: { providerId?: string; apiKey?: string; fetch?: FetchFn } = {},
  pageId?: string,
  archetype: ChromeArchetype = "unspecified"
) {
  let doc = initial;

  /**
   * Every value each property has been given during this session.
   *
   * A review pass in one trace wrote frame_qcdz6z.height as 450, 250, 450, 250
   * and frame_ju30uo.height as fit_content, 188, 188, fit_content — landing back
   * where it started after four writes. That is not converging on an answer, it
   * is alternating between two guesses, and nothing in the loop said so. Naming
   * the repeat turns an invisible oscillation into something the model can act
   * on: the value is not the problem, so stop trying values.
   */
  const writeHistory = new Map<string, string[]>();

  /**
   * The repeats since the session loop last asked, so it can price them.
   */
  const revisited = new Map<string, string[]>();

  function recordWrite(id: string, property: string, value: unknown): string {
    const key = `${id}.${property}`;
    const seen = writeHistory.get(key) ?? [];
    const encoded = JSON.stringify(value ?? null);
    const repeat = seen.includes(encoded);
    writeHistory.set(key, [...seen, encoded]);
    if (!repeat || seen.length < 2) return "";
    revisited.set(key, [...seen, encoded]);
    return `note: ${key} has now been ${seen.length + 1} values this session and is back to one it already had (${seen.map((v) => v).join(" -> ")}). The value is not what decides this box. Change the parent's layout, or delete the node and rebuild it.`;
  }

  const ctx: ToolContext = {
    get doc() {
      return doc;
    },
    setDoc(next: Document) {
      doc = next;
    },
    get initialDoc() {
      return initial;
    },
    get pageDoc() {
      return pageScopedDocument(doc, pageId);
    },
    pageId,
    offPage(id: string | undefined) {
      if (!pageId || !id) return undefined;
      // Unknown ids are not this guard's business. The tools already report a
      // missing node in their own words, and answering "not on this page" for
      // a typo would send the model looking for a page problem it does not have.
      if (!findNode(doc.children, id)) return undefined;
      if (findNode(pageScopedDocument(doc, pageId).children, id)) return undefined;
      return `error: ${id} is on another page. This run is working on one page; switch pages to edit it.`;
    },
    image,
    recordWrite,
    archetype
  };

  async function execute(name: string, args: unknown): Promise<string> {
    const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    const tool = TOOL_MAP.get(name);
    if (!tool) {
      return `error: unknown tool "${name}"`;
    }
    return tool.execute(ctx, a);
  }

  return {
    execute,
    get doc() {
      return doc;
    },
    /** Slots put back to a value they already held, and cleared as they are read. */
    drainRevisits(): { key: string; values: string[] }[] {
      const out = [...revisited].map(([key, values]) => ({ key, values }));
      revisited.clear();
      return out;
    }
  };
}
