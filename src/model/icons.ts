/**
 * Lucide icon lookup.
 *
 * The browser has the small core map below and nothing else; insert_icon stores
 * geometry on the node, so an arbitrary icon still paints without bundling the
 * catalog. Anything running outside the browser registers the full catalog —
 * see iconCatalog.ts.
 */

const iconPathCache = new Map<string, string>();
let cachedIconNames: string[] | null = null;

/** Resolves any installed Lucide icon. Supplied by whoever can read the package. */
export interface IconCatalog {
  /** Every name this catalog can resolve. */
  names(): string[];
  /** Path geometry for one name, or undefined when the catalog has no such icon. */
  path(name: string): string | undefined;
}

/**
 * The full catalog, registered by whoever can supply it.
 *
 * This used to reach into node_modules through `require`, which is a different
 * answer in every place the code runs: present under Bun, absent in the Vite
 * dev middleware that actually serves the agent, absent in the browser. The
 * middleware quietly fell back to the 28-icon core map below, so search_icons
 * answered "no such icon" for info, bookmark and calendar while insert_icon
 * refused `clock` — and the tests stayed green, because tests run under Bun
 * where `require` exists. A registry has no environment to guess at: the server
 * registers a catalog, the browser does not, and both take the same path here.
 */
let registry: IconCatalog | null = null;

export function registerIconCatalog(catalog: IconCatalog): void {
  registry = catalog;
  cachedIconNames = null;
  iconPathCache.clear();
}

/**
 * True when the full catalog is loaded. A caller that promises the model an
 * icon will paint needs to tell "this name is wrong" from "this process can
 * only see twenty-eight names".
 */
export function iconCatalogAvailable(): boolean {
  return registry !== null;
}

export function elementToPath(tag: string, attrs: Record<string, any>): string {
  if (tag === "path") {
    let d = (attrs.d || "").trim();
    if (d.startsWith("m")) {
      d = "M" + d.slice(1);
    }
    return d;
  }
  if (tag === "circle") {
    const r = Number(attrs.r || 0);
    return elementToPath("ellipse", { ...attrs, rx: r, ry: r });
  }
  if (tag === "ellipse") {
    const cx = Number(attrs.cx || 0);
    const cy = Number(attrs.cy || 0);
    const rx = Number(attrs.rx || 0);
    const ry = Number(attrs.ry || 0);
    return `M ${cx - rx},${cy} a ${rx},${ry} 0 1,0 ${rx * 2},0 a ${rx},${ry} 0 1,0 ${-rx * 2},0`;
  }
  if (tag === "line") {
    return `M ${attrs.x1},${attrs.y1} L ${attrs.x2},${attrs.y2}`;
  }
  if (tag === "rect") {
    const x = Number(attrs.x || 0);
    const y = Number(attrs.y || 0);
    const w = Number(attrs.width || 0);
    const h = Number(attrs.height || 0);
    const rx = Number(attrs.rx || 0);
    if (rx > 0) {
      return `M ${x + rx},${y} h ${w - 2 * rx} a ${rx},${rx} 0 0 1 ${rx},${rx} v ${h - 2 * rx} a ${rx},${rx} 0 0 1 -${rx},${rx} h -${w - 2 * rx} a ${rx},${rx} 0 0 1 -${rx},${rx} v -${h - 2 * rx} a ${rx},${rx} 0 0 1 ${rx},${rx} z`;
    }
    return `M ${x},${y} h ${w} v ${h} h -${w} Z`;
  }
  if (tag === "polyline" || tag === "polygon") {
    const pts = (attrs.points || "").trim().split(/\s+/);
    if (pts.length > 0) {
      return `M ${pts[0]} ` + pts.slice(1).map((p: string) => `L ${p}`).join(" ") + (tag === "polygon" ? " Z" : "");
    }
  }
  return "";
}

// Built-in core fast icons for instant synchronous rendering
const CORE_ICONS: Record<string, string> = {
  heart: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5",
  star: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
  send: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z M21.854 2.147l-10.94 10.939",
  x: "M18 6 6 18 M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  search: "M21 21l-4.3-4.3 M3 11a8 8 0 1 0 16 0 8 8 0 1 0 -16 0",
  "rotate-ccw": "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5",
  "shield-check": "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z M9 12l2 2 4-4",
  sparkles: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z M20 2v4 M22 4h-4 M2 20a2 2 0 1 0 4 0 2 2 0 1 0 -4 0",
  flame: "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4",
  "map-pin": "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0 M9 10a3 3 0 1 0 6 0 3 3 0 1 0 -6 0",
  "message-circle": "M7.9 20A9 9 0 1 0 4 16.1L2 22z",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2 M8 7a4 4 0 1 0 8 0 4 4 0 1 0 -8 0",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M5 7a4 4 0 1 0 8 0 4 4 0 1 0 -8 0 M19 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  compass: "M2 12a10 10 0 1 0 20 0 10 10 0 1 0 -20 0 M16.24 7.76l-4 8a1 1 0 0 1-.49.49l-8 4a.5.5 0 0 1-.67-.67l4-8a1 1 0 0 1 .49-.49l8-4a.5.5 0 0 1 .67.67z",
  award: "M15.477 12.89l1.515 8.526a.5.5 0 0 1-.739.522l-4.253-2.236-4.253 2.236a.5.5 0 0 1-.739-.522l1.515-8.526 M4 8a8 8 0 1 0 16 0 8 8 0 1 0 -16 0",
  trophy: "M6 9H4.5a2.5 2.5 0 0 1 0-5H6 M18 9h1.5a2.5 2.5 0 0 0 0-5H18 M4 22h16 M10 14.66V17c0 .55-.45 1-1 1H7c-.55 0-1 .45-1 1v1c0 .55.45 1 1 1h10c.55 0 1-.45 1-1v-1c0-.55-.45-1-1-1h-2c-.55 0-1-.45-1-1v-2.34 M6 4h12v5a6 6 0 0 1-12 0Z",
  bell: "M10.268 21a2 2 0 0 0 3.464 0 M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
  camera: "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z M9 13a3 3 0 1 0 6 0 3 3 0 1 0 -6 0",
  image: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M7 9a2 2 0 1 0 4 0 2 2 0 1 0 -4 0 M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
  "share-2": "M15 5a3 3 0 1 0 6 0 3 3 0 1 0 -6 0 M3 12a3 3 0 1 0 6 0 3 3 0 1 0 -6 0 M15 19a3 3 0 1 0 6 0 3 3 0 1 0 -6 0 M8.59 13.51l6.83 3.98 M15.41 6.51l-6.82 3.98",
  home: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8 M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  zap: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
  "trash-2": "M3 6h18 M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6 M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2 M10 11v6 M14 11v6",
  "sliders-horizontal": "M21 4h-7 M10 4H3 M21 12h-9 M8 12H3 M21 20h-5 M12 20H3 M14 2v4 M8 10v4 M16 18v4",
  "chevron-right": "M9 18l6-6-6-6",
  "arrow-right": "M5 12h14 M12 5l7 7-7 7",
  plus: "M5 12h14 M12 5v14",
  minus: "M5 12h14",
  signal: "M2 20h.01 M7 20v-4 M12 20v-8 M17 20V8 M22 4v16",
  wifi: "M12 20h.01 M2 8.82a15 15 0 0 1 20 0 M5 12.859a10 10 0 0 1 14 0 M8.5 16.429a5 5 0 0 1 7 0",
  "battery-full": "M10 10v4 M14 10v4 M22 14v-4 M6 10v4 M4 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2H4a2 2 0 0 1 -2 -2V8a2 2 0 0 1 2 -2z"
};

/** Geometry for one icon name, from the core map or the registered catalog. */
export function getLucideIconPath(name: string): string | undefined {
  if (!name) return undefined;
  const normalized = name.toLowerCase().trim().replace(/_/g, "-");

  if (iconPathCache.has(normalized)) {
    return iconPathCache.get(normalized);
  }

  if (CORE_ICONS[normalized]) {
    iconPathCache.set(normalized, CORE_ICONS[normalized]);
    return CORE_ICONS[normalized];
  }

  const registered = registry?.path(normalized);
  if (registered) {
    iconPathCache.set(normalized, registered);
    return registered;
  }

  return undefined;
}

/** Every name that can be resolved here: the whole catalog, or the core map. */
export function getAllLucideIconNames(): string[] {
  if (cachedIconNames) return cachedIconNames;
  cachedIconNames = registry ? registry.names() : Object.keys(CORE_ICONS);
  return cachedIconNames;
}

/** Fuzzy search across every installed Lucide icon. */
export function searchLucideIcons(query: string, limit = 20): string[] {
  const all = getAllLucideIconNames();
  if (!query) return all.slice(0, limit);

  // Matched per word, not as one string. Icon names are hyphenated and queries
  // are written the way a person speaks: "cat paw" found nothing while both cat
  // and paw-print were installed, and "message circle" found nothing while
  // message-circle was the icon being described. Every multi-word query failed,
  // and the model answered a wrong "no such icon" by settling for a worse one.
  const q = query.toLowerCase().trim().replace(/[_\s]+/g, "-");
  const words = q.split("-").filter(Boolean);
  if (words.length === 0) return all.slice(0, limit);

  const scored = all
    .map((name) => {
      const parts = name.split("-");
      let score = 0;
      if (name === q) score = 1000;
      else if (name.startsWith(q)) score = 500;
      else if (name.includes(q)) score = 400;
      for (const word of words) {
        if (parts.includes(word)) score += 100;
        else if (parts.some((part) => part.startsWith(word))) score += 40;
        else if (name.includes(word)) score += 10;
      }
      // Among equal matches prefer the plainer name: a query for "cat" wants
      // cat, not chart-scatter.
      return { name, score: score > 0 ? score - Math.min(parts.length, 9) : 0 };
    })
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((entry) => entry.name);
}
