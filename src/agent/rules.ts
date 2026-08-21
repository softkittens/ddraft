/**
 * The prose the agent is given, kept out of the code that assembles it.
 *
 * Composition, craft, the canvas API and the critic's brief are English. Held
 * as template literals they were three hundred lines of quoted paragraph in the
 * middle of two modules, and every wording change read as a source change.
 * rules.md holds them as text; this reads one `## slug` section back out.
 *
 * The headings are slugs rather than the titles the model reads, so a section
 * ships exactly as written — nothing is added or trimmed on the way through.
 *
 * Read from disk rather than imported, because the agent runs under bun test,
 * inside the Vite dev middleware and from server.ts, and only one of those has
 * a bundler that could inline a text import. Located by walking up from this
 * module and never from process.cwd(): the icon catalog was resolved against
 * cwd once, and every run started from another directory silently answered out
 * of a 28-icon fallback.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function locate(relative: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`cannot find ${relative} from ${import.meta.url}`);
    dir = parent;
  }
}

const SECTIONS = new Map<string, string>();
for (const block of readFileSync(locate("src/agent/rules.md"), "utf8").split(/^## /m).slice(1)) {
  const heading = block.indexOf("\n");
  SECTIONS.set(block.slice(0, heading).trim(), block.slice(heading + 1).trim());
}

/**
 * One section of rules.md. `vars` fills its `{name}` placeholders, which is how
 * a list the code owns — the critic's fixable-property allowlist — stays in the
 * code while the sentence around it stays in the prose.
 */
export function rules(slug: string, vars: Record<string, string> = {}): string {
  const body = SECTIONS.get(slug);
  if (body === undefined) {
    throw new Error(`rules.md has no "${slug}" section — it has ${[...SECTIONS.keys()].join(", ")}`);
  }
  return body.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}
