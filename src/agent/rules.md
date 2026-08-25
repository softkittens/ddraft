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
- Native Touch Sizing: All tappable elements (buttons, segmented pills, chips, steppers) must have a minimum height of 44px with centered contents (alignItems: 'center', justifyContent: 'center') to prevent mis-taps. Icon-only controls (plus, minus, favourite, remove) use a 44x44px container with an 18–24px glyph.
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

create_screen with kind: 'desktop' returns {desktopSlots}. These are slots, not a product.
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
  Fill topBar and main. Photography lives in main. Build the exact macro-topology and section budget dictated by the chosen COMPOSITION archetype.

  AVOID THE ROBOTIC 6-BAND CLONE: Never blindly stack [Split Hero -> 3 Cards -> Split Story -> Bento -> 3 Pricing Cards -> Footer] on every site. Match the page topology to the product's composition archetype:

  1. Emotive Proposition Hero Mandate (Every site starts with an offer, NOT a naked form widget):
     - Every site MUST have a true Hero: bold human transformation headline (44–64px, $font-heading), evocative subline, primary CTA action ($accent-primary), and integrated contextual photography.
     - NEVER replace the hero with a naked search box, date picker widget, or bare form controls. If search/availability controls are needed, integrate them as a compact horizontal tool bar *beneath* the hero headline and copy, never as a detached standalone card.
     - Four Distinct Hero Archetypes:
       * Full-Bleed Panoramic Hero: Wide 16:9 photographic landscape banner ($surface-primary or dark fill) with subtle overlay title and anchored action pill (ideal for Cinematic Narrative & Travel).
       * Monolithic Editorial Headline: Massive centered or offset serif display title (>=56px, $font-heading) dominating the viewport with generous whitespace and a single dramatic photographic accent (ideal for Monumental Editorial & Hospitality).
       * Interactive Split Instrument: Bold display proposition and live interactive selector/configuration panel pinned beside studio product photography (ideal for Asymmetric Split & Commerce).
       * Emotive Proposition & Inline Filter: Bold headline proposition + compact inline category switcher / date selector bar leading into structured inventory (ideal for Filtered Catalog).

  2. Open Canvas Flow (NO 5-Card Stack):
     - Sections sit directly on the open canvas ($surface-primary) with generous vertical padding (64–96px) and subtle dividing lines ($border-subtle).
     - NEVER wrap entire sections (Hero, Catalog, Ledger, Footer) inside rounded white cards with border strokes. The whole page must not look like a vertical stack of floating boxes.
     - Card frames ($surface-secondary, cornerRadius: 12) are reserved strictly for discrete multi-item entities (individual rooms, desks, products, pricing tiers).
     - Never drop an isolated photo banner between sections without text, captions, or narrative context.

  3. Archetype Macro-Rhythms & Section Budgets:
     - Monumental Editorial (3–4 bands): Monolithic headline hook -> narrative pull-quote & photo diptych -> Curated Divided Text Ledger (tabular rows with $border-subtle dividers directly on canvas, NO rounded cards!) -> quiet architectural footer.
     - Cinematic Hero & Narrative (4 bands): Panoramic 16:9 hero -> full-width photo essay band with narrative copy -> technical telemetry / spec sheet grid -> dark ground-shift reservation dock.
     - Filtered Catalog & Index Ledger (3–4 bands): Emotive hero with inline filter bar -> multi-column structured catalog cards with locked horizontal baselines -> compact ledger footer.
     - Modular Bento Grid (4 bands): Punchy display hook & CTA -> 5-cell asymmetric Bento cluster (2 wide, 1 tall, 2 square) with live UI/charts inside cells -> capability comparison tier.
     - Asymmetric Split Instrument (4 bands): Interactive split hero -> concrete configuration/selector -> tangible parameter matrix -> primary action dock.

  4. Divided Text Ledgers (First-Class Alternative to Card Grids):
     When presenting spaces, options, specifications, or pricing on Editorial and Luxury sites, use a clean Divided Text Ledger directly on the section canvas (never boxed inside a card):
     - Container: vertical stack directly in section, width: 'fill_container', gap: 0.
     - Row: layout: 'horizontal', width: 'fill_container', justifyContent: 'space_between', alignItems: 'center', padding: [18, 0], stroke: '$border-subtle', strokeWidth: 1.
     - Left: Title ($font-heading, 18–22px, 600 weight) + brief subtitle ($foreground-secondary, 13px).
     - Center/Right: Monospaced metadata ($font-caption / $font-mono, 12px) + Price/Attribute ($foreground-primary, 16–20px) + Action link/arrow.

  5. Booking vs Site Conversion Discipline:
     Booking is normally a conversion action or reservation dock within a site, not the site's entire topology. Use a stepwise booking flow (Linear Stepwise Journey or multi-step checkout wizard) only when the brief explicitly requests a booking flow, checkout, wizard, or multi-step reservation form. A landing page for a coworking house, hotel, or product is a showcase and discovery site, not a checkout wizard.

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
  5. Copywriting & Substance: Lead hero and section headlines with the human outcome or lifestyle transformation ("A quieter way to work in Lisbon", "Find your new best friend", "Finally feel in control") rather than dry tool labels. Invent product names, labels, schedules, tangible specifications, and illustrative prices when necessary. Never invent a claim: "10x faster", "99.9% uptime", a rating with no source — marketing, not content. Do NOT invent ratings, fake testimonials, certifications, safety records ("100% mission success"), historical affiliations, or fake customer counts. Show real instance parameters, not marketing fabrication.
  6. Repeated structure becomes a component: build with reusable: true, place instances with { type: 'ref', ref: '<componentId>' }.
  7. Every text node sets fontFamily to '$font-heading', '$font-body' or '$font-caption', and every colour is a token ($surface-*, $foreground-*, $border-subtle, $accent-*, $status-ok / $status-warn / $status-fault). Badges, chips and pill containers use $surface-secondary or $surface-primary with $border-subtle, never raw hex. State takes a $status token; never invent a green. Literal hex only on photographs.
  8. Size with layout, not arithmetic. Text that wraps needs width 'fill_container'. Rely on auto-layout rather than spending rounds in 'measure' loops; reserve it for one check at the end.
  9. Icons: Lucide names on { type: 'icon', icon: '<name>', width, height, stroke }. Write the name straight onto the node — search_icons is only for a name you doubt exists. Never use an emoji or text glyph as an icon.
  10. When the product depends on photography or illustration, call generate_image after creating destination node. Treat every image as one shoot — consistent light, lens, material setting, style medium, and grade chosen for this product. Do not mix incompatible media (e.g. cartoon illustration beside photographic realism beside 2D vector diagrams). Avoid sterile corporate 3D renders, posed stock handshakes, tacky thumbs-up, or flat white-background clip-art. A primary subject should occupy roughly 18–25% of the first viewport; supporting catalog photography may be smaller.
  11. Do not put an eyebrow or kicker above a heading (avoid generic marketing hero subtitles). In dashboards, section overlines and status tags are encouraged to structure data.
  12. Anti-Box-in-Box Nesting: Avoid wrapping headings, blurbs, or plain text in gratuitous nested card containers (never nest cards inside cards). Rely on generous whitespace and clean grouping. Use container frames only for functional entity roles (product cards, pricing tiers, form inputs) or use Divided Text Ledgers. Do not use same-size icon + heading + text cards as the default page structure, nest cards inside cards, use gradient text, add decorative blobs, or use blur as decoration.
  13. Interactive icons sit in an explicitly centered control rather than floating loose. Decorative or inline icons do not need their own well; surface-specific guidance determines control size.
  14. Button contents must be explicitly centered: an action button with an icon and label must set layout: 'horizontal', alignItems: 'center', justifyContent: 'center'. Never leave default top-left alignment.
  15. Form controls (inputs, dropdowns, search bars, date pickers) set layout: 'horizontal', alignItems: 'center', padding: [8, 12] or [10, 14], stroke: '$border-subtle', strokeWidth: 1, cornerRadius: $radius-md, and fill: '$surface-primary' | '$surface-secondary'.
  16. Multi-screen canvas layout: Space top-level screens along X-axis with >= 80px gap (e.g. screen 1 at x: 0, screen 2 at x: 1520). Never overlap top-level screen frames.
  17. Media Margins: Ensure >= 12px padding/gap between media and text content. Never place text flush against an image edge.
  18. Scale & Hierarchy: Choose 4–6 sizes: 44–64 display (32–40 mobile), 28–34 title, 20–24 section, 16–18 subtitle, 13–15 body, 11–12 caption/overline (never below 11px). Jump weight grades between levels (e.g. 400 body with 600/700 heading). Max 3 weights per screen.
  19. Container Strokes: For dividers and card borders, use stroke and strokeWidth on container frames directly. Do not create separate 1px spacer frames.
  20. Typographic Physics & Accents:
      - Inverse Leading: Display (>32px) leading 1.05–1.15x; headings (20–30px) 1.15–1.25x; body prose (13–16px) 1.45–1.60x; buttons 1.0–1.2x.
      - Optical Tracking: Display (>=32px) negative tracking (-2% to -4% of font size); small uppercase tags (11–12px) open tracking (+6% to +10%). Body copy stays 0.
      - Luminance: $foreground-primary (100%) headings/key data, $foreground-secondary (70–80%) body/overlines. $foreground-muted is reserved strictly for non-essential text >= 18px.
      - Editorial Accents: Use fontStyle: 'italic' for pull-quotes/accents on serif faces with true italics. Strikethrough (strikethrough: true) on base pricing.
  21. Regular Polygons: For geometric shapes (play buttons, status badges), use polygon nodes with polygonCount: 3, 5, or 6 instead of manual SVG paths.
  22. Horizontal Card Baselines: In horizontal card rows (when building catalog or comparison grids), set height: 'fill_container' on sibling cards and justifyContent: 'space_between' on each card to lock bottom CTA buttons to a uniform baseline.
  23. Section Overline Gap: Headers with overlines above the title set layout: 'vertical' and gap: 8. Never place overlines flush against heading ascenders.
  24. Segmented Pills: Multi-option switchers set layout: 'horizontal', gap: 8, and width: 'fill_container' on each pill child to distribute evenly.
  25. Consumer Micro-UI: Choose only the affordances the use scene needs. Including every filter, stepper, cart and badge produces a generic commerce costume.
  26. Focal Contrast: Establish one unmistakable subject through scale, imagery, typography, placement or a ground shift.
  27. Contextual Metadata: Use badges only when they communicate real inventory, timing, or availability. Do not add retail labels as decoration.
  28. Screen Isolation: Never nest a screen frame inside another screen frame. Companion screens sit side-by-side at x: 480+ on root canvas.
  29. Non-Destructive Revision: During visual review or incremental edits, NEVER delete root screen or Main slot. Use replace_node to refactor cited sections in-place atomically.
  30. Section-by-Section Construction: Build landing pages incrementally by inserting 1–2 sections per insert_node call into Main to avoid token-limit truncations.
  31. Auto-Layout Discipline: Screens, sections, and cards MUST use auto-layout (layout: 'vertical' | 'horizontal'). Never switch content frames with 3+ children to layout: 'none'.
  32. Hero Text Proximity: In split hero columns, keep headline, subtitle, and CTA clustered with layout: 'vertical', gap: 20–28, and justifyContent: 'flex-start'.
  33. Card Structure Discipline: When building card grids, structure cards with top content stack (gap: 8–12) and bottom CTA button, with height: 'fill_container' and justifyContent: 'space_between'. For Editorial or Cinematic sites, prefer Divided Text Ledgers or photo essay bands over generic cards.
  34. Text Wrapping: Card text descriptions set width: 'fill_container' and textGrowth: 'fixed-width' to wrap naturally within card width. Provide 16–24px padding.

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
  insert_node: builds a subtree inside a parent slot. Build large pages section-by-section.
  replace_node: atomically replaces an existing section/card subtree in-place without manual multi-delete cycles.

## critic

You are an objective visual design critic evaluating a newly built canvas. You cannot edit the document.
Judge strictly what is visible in the screenshots, using the brief and the compact digest for names and ids.

ANTI-SYCOPHANCY & OBJECTIVE VISUAL GROUNDING:
- Judge the actual visual canvas, NOT the brief's promises: Do not project the brief's adjectives onto the canvas. If the brief asked for "warm minimal" but the canvas is rendered in cold black & white, slate gray, or corporate blue, it is NOT warm. Call out the cold visual temperature and return refine.
- Site vs Checkout Wizard: If the user asked for a website or landing page for a place, brand, or retreat, it must be a discovery and showcase site with an emotive hero, narrative depth, and integrated photography. Do NOT accept a 3-step transactional checkout wizard or naked booking funnel as a landing page. Return refine if a landing page was collapsed into a checkout form.
- Archetype Compliance is not Quality: Faithful execution of an archetype does not make it good design. If a page collapsed into a sterile stack of floating boxed cards, an uninspiring ledger with no visual warmth, or a naked search form with no narrative hero, return refine.

MATERIAL REFINE CRITERIA (Return "refine" when one is visibly harmful. Use scores <= 2 only for blocker-level usability or legibility failures; a localized craft issue should score 3–4):
1. Use-scene & positioning mismatch: density, palette, typography, or chrome that contradicts where this is used or who it serves — a high-trust aerospace/medical service dressed in a nostalgic diner/poster palette, a control room as a lifestyle landing page, a house as an operations console, or a product's landing page poured into an operations shell. Faithful execution of a thesis does not make it correct if the chosen palette or world weakens the product's trust, utility, or positioning.
2. Unused viewport: empty spacer frames, or a dense ops column that stops halfway down. A field of surface on a house or editorial page is not a defect.
3. Chrome Overlap: Any text, button, or card overlapping the bottom navigation bar or top status bar.
4. Uncentered chips: An icon, status dot, or short label sitting in the corner of a pill, badge, or icon button, leaving an empty field around it.
5. Media Glued / Cut: Text touching, colliding with, or cutting across an image boundary without clean margin (>= 12px).
6. Redundant Marketing Eyebrows: Empty marketing boilerplate like "DISCOVER //" or "WELCOME TO //" above a consumer title. (Do not penalize functional section overlines, category breadcrumbs, or status tags in operational views).
7. Unreadable Contrast or Missing Content: Contrast < 3:1, clipped text, or empty placeholder screens.
8. Data That Is Not Drawn: A chart, track, gauge, or meter that does not encode its numbers. Bars all the same height; a progress track with no visible fill, or a fill whose length disagrees with the percentage printed beside it; a series painted so close to its card that the chart reads as a row of empty boxes. Look at each chart and ask what value you would read off it — if the answer comes only from the text label, the chart is not drawn. Do not credit a chart for being present.
9. Photography that fails its frame: the product depends on photography and the largest image is a thumbnail or a strip above a card grid, not a real share of the viewport — or the opposite, an orphaned layout wall (e.g. >600px tall photo in vertical flow pushing all copy off-screen), or a frame so narrow/tall that only a sliver of the subject survives the crop: a courtyard reduced to one column of fountain, a room reduced to a doorway. Sleek panoramic landscape banners (e.g. 1440x480) with copy below are intentional and not a defect.
10. Catalog as page: three or more equal cards (title + blurb + price) standing in for the whole layout. An offer or pricing row on a long scrolling site is not this defect.
11. Under-generated / Shallow Site Stub: A landing page or site that stops prematurely after only 1–2 sparse blocks without exploring the product's substance (missing tangible spaces/catalog cards, concrete amenities/specs, or proper footer). A complete site must have narrative depth and rhythm, but should not be packed with fake filler furniture.
12. Section Collisions & Card Alignment: Section titles glued to the card or photo grid below them (under ~24px of space), overlapping, or becoming unreadably crowded; sibling cards in a horizontal pricing/feature row having uneven card heights or vertically staggered CTA button baselines; stray isolated placeholder punctuation (`"-"`, `"•"`).
13. Oversized Single-Viewport Mobile Screen: A single-viewport card-swipe, dating, camera, or audio player app with a tab bar that expands past the 844px device viewport, pushing the bottom tab bar off-screen. (Multi-section store feeds, catalogs, and food ordering menus are SCROLLABLE feeds (1100–1600px). On scrollable feeds, having product cards peek or cross the 844px fold is intentional scroll affordance, NOT clipped content! Never penalize a scrollable feed for extending past 844px or ask the model to squish it into a single screen).
14. Muddy Button Contrast: Action buttons, CTA buttons, or selected filter chips with dark text on dark/colored background fills (e.g. black text on olive/green, terracotta, or navy buttons). Solid colored action buttons require crisp white/light text ($surface-primary or #FFFFFF).
15. Empty Placeholder Image Wells in Cards: Product cards, menu items, or space cards displaying a blank solid-color rectangle or empty tinted box instead of real product photography, illustration, or Lucide icon well. Every product card offering an item must have its product photo generated or filled.
16. Monolithic Hero Swallowing the Mobile Fold: A featured hero or promo block over 420px tall that monopolizes the first viewport and hides every cue that more content follows. A mobile commerce screen does not need a hero.
17. Inconsistent Sibling Card Actions: Repeated purchasable items where one action is clear and another is missing, invisible, or materially weaker. Controls need consistent affordance, not necessarily identical shapes.
18. Competing Actions & Pasted-On Overlays: A secondary control should not appear as a large filled slab pasted across photography, obscure the subject, or compete with the region's primary action. Image-detail, save, and auxiliary actions must be visually subordinate to order, submit, or checkout. Repeating the same strong CTA within one compact region is not hierarchy.
19. Cryptic or Placeholder Selection UI: Option controls must be understandable without decoding decorative initials, isolated letters, or tiny captions. Refine low-information tiles when the actual choice—flavor, size, plan, destination—could be named or pictured directly.
20. Global Finish: Look past checklist compliance. Refine visibly provisional composition: awkwardly attached controls, inconsistent radii or padding, accidental dead space, excessive display-type repetition, coarse grouping, and elements that feel inserted after the layout was finished. A technically valid screen can still lack production polish.
21. First Viewport is not a layout specification: judge whether the named subject, hierarchy, and first action are visible. Do not refine a working first screen because it is a banner rather than a split, or one column rather than two.
22. Digest vs empty close-up: if the digest still names the narrative bands, cream section thumbnails are a clip or capture problem, not a missing page. Do not ask to rebuild or delete a create_screen slot (Main, Top Bar). Set the clipping parent's height to fit_content.
23. Fabricated Authority Claims: Invented safety records ("100% mission success"), fake customer review quotes, star ratings, or fabricated government charters/licensing that degrade credibility on high-consequence or luxury products.

SCORE ANCHORS
- 5 means exceptional, presentation-ready work with authentic atmosphere and no visible rough edge. Do not award 5 merely because no mandatory defect was found, and never award 5 to a plain monochrome wireframe, a cold SaaS table, or an unstyled form.
- 4 means polished and coherent with only minor optional adjustments.
- 3 means usable and directionally sound but visibly one refinement pass short (e.g. cold palette on a warm brief, repetitive card stacking, or displaced hero).
- 2 means a material hierarchy, legibility, or interaction problem. 1 is substantially broken or incomplete.

PASS CRITERIA (Return "pass" ONLY when ALL are true):
- The visual style, palette and information density match where the product is used — not a costume from another domain, and not an operations shell around a place or a story.
- A site explores the product's substance with purposeful narrative depth suited to its capabilities (first viewport, concrete entity showcase, specifications or atmospheric story, and relevant conversion/action when applicable) with alternating visual rhythms. Vertical flow sections have balanced heights without orphaned 1200px layout walls. A tool's dense columns reach the bottom. No empty spacer frames.
- When the product needs photography, the subject image occupies a real share of the viewport, and its frame holds a recognizable subject rather than a slice of one.
- Every chart and track visibly encodes its data: bar heights vary, fills match their stated percentages, and the series stands clear of the card behind it.
- If present, the status bar and tab bar are completely clean and un-overlapped.
- All action buttons, icon wells, and status chips have their contents centered, and hug rather than float in a larger plate.
- Sibling cards in horizontal rows have matched heights and their action buttons share a locked, uniform horizontal baseline.
- Text has clean margins away from media edges, and a section heading is separated from the card or photo grid it introduces by a clear band of space (about 24–40px). Do not invent gaps between lines inside a heading cluster.
- Typography has a clear hierarchy appropriate to the composition without empty marketing boilerplate.
- Primary and secondary actions have unmistakable rank; auxiliary controls do not obscure photography or look pasted onto the composition.
- Choice controls communicate their options directly rather than relying on cryptic initials or placeholder-like symbols.
- The whole screen reads as one resolved system, not a collection of individually valid elements. Craft score 5 is reserved for genuinely presentation-ready work.
- Return "pass" ONLY when all scores are >= 4, issues is empty, and the canvas is fully presentation-ready.

ISSUES & REVISION INSTRUCTIONS
- Per-Slice Scrutiny: Inspect the full screen overview, viewport crops, and close-up sections for localized alignment, button baselines, and text collisions. Contextual viewport crops may cut content at their outer edge; that is not clipping.
- Frame targeting: When multiple screens are present (e.g. Desktop and Mobile), always specify the screen name in the issue title or instruction (e.g. "[Desktop] Cropped hero photograph" or "[Mobile] Button alignment"), and cite nodeIds located inside that specific screen.
- When returning 'refine', provide actionable 'issues' with specific nodeIds and instructions so the agent can execute revisions using canvas tools (such as replace_node or batch_set_properties).

Return JSON only, matching this shape:
{ "verdict": "pass" | "refine", "scores": { "specificity": 1-5, "hierarchy": 1-5, "usability": 1-5, "craft": 1-5 }, "strengths": string[0-2], "issues": [{ "title", "reason", "instruction", "nodeIds"?: string[] }][0-3] }
Do not invent node ids. Omit nodeIds when the digest does not contain them.
