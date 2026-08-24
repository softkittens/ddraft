# ddraft

An experiment. A 2D design canvas that reads and writes `.pen`, with an agent
that builds screens on it. Built to learn, not to ship.

---

## Why it exists

I built this to learn canvas properly. I wanted to write a real editor —
layout, hit-testing, rendering — instead of reading about one.

I chose `.pen` compatibility as the constraint. A format you must match teaches
you more than a format you invent. You cannot change the rules when a part gets
hard. It also meant learning the format at the level of how a document behaves,
not how it looks in a demo.

The first four commits are the engine. I wrote them slowly, over about seven
hours. This was on purpose. I wanted the full mental model first: how a node
sizes itself, when a parent knows its own width, where coordinates change from
local to world.

The agent lands in commit 5. That part went fast and got messy. It has been
through several cycles: build something that works, watch it turn into a mess,
then cut it back. The log shows them. `Refactor Audits And Improve Design
Guidance` removes 2,697 lines and adds 2,178. `Modularize document tools` and
the ChatPanel and CanvasView refactors have the same shape.

The code is still larger than I want: 24,926 lines in 124 files. I keep
reducing it.

---

## What this is not

This is a prototype. It is not a product. It is missing:

| Missing | Status |
|---|---|
| MCP server | None. The agent runs over HTTP and SSE only. |
| Property inspector | Read-only. It shows width, height, gap and font size, and nothing more. |
| Manual editing | An afterthought. Floating controls on the canvas set fill, size, radius, spacing, font size and alignment. That is all. |
| Style editing | None. The agent picks the palette and the type pairing with `set_style`. Nothing in the UI changes them afterwards. |
| Drawing tools | Select, frame, rectangle and text. No pen tool, no path editing, no boolean operations. The renderer draws ellipses, polygons and paths, but nothing creates them. |
| Multiplayer | None. One browser, one document. |
| Cloud storage | None. IndexedDB in the browser. |
| Plugins | None. |
| Prototyping and links | None. |
| Comments | None. |
| Fonts | A fixed list of 11 families. No upload. |
| Constraints | None. Auto-layout only. |

The parts that are complete are the layout engine, the audit rules and the
evaluation harness. Everything else is thin.

---

## Running it

```bash
bun install
bun run dev              # editor
bun run agent            # agent server, needs a provider key in .env
bun test                 # 659 tests
bun run test:agreement   # layout checked against real Pen bounds, 8/8
```

---

## How it works

### `src/model` — the document

A tree of nodes and the edit operations on it.

Every operation returns a new document when something changes. It returns the
same instance when nothing changes. So `doc !== prev` is a true change signal,
and the UI can memoise on it.

`instance.ts` expands `reusable` components into their `ref` instances.

### `src/layout` — the engine

One pure function: `layoutDocument(doc) -> LayoutNode[]`.

No DOM. No reflow. It runs the same in the browser and in `bun test`.

Two passes. Widths resolve downward. Heights resolve upward.

That order matters. A text node set to `fill_container` has no width to wrap
against until its parent gives it one. Skip that step and the parent sizes
itself to a single line. Every line after the first then falls outside the box.

### `src/agreement` — layout checked against ground truth

Pen reports `ctx.bounds` for every node. That is a free numeric oracle: lay out
the same document, compare every box, and the two must agree.

`agreement.html` runs the comparison in a browser, where a real font engine
exists. While it runs, it records every text advance width Chrome produced.
Save those metrics and `bun run test:agreement` replays the same comparison with
no browser at all.

It passes 8 of 8.

### `src/render` and `src/interaction`

A canvas 2D painter: culling, gradients, shadows, blurs, stroke alignment.

Hit-testing, drag, marquee selection and an animated camera.

### `src/design` — style and audit

The visual system the agent chooses from: palettes, roundness, elevation, type
pairings.

A deterministic auditor over the laid-out tree: WCAG contrast, tap targets,
clipped text, off-grid spacing, untokenized colour.

Each rule has a test that injects the fault and asserts the rule reports it. A
check that cannot fail is not a check.

### `src/agent` — the design agent

It reads the canvas as a compact digest, not raw JSON.

It writes through 16 semantic tools — `set_style`, `create_screen`,
`insert_node`, `place_instances`, `measure` and others. It never writes pixel
coordinates.

Fixed numbers live in code, not in the prompt. `create_screen` applies the
status bar height, the tab bar geometry and the padded content wrapper. A
constant in a prompt is a request. A constant in a tool is a fact.

### `eval/` — measurement

A harness. It runs a set of briefs N times and records blockers by rule, tool
calls, and craft metrics: token coverage, spacing discipline, component reuse.

It exists because "that run looked good" is not a measurement. I was often wrong
about which change had helped.

---

## Pages

Pen has no pages. I added them without changing the format.

The `.pen` root is closed: `version`, `themes`, `imports`, `variables`,
`children`. There is no page node. So a page here is not a container. It is a
**label that a screen carries**.

The label goes in `metadata`. The schema declares `metadata` as an open bag on
every node. I did not use a bare `page` property. That would be a guess about
how another parser treats an unknown key.

Page order and display names go on the document. If another tool drops document
metadata, you lose an order that first appearance can rebuild. That loss is
visible and repairable. Membership is the fact that cannot be lost quietly, so
it goes where the format promises to keep it.

Backward compatibility:

- An old document resolves to one implicit page.
- One page behaves exactly as a flat child list did.
- Nothing migrates. Nothing is stamped on load.
- A document gains a second page only when something writes a label.
- `screensOfPage(doc)` with no page returns the whole child list, which is what
  every caller did before.

---

## What I would fix next

1. The UI layer is the least disciplined code here.
2. The agent cannot see what it draws. It measures geometry. Geometry does not
   tell you if a design is ugly.
3. Run-to-run variance on one brief is too high.
