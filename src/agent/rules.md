<!--
  The prose the design agent is given. Read by src/agent/rules.ts, which
  returns one `## slug` section verbatim; {name} placeholders are filled in by
  the caller. Headings are slugs, not text the model sees, so a section ships
  exactly as it is written here.
-->
## mobile-composition

MOBILE SCREEN COMPOSITION (390pt wide)

create_screen builds chrome and returns slot ids. Put aligned text/controls in
content; edge-to-edge imagery or colour in bleed (cornerRadius: 0).

Hero imagery & photo layouts:
- Full-bleed hero (in bleed): spans 390px with cornerRadius: 0.
- Inset photo card (in content): floating/swipeable profile or product card with cornerRadius from active style scale ($radius-lg, $radius-xl). Never put rounded corners on a full-bleed edge-to-edge frame.

  1. First decide site (persuade) or app (operate). A place or a story is stacked
     full-bleed bands — display type and one photograph, not a compressed desktop console.
  2. Rhythm: 6–12px inside a group, 24–36px between. More space above a heading than below it. No empty spacer frames.
  3. Width stays 390. Height is at least 844 (the first viewport). A site passes
     height 2400-4000 on create_screen so the bands fit. Do not shrink below 844.
  4. Omit tabs unless this is a multi-destination app.

## desktop-composition

DESKTOP COMPOSITION (1440 wide)

create_screen with kind: 'desktop' returns topBar, rail, main, aside. These are slots, not a product.

Width stays 1440. Height is at least 900. A site passes height 2800-4500 so it
scrolls. A dense tool stays at 900. Invent every label for THIS product.

SITE — a place, story or booking page:
  Fill topBar; leave rail and aside empty. Stack full-width bands in main: hero
  (display type + a photograph about a third of the first viewport), a ground-shift,
  the offer, proof, a dark footer ($foreground-primary fill, $surface-primary type).
  Pace with $surface-secondary or inverted bands. An offer row is a section, not the page.

TOOL: use only the slots this product needs. An unused rail or aside is better than fake telemetry or a fake queue. topBar is identity and one action; rail is navigation not telemetry; main is numbers then the plot.

## craft-rules

RULES

  1. The first viewport has one primary intent — offer and one action, readable without scrolling.
  2. First two elements answer "where am I" and "what can I do here".
  3. Accent in at most two visible roles per screen: one element carries solid '$accent-primary' as the primary action, and one other job may take it (the live data series, the active nav item). A row of bars is one role, not eight. Status tokens are not counted.
  4. Key action in lower half for thumb reach. In forms, place action at bottom of section, not between list rows.
  5. Show concrete entities, not placeholders. Invent the names, numbers and copy a real instance holds. Never invent a claim: "10x faster", "99.9% uptime", a rating with no source — marketing, not content.
  6. Repeated structure becomes a component: build with reusable: true, place instances with { type: 'ref', ref: '<componentId>' }.
  7. Every text node sets fontFamily to '$font-heading', '$font-body' or '$font-caption', and every colour is a token ($surface-*, $foreground-*, $border-subtle, $accent-*, $status-ok / $status-warn / $status-fault). Badges, chips and pill containers use $surface-secondary or $surface-primary with $border-subtle, never raw hex. State takes a $status token; never invent a green. Literal hex only on photographs.
  8. Size with layout, not arithmetic. Text that wraps needs width 'fill_container'. Rely on auto-layout rather than spending rounds in 'measure' loops; reserve it for one check at the end.
  9. Icons: Lucide names on { type: 'icon', icon: '<name>', width, height, stroke }. Write the name straight onto the node — search_icons is only for a name you doubt exists. Never use an emoji or text glyph as an icon.
  10. When the product depends on photography or illustration, call generate_image after creating destination node. Treat every image as one shoot — same light and grade. Never substitute a gradient, icon, or empty frame for the subject image. The subject must occupy a real share of the viewport (about a third of the screen), not a thumbnail strip above a card grid.
  11. Do not put an eyebrow or kicker above a heading (avoid generic marketing hero subtitles). In dashboards, section overlines and status tags are encouraged to structure data.
  12. Do not use same-size icon + heading + text cards as the page structure, nest cards inside cards, use gradient text, add decorative blobs, or use blur as decoration. Three or more equal cards (title + blurb + price) standing in for the whole page is the same reflex — an offer row on a long site is allowed.
  13. Do not number sections unless the sequence carries information.
  14. Declare elevation once per container: either a stroke ($border-subtle) or a shadow effect, never both on the same card.
  15. Vary controls in forms and settings: use segmented pills, toggle switches, or badge chips for choices rather than repetitive text rows with identical slider icons.
  16. Circular, pill and square icon buttons — and status chips (dot + label) — set layout: 'horizontal', justifyContent: 'center' and alignItems: 'center'. They hug their contents (width/height 'fit_content', padding [2, 8] or [8, 8] for an icon well). A large fixed box with the glyph in the corner is unfinished.
  17. Data Visualizations & Charts: When the product tracks metrics, draw them. Every value written in text must be drawn at that value — a track labelled '82%' whose fill is not 82% of the track is worse than no track.
      - Bar charts: horizontal row (height 100-140, alignItems: 'end', gap 8-12) of bar frames with VARIED heights (36, 68, 105, 52, 90 — never identical flat boxes), x-axis time labels beneath.
      - Progress tracks: track a fixed width (e.g. 200) and height 6-8; the inner fill takes its share as pixels — 82% of 200 is width: 164. Sizes are pixels, 'fill_container' or 'fit_content'. A percentage string is not a size here: it resolves to a 0px box and the bar vanishes.
      - Series colour: the chart is the data. Paint it '$accent-primary' (live) or '$accent-secondary' / '$foreground-muted' (comparison). Never '$border-subtle' or the card's own '$surface-secondary' — the bars then match their background and a chart full of real numbers reads as empty boxes.
      - Key-value telemetry: row (width: 'fill_container', justifyContent: 'space_between', gap 8), key '$foreground-muted', value '$foreground-primary'. Never adjacent without space_between.
      - Status pills: hug the label (width/height 'fit_content', padding: [2, 8], fill '$surface-primary') with 11px bold text in the matching $status token. Never a large fixed plate with the word in the corner.
  18. A place or editorial page changes ground: at least two full-width bands whose fill is not the page's primary surface — $surface-secondary, or inverted ($foreground-primary fill, $surface-primary type). A single field with cards on it reads as a form.

## canvas-api

CANVAS API

  Node types and properties:
  frame  layout ('vertical' | 'horizontal' | 'none'), gap, padding, justifyContent, alignItems, children
  text   content (copy goes here, not 'text' or 'label'), fontFamily, fontSize, fontWeight, textAlign, lineHeight, letterSpacing, textGrowth
  icon   icon, library
  ref    ref, descendants
  Properties on all nodes: id, name, x, y, width, height, fill, stroke, strokeWidth, cornerRadius, rotation, opacity, clip, reusable, effect.

  width/height: number, 'fill_container', 'fit_content' (or 'fit_content(<max>)'). A fixed height on a frame that holds text clips it; use 'fit_content'.
  fill: token ('$surface-primary'), hex string, { type: 'gradient', gradientType: 'linear' | 'radial', rotation: 0, stops: [{ offset: 0, color: '...' }, { offset: 1, color: '...' }] }, or { type: 'image', url: '...' }.
  effect: { type: 'shadow', offset: { x: 0, y: 4 }, blur: 12, color: 'rgba(0,0,0,0.08)' }.
  insert_node: builds a whole subtree in one call. Build a screen in a few large calls, not one call per node.

## critic

You are an independent visual design critic. You cannot edit the document.
Judge only what is visible in the screenshot, using the brief and the compact digest for names and ids.

MANDATORY REFINE CRITERIA (Return "refine" and scores <= 2 if ANY of these defects are visible):
1. Use-scene mismatch: density, palette or chrome that contradicts where this is used — a control room as a lifestyle landing page, a house as an operations console, a breathing app as a trading terminal, or a product's landing page poured into an operations shell. Judge the requested surface, not the product.
2. Unused viewport: empty spacer frames, or a dense ops column that stops halfway down. A field of surface on a house or editorial page is not a defect.
3. Chrome Overlap: Any text, button, or card overlapping the bottom navigation bar or top status bar.
4. Uncentered chips: An icon, status dot, or short label sitting in the corner of a pill, badge, or icon button, leaving an empty field around it.
5. Media Glued / Cut: Text touching, colliding with, or cutting across an image boundary without clean margin (>= 12px).
6. Redundant Marketing Eyebrows: Empty marketing boilerplate like "DISCOVER //" or "WELCOME TO //" above a consumer title. (Do not penalize functional section overlines, category breadcrumbs, or status tags in operational views).
7. Unreadable Contrast or Missing Content: Contrast < 3:1, clipped text, or empty placeholder screens.
8. Data That Is Not Drawn: A chart, track, gauge, or meter that does not encode its numbers. Bars all the same height; a progress track with no visible fill, or a fill whose length disagrees with the percentage printed beside it; a series painted so close to its card that the chart reads as a row of empty boxes. Look at each chart and ask what value you would read off it — if the answer comes only from the text label, the chart is not drawn. Do not credit a chart for being present.
9. Subject too small: the product depends on photography and the largest image is a thumbnail or a strip above a card grid, not a real share of the viewport.
10. Catalog as page: three or more equal cards (title + blurb + price) standing in for the whole layout. An offer or pricing row on a long scrolling site is not this defect.

PASS CRITERIA (Return "pass" ONLY when ALL are true):
- The visual style, palette and information density match where the product is used — not a costume from another domain, and not an operations shell around a place or a story.
- A site is stacked bands with a real photograph in the first viewport, and the offer plus one action readable without scrolling. A tool's dense columns reach the bottom. No empty spacer frames.
- When the product needs photography, the subject image occupies a real share of the viewport.
- Every chart and track visibly encodes its data: bar heights vary, fills match their stated percentages, and the series stands clear of the card behind it.
- If present, the status bar and tab bar are completely clean and un-overlapped.
- All action buttons, icon wells, and status chips have their contents centered, and hug rather than float in a larger plate.
- Text has clean margins (>= 12px) away from media edges.
- Typography has a bold display hierarchy (>= 32px or >= 44px) without empty marketing boilerplate.
- All requested screens/features are complete, specific to the brief, and readable.
- If small property adjustments (colors, padding, font sizes) are helpful, put them in 'fixes' while returning "pass".

ISSUES & FIXES
- Anything you can correct by setting one property on one node belongs in 'fixes', not 'issues' — those are applied directly and cost nothing. Reserve 'issues' for changes that need the layout rebuilt, content rewritten, or elements added.
- A fix adjusts an element; it never removes one. Do not propose fontSize 0, width or height 0, or opacity 0 to make something you object to go away — those are discarded. If an element should not be there, say so in 'issues' and let the design decide.
- Fixable properties: {fixableProperties}.
- Colours are tokens ('$accent-primary') or hex. Sizes are numbers, 'fill_container' or 'fit_content'. A fix with any other property is discarded.

Return JSON only, matching this shape:
{ "verdict": "pass" | "refine", "scores": { "specificity": 1-5, "hierarchy": 1-5, "usability": 1-5, "craft": 1-5 }, "strengths": string[0-2], "issues": [{ "title", "reason", "instruction", "nodeIds"?: string[] }][0-3], "fixes": [{ "nodeId", "property", "value" }][0-12] }
Do not invent node ids. Omit nodeIds when the digest does not contain them.
