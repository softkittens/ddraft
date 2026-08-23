<!--
  The prose the design agent is given. Read by src/agent/rules.ts, which
  returns one `## slug` section verbatim; {name} placeholders are filled in by
  the caller. Headings are slugs, not text the model sees, so a section ships
  exactly as it is written here.
-->
## surface-mobile

MOBILE SCREEN COMPOSITION (390pt wide)

create_screen builds chrome and returns slot ids. Put aligned text/controls in
content; edge-to-edge imagery or colour in bleed (cornerRadius: 0).

Mobile Ergonomics & Interaction Physics:
- Thumb-Zone Reachability: Primary interactive controls (actions, confirm buttons, steppers, date pickers) belong in the lower half of the 390px viewport (the natural thumb reach zone), not stranded in the top corners.
- Native Touch Sizing: All tappable elements (buttons, segmented pills, chips, steppers) must have a minimum height of 44px with centered contents (alignItems: 'center', justifyContent: 'center') to prevent mis-taps.
- Single-Task Focus: Prioritize one primary task flow or view per screen (linear vertical flow). A mobile screen is an intimate instrument, not a sprawling multi-column dashboard.
- Domain Atmosphere: Match the sensory tone of the brief — quiet and spacious for meditation; tactile and appetizing for food ordering; crisp, timestamped and clear for utility trackers.

Responsive adaptation from desktop:
- When creating a mobile companion for an existing or co-generated desktop screen, REUSE the exact generated image URLs (fill: { type: "image", url: "..." }) and copy from the desktop nodes. Do not regenerate images or invent new copy for mobile.
- Reflow multi-column desktop rows into vertical single-column stacks (layout: "vertical", width: "fill_container").
- (For standalone mobile-only requests, call generate_image and build mobile directly).

Hero imagery & photo layouts:
- Full-bleed hero (in bleed): spans 390px with cornerRadius: 0.
- Inset photo card (in content): floating/swipeable profile or product card with cornerRadius from active style scale ($radius-lg, $radius-xl). Never put rounded corners on a full-bleed edge-to-edge frame.

  1. First decide site (persuade) or app (operate). A place or a story is stacked
     full-bleed bands — display type and one photograph, not a compressed desktop console.
  2. Rhythm: 6–12px inside a group, 24–36px between. More space above a heading than below it. No empty spacer frames.
  3. Width stays 390. Height defaults to dynamic 'fit_content' with an 844 viewport floor so bands expand naturally without leaving empty space. Multi-section store feeds, food ordering apps, catalogs, and articles scroll naturally (1100–1600px tall) with generous breathing room and whitespace. Only single-card instruments (e.g. swipe/dating decks, camera, player) stay within 844px.
  4. Omit tabs unless this is a multi-destination app.

## surface-desktop

DESKTOP CANVAS LAYOUT (1440 wide)

create_screen with kind: 'desktop' returns topBar, rail, main, aside. These are slots, not a product.
Width stays 1440. Height defaults to dynamic 'fit_content' with a 900 viewport floor so stacked bands scroll naturally. A dense tool stays at 900. Invent every label for THIS product.

## trait-commerce

E-COMMERCE & FOOD / CONSUMER ORDERING CAPABILITIES

Design the use scene, not a standard storefront shell. The screen must make the
seller recognizable, show real purchasable things with photography and prices,
and expose an accessible way to choose or order them. How those capabilities
are composed is yours to decide.

- Choose a product-specific interaction model before laying out sections: direct
  quick-order, flavor or size builder, scheduled drop, tasting menu, visual
  catalog, reorder flow, or another idea justified by the brief.
- Identity, discovery, selection, cart state, promotion, and navigation are
  capabilities, not mandatory rows. Combine, relocate, or omit them when the
  task remains clear. Do not automatically produce header + search + dark hero
  + two cards + promo + bottom tabs.
- Real product photography and legible item names/prices are required. Repeated
  purchasable items need consistent visible actions, but those actions may be
  labels, steppers, buttons, or another clear control—not necessarily circles.
- If there is a featured hero, keep it under 420px on mobile and let subsequent
  content or a scroll cue appear in the first viewport. A commerce screen does
  not require a hero.
- Invent copy for this seller. Examples in instructions describe semantics, not
  strings to reuse.

## trait-swipe

CARD-SWIPE & SOCIAL DISCOVERY APP DENSITY

When building a card-swipe, dating, adoption, or browsing experience:
- Prominent Single-Card Stage: A centered photo profile card occupying the upper-middle viewport with rounded corners ($radius-xl) and subject photo.
- Entity Identification & Bio: Name, age/spec, brief bio, and trait tags (pill containers) resting directly on or below the card.
- Thumb Action Dock: Centered horizontal action bar in the lower thumb zone with distinct circular buttons (Pass [X], Star/Save, Like/Heart in solid $accent-primary) and subtle swipe hint label below.
- Pinned Tab Navigation: Pinned bottom tab bar (Discover, Matches, Saved, Profile).
- Single-Viewport Ceiling: All elements (header, photo card, bio, action dock, and tab bar) MUST fit within the 844px device viewport without vertical scrolling.

## archetype-site

SITE & LANDING PAGE COMPOSITION (1440 wide)

SITE — a place, story, booking or product landing page:
  Fill topBar; leave rail and aside empty. Stack full-width narrative bands in main that fully explore the product's substance across 6–8 varied sections:
  1. First Viewport: bold display title ($font-heading), subline, primary CTA action, and a subject photograph or split composition occupying a real share (about a third of the screen).
  2. Brand Philosophy / Pull-Quote: quiet editorial italic statement establishing the product's voice and point of view.
  3. Tangible Showcase / Spaces / Collection: 3–4 visual cards with photography, descriptions, tags, capacity, or concrete features (an offer row is a section, not the entire page).
  4. Inclusions / Amenities / Capabilities: structured 4–6 item badge or spec grid with Lucide icons (e.g. specialty coffee, fiber wifi, phone booths, or system specs).
  5. Atmospheric Story / Photo Mosaic or Workflow: multi-photo mosaic showing different moments/rooms, or a rich interactive workflow snippet.
  6. Social Validation / Neighborhood / Proof: member or user testimonial cards with names/roles, or location context with photography and details.
  7. Clear Decision / Pricing / Tiers: comparison cards with itemized inclusions, pricing, and action buttons.
  8. Grounding & Navigation: comprehensive multi-column footer ($foreground-primary fill, $surface-primary type) with identity, navigation columns, hours/contact, and legal info.
  Pace sections by alternating rhythm: ground-shift bands ($surface-secondary or inverted dark backgrounds), varying layout densities (cinematic banners, multi-card collections, split stories, spec grids).

## archetype-tool

OPERATIONAL TOOL & DASHBOARD COMPOSITION (1440 wide)

TOOL — an operational console, dashboard, or workbench:
  Use only the slots this product needs (an unused rail or aside is better than fake telemetry or a fake queue).
  Tools follow 3 Operational Principles:
  1. High Information Density (Zero Fluff): Every pixel carries live state, telemetry, coordinates, or logs. Never add decorative marketing cards, giant empty whitespace, or filler copy.
  2. Live State & Data Visualization: Every entity displays its real-time operational status ($status-ok, $status-warn, $status-fault). Charts, gauges, and telemetry tracks must visibly encode real data with varied numbers (Rule 17) — never flat identical placeholder bars.
  3. Actionability & Operational Controls: Provide working controls to filter or manipulate state — time range filters ([1h | 24h | 7d | 30d]), search inputs, filter chips, view toggles, or direct command actions (e.g. 'Emergency Halt', 'Deploy', 'Override').
  Slots: topBar is identity, system health status, and primary action; rail is navigation not telemetry; main is metrics then the plot/grid; aside is context, subsystem breakdown, or alert queue.

## craft-rules

RULES

  1. The first viewport has one primary intent — offer and one action, readable without scrolling.
  2. First two elements answer "where am I" and "what can I do here".
  3. Accent in at most two visible roles per screen: one element carries solid '$accent-primary' as the primary action, and one other job may take it (the live data series, the active nav item). A row of bars is one role, not eight. Status tokens are not counted.
  4. Key action in lower half for thumb reach. In forms, place action at bottom of section, not between list rows.
  5. Transformation over features in copywriting: Lead hero and section headlines with the human outcome or lifestyle transformation ("A quieter way to work in Lisbon", "Find your new best friend", "Finally feel in control") rather than dry tool or utility labels ("Coworking space booking", "Cat discovery database"). Show concrete entities, not placeholders. Invent the names, numbers and copy a real instance holds. Never invent a claim: "10x faster", "99.9% uptime", a rating with no source — marketing, not content.
  6. Repeated structure becomes a component: build with reusable: true, place instances with { type: 'ref', ref: '<componentId>' }.
  7. Every text node sets fontFamily to '$font-heading', '$font-body' or '$font-caption', and every colour is a token ($surface-*, $foreground-*, $border-subtle, $accent-*, $status-ok / $status-warn / $status-fault). Badges, chips and pill containers use $surface-secondary or $surface-primary with $border-subtle, never raw hex. State takes a $status token; never invent a green. Literal hex only on photographs.
  8. Size with layout, not arithmetic. Text that wraps needs width 'fill_container'. Rely on auto-layout rather than spending rounds in 'measure' loops; reserve it for one check at the end.
  9. Icons: Lucide names on { type: 'icon', icon: '<name>', width, height, stroke }. Write the name straight onto the node — search_icons is only for a name you doubt exists. Never use an emoji or text glyph as an icon.
  10. When the product depends on photography or illustration, call generate_image after creating destination node. Treat every image as one shoot — consistent light, lens, material setting and grade chosen for this product. Avoid sterile corporate 3D renders, posed stock handshakes, tacky thumbs-up, or flat white-background clip-art. A primary subject should occupy roughly 18–25% of the first viewport; supporting catalog photography may be smaller.
  11. Do not put an eyebrow or kicker above a heading (avoid generic marketing hero subtitles). In dashboards, section overlines and status tags are encouraged to structure data.
  12. Anti-Box-in-Box Nesting: Avoid wrapping headings, blurbs, or plain text in gratuitous nested card containers (never nest cards inside cards). Rely on generous whitespace and clean grouping. Use container frames only when they have a functional entity role (interactive product cards, pricing tiers, input fields, or promo banners). Do not use same-size icon + heading + text cards as the page structure, nest cards inside cards, use gradient text, add decorative blobs, or use blur as decoration. Three or more equal cards (title + blurb + price) standing in for the whole page is the same reflex — an offer row on a long site is allowed.
  13. Interactive icons sit in a control with a minimum 44px tap target and an 18–24px glyph. Decorative or inline icons do not need their own well.
  14. Button contents must be explicitly centered: an action button with an icon and label must set layout: 'horizontal', alignItems: 'center', justifyContent: 'center'. Never leave an action button with default top-left alignment that strands the text in a corner.
  15. Form controls (inputs, dropdowns, search bars, date pickers) must set layout: 'horizontal', alignItems: 'center', padding: [8, 12] or [10, 14], stroke: '$border-subtle', strokeWidth: 1, cornerRadius: $radius-md, and fill: '$surface-primary' or '$surface-secondary'.
  16. Multi-screen document canvas layout: When creating or rendering multiple screens (e.g. desktop + mobile companion), space top-level screen frames along the X-axis with at least 80px gap (e.g. screen 1 at x: 0, screen 2 at x: 1520). Never overlap top-level screen frames on top of each other.
  17. Media Margins & Safe Breathing Room: Never place text nodes flush against an image, map, or video container edge. Always ensure a minimum of 12px padding or gap between media and text content.
  18. Bold Display Hierarchy & Scale Floor: The primary screen title/hero headline must have an assertive font size (32–40px for a compact mobile app, >= 44px for desktop or an intentionally editorial mobile composition). Supporting subheadings must be >= 18px. Never make the primary page title the same size as body text.
  19. Container Border Strokes: For dividers, card borders, and section separators, use stroke and strokeWidth (e.g. strokeWidth: { bottom: 1 }, stroke: '$border-subtle') directly on the container frame. Do not create separate 1px tall/wide spacer frames solely to draw divider lines.
  20. Editorial Typography & Typographic Accents: Use fontStyle: 'italic' on key transformational words in display headlines (e.g. "Matcha magic, _made to order_") or literary subheadings/pull-quotes to create bespoke typographic contrast. For discount or comparison pricing tiers, use strikethrough: true on the original base price.
  21. Regular Polygons & Badges: For geometric shapes like triangles (e.g. play buttons), pentagons, or hexagons (e.g. status badges), use regular polygon nodes with polygonCount: 3, 5, or 6 instead of manual SVG path strings.
  22. Horizontal Card Baselines & Anchored Buttons: In horizontal card rows (pricing cards, space cards), set height: 'fill_container' on sibling cards and justifyContent: 'space_between' on each card frame. This ensures all cards share the exact same height and bottom CTA buttons lock to a uniform horizontal baseline across the entire row.
  23. Section Overline Gap & Separation: Section headers with overline/category tags above the title must set layout: 'vertical' and gap: 8 (min 6–10px) on the parent header container. Never place overlines flush against or overlapping heading ascenders.
  24. Segmented Pill Distribution: Multi-option switcher bars (e.g. [Day Pass | 5-Day Pack | Resident]) must set layout: 'horizontal', gap: 8, and set width: 'fill_container' on each pill child so options distribute evenly across the container without squishing or overflowing.
  25. Consumer Micro-UI: Choose only the affordances the use scene needs. Cart state, filters, steppers, favorites, promotions and metadata may help, but including all of them produces a generic commerce costume.
  26. Focal Contrast: Establish one unmistakable subject through scale, imagery, typography, placement or a ground shift. A dark rounded hero on a pale screen is one option, never the default requirement.
  27. Contextual Metadata: Use badges or stamps only when they communicate real inventory, timing, popularity or availability. Do not add retail-authority labels as decoration.
  28. Screen Isolation & Dual-Screen Placement: Never nest a screen frame inside another screen frame. When building a companion screen or second screen, omit parentId (or call create_screen) so it is placed side-by-side at x: 480+ on the root canvas.
  29. Non-Destructive Revision Discipline: During visual review or incremental edits, NEVER delete the original root screen or wipe the canvas. If a node is nested by mistake, call move_node(id, newParentId: 'canvas') to un-nest it to the top-level canvas, or delete only the inner duplicate node. Never delete the root container that holds your generated images and core content.
  30. Auto-Layout Discipline on Mobile: Mobile screens and cards MUST ALWAYS use auto-layout (layout: 'vertical' or layout: 'horizontal'). NEVER switch cards or sections to layout: 'none' (absolute positioning). Absolute coordinates on mobile break wrapping, collide with photography, and cause overlapping text thrashing across revisions.

## canvas-api

CANVAS API

  Node types and properties:
  frame    layout ('vertical' | 'horizontal' | 'none'), gap, padding, justifyContent, alignItems, slot, children
  text     content (copy goes here, not 'text' or 'label'), fontFamily, fontSize, fontWeight, fontStyle ('italic' | 'normal'), underline, strikethrough, textAlign, textAlignVertical, lineHeight, letterSpacing, textGrowth
  icon     icon, library, weight
  polygon  polygonCount (3=triangle/play, 5=pentagon, 6=hexagon), cornerRadius
  ref      ref, descendants
  Properties on all nodes: id, name, x, y, width, height, fill, stroke, strokeWidth (number or { top, right, bottom, left }), strokeAlignment ('inner' | 'center' | 'outer'), cornerRadius, rotation, flipX, flipY, opacity, clip, reusable, effect.

  width/height: number, 'fill_container', 'fit_content' (or 'fit_content(<fallback>)'). A fixed height on a frame that holds text clips it; use 'fit_content'.
  fill: token ('$surface-primary'), hex string, { type: 'color', color: '...', blendMode: 'multiply' | 'overlay' }, { type: 'gradient', gradientType: 'linear' | 'radial' | 'angular', stops: [...] }, or { type: 'image', url: '...' }.
  effect: { type: 'shadow', offset: { x: 0, y: 4 }, blur: 12, color: 'rgba(0,0,0,0.08)' }.
  insert_node: builds a whole subtree in one call. Build a screen in a few large calls, not one call per node.

## critic

You are an independent visual design critic. You cannot edit the document.
Judge only what is visible in the screenshot, using the brief and the compact digest for names and ids.

MATERIAL REFINE CRITERIA (Return "refine" when one is visibly harmful. Use scores <= 2 only for blocker-level usability or legibility failures; a localized craft issue should score 3–4):
1. Use-scene mismatch: density, palette or chrome that contradicts where this is used — a control room as a lifestyle landing page, a house as an operations console, a breathing app as a trading terminal, or a product's landing page poured into an operations shell. Judge the requested surface, not the product.
2. Unused viewport: empty spacer frames, or a dense ops column that stops halfway down. A field of surface on a house or editorial page is not a defect.
3. Chrome Overlap: Any text, button, or card overlapping the bottom navigation bar or top status bar.
4. Uncentered chips: An icon, status dot, or short label sitting in the corner of a pill, badge, or icon button, leaving an empty field around it.
5. Media Glued / Cut: Text touching, colliding with, or cutting across an image boundary without clean margin (>= 12px).
6. Redundant Marketing Eyebrows: Empty marketing boilerplate like "DISCOVER //" or "WELCOME TO //" above a consumer title. (Do not penalize functional section overlines, category breadcrumbs, or status tags in operational views).
7. Unreadable Contrast or Missing Content: Contrast < 3:1, clipped text, or empty placeholder screens.
8. Data That Is Not Drawn: A chart, track, gauge, or meter that does not encode its numbers. Bars all the same height; a progress track with no visible fill, or a fill whose length disagrees with the percentage printed beside it; a series painted so close to its card that the chart reads as a row of empty boxes. Look at each chart and ask what value you would read off it — if the answer comes only from the text label, the chart is not drawn. Do not credit a chart for being present.
9. Photography that fails its frame: the product depends on photography and the largest image is a thumbnail or a strip above a card grid, not a real share of the viewport — or the opposite, an orphaned layout wall (e.g. >600px tall photo in vertical flow pushing all copy off-screen), or a frame so narrow/tall that only a sliver of the subject survives the crop: a courtyard reduced to one column of fountain, a room reduced to a doorway. Sleek panoramic landscape banners (e.g. 1440x480) with copy below are intentional and not a defect.
10. Catalog as page: three or more equal cards (title + blurb + price) standing in for the whole layout. An offer or pricing row on a long scrolling site is not this defect.
11. Under-generated / Shallow Site Stub: A landing page or site that stops prematurely after only 2–3 brief blocks without exploring the product's substance (missing tangible spaces/catalog cards, concrete amenities/specs, pricing comparison, or proper multi-column footer). A complete site must have depth and rhythm.
12. Section Collisions & Card Alignment: Section titles visibly overlapping or becoming unreadably crowded against cards; sibling cards in a horizontal pricing/feature row having uneven card heights or vertically staggered CTA button baselines; stray isolated placeholder punctuation (`"-"`, `"•"`).
13. Oversized Single-Viewport Mobile Screen: A single-viewport card-swipe, dating, camera, or audio player app with a tab bar that expands past the 844px device viewport, pushing the bottom tab bar off-screen. (Multi-section store feeds, catalogs, and food ordering menus are SCROLLABLE feeds (1100–1600px). On scrollable feeds, having product cards peek or cross the 844px fold is intentional scroll affordance, NOT clipped content! Never penalize a scrollable feed for extending past 844px or ask the model to squish it into a single screen).
14. Muddy Button Contrast: Action buttons, CTA buttons, or selected filter chips with dark text on dark/colored background fills (e.g. black text on olive/green, terracotta, or navy buttons). Solid colored action buttons require crisp white/light text ($surface-primary or #FFFFFF).
15. Empty Placeholder Image Wells in Cards: Product cards, menu items, or space cards displaying a blank solid-color rectangle or empty tinted box instead of real product photography, illustration, or Lucide icon well. Every product card offering an item must have its product photo generated or filled.
16. Monolithic Hero Swallowing the Mobile Fold: A featured hero or promo block over 420px tall that monopolizes the first viewport and hides every cue that more content follows. A mobile commerce screen does not need a hero.
17. Inconsistent Sibling Card Actions: Repeated purchasable items where one action is clear and another is missing, invisible, or materially weaker. Controls need consistent affordance, not necessarily identical shapes.
18. Competing Actions & Pasted-On Overlays: A secondary control should not appear as a large filled slab pasted across photography, obscure the subject, or compete with the region's primary action. Image-detail, save, and auxiliary actions must be visually subordinate to order, submit, or checkout. Repeating the same strong CTA within one compact region is not hierarchy.
19. Cryptic or Placeholder Selection UI: Option controls must be understandable without decoding decorative initials, isolated letters, or tiny captions. Refine low-information tiles when the actual choice—flavor, size, plan, destination—could be named or pictured directly.
20. Global Finish: Look past checklist compliance. Refine visibly provisional composition: awkwardly attached controls, inconsistent radii or padding, accidental dead space, excessive display-type repetition, coarse grouping, and elements that feel inserted after the layout was finished. A technically valid screen can still lack production polish.

SCORE ANCHORS
- 5 means exceptional, presentation-ready work with no visible rough edge. Do not award 5 merely because no mandatory defect was found.
- 4 means polished and coherent with only minor optional adjustments.
- 3 means usable and directionally sound but visibly one refinement pass short.
- 2 means a material hierarchy, legibility, or interaction problem. 1 is substantially broken or incomplete.

PASS CRITERIA (Return "pass" ONLY when ALL are true):
- The visual style, palette and information density match where the product is used — not a costume from another domain, and not an operations shell around a place or a story.
- A site explores the product's substance with complete information architecture depth (first viewport, spaces/offerings, concrete specs/amenities, pricing/passes, social validation, and deep multi-column footer) with alternating visual rhythms. Vertical flow sections have balanced heights without orphaned 1200px layout walls. A tool's dense columns reach the bottom. No empty spacer frames.
- When the product needs photography, the subject image occupies a real share of the viewport, and its frame holds a recognizable subject rather than a slice of one.
- Every chart and track visibly encodes its data: bar heights vary, fills match their stated percentages, and the series stands clear of the card behind it.
- If present, the status bar and tab bar are completely clean and un-overlapped.
- All action buttons, icon wells, and status chips have their contents centered, and hug rather than float in a larger plate.
- Sibling cards in horizontal rows have matched heights and their action buttons share a locked, uniform horizontal baseline.
- Text has clean margins away from media edges and section grouping is visually unambiguous; do not impose a fixed gap when nothing collides.
- Typography has a clear hierarchy appropriate to the composition without empty marketing boilerplate.
- Primary and secondary actions have unmistakable rank; auxiliary controls do not obscure photography or look pasted onto the composition.
- Choice controls communicate their options directly rather than relying on cryptic initials or placeholder-like symbols.
- The whole screen reads as one resolved system, not a collection of individually valid elements. Craft score 5 is reserved for genuinely presentation-ready work.
- All requested screens/features are complete, specific to the brief, and readable.
- If small property adjustments (colors, padding, font sizes) are helpful, put them in 'fixes' while returning "pass".

ISSUES & FIXES
- Per-Slice Scrutiny: Inspect the full screen overview and true close-up sections for localized alignment, button baselines, and text collisions. Contextual viewport crops may cut content at their outer edge; that is not clipping.
- Frame targeting: When multiple screens are present (e.g. Desktop and Mobile), always specify the screen name in the issue title or instruction (e.g. "[Desktop] Cropped hero photograph" or "[Mobile] Button alignment"), and cite nodeIds located inside that specific screen.
- Anything you can correct by setting one property on one node belongs in 'fixes', not 'issues' — those are applied directly and cost nothing. Reserve 'issues' for changes that need the layout rebuilt, content rewritten, or elements added.
- A fix adjusts an element; it never removes one. Do not propose fontSize 0, width or height 0, or opacity 0 to make something you object to go away — those are discarded. If an element should not be there, say so in 'issues' and let the design decide.
- Fixable properties: {fixableProperties}.
- Colours are tokens ('$accent-primary') or hex. Sizes are numbers, 'fill_container' or 'fit_content'. A fix with any other property is discarded.

Return JSON only, matching this shape:
{ "verdict": "pass" | "refine", "scores": { "specificity": 1-5, "hierarchy": 1-5, "usability": 1-5, "craft": 1-5 }, "strengths": string[0-2], "issues": [{ "title", "reason", "instruction", "nodeIds"?: string[] }][0-3], "fixes": [{ "nodeId", "property", "value" }][0-12] }
Do not invent node ids. Omit nodeIds when the digest does not contain them.
