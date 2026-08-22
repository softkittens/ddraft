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

function normalizeSvgPathSegment(d: string): string {
  const trimmed = d.trim();
  if (!trimmed.startsWith("m")) return trimmed;

  const numRegex = /^[+-]?(?:\d*\.\d+|\d+)(?:[eE][+-]?\d+)?/;
  let rest = trimmed.slice(1).trim();

  const xMatch = rest.match(numRegex);
  if (!xMatch) return trimmed;
  const x = xMatch[0];
  rest = rest.slice(x.length).trim().replace(/^,/, "").trim();

  const yMatch = rest.match(numRegex);
  if (!yMatch) return trimmed;
  const y = yMatch[0];
  rest = rest.slice(y.length).trim().replace(/^,/, "").trim();

  if (!rest) {
    return `M ${x} ${y}`;
  }

  if (/^[a-zA-Z]/.test(rest)) {
    return `M ${x} ${y} ${rest}`;
  }

  return `M ${x} ${y} l ${rest}`;
}

export function elementToPath(tag: string, attrs: Record<string, any>): string {
  if (tag === "path") {
    return normalizeSvgPathSegment(attrs.d || "");
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
  heart: "M 19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
  star: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
  send: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z M 21.854 2.147 L 10.94 10.939",
  x: "M 18 6 L 6 18 M 6 6 L 18 18",
  check: "M 20 6 L 9 17 L 4 12",
  search: "M 21 21 L 16.66 16.66 M 12 3 a 8 8 0 1 0 0 16 a 8 8 0 1 0 0 -16",
  "rotate-ccw": "M 3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M 3 3v5h5",
  "shield-check": "M 20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z M 9 12 L 11 14 L 15 10",
  sparkles: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z M20 2v4 M22 4h-4 M 2,20 a 2,2 0 1,0 4,0 a 2,2 0 1,0 -4,0",
  flame: "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4",
  "map-pin": "M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0 M 9,10 a 3,3 0 1,0 6,0 a 3,3 0 1,0 -6,0",
  "message-circle": "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2 M 8,7 a 4,4 0 1,0 8,0 a 4,4 0 1,0 -8,0",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3.128a4 4 0 0 1 0 7.744 M22 21v-2a4 4 0 0 0-3-3.87 M 5,7 a 4,4 0 1,0 8,0 a 4,4 0 1,0 -8,0",
  compass: "M 12 2 a 10 10 0 1 0 0 20 a 10 10 0 1 0 0 -20 M 16.24 7.76 L 14.12 14.12 L 7.76 16.24 L 9.88 9.88 Z",
  discover: "M 12 2 a 10 10 0 1 0 0 20 a 10 10 0 1 0 0 -20 M 16.24 7.76 L 14.12 14.12 L 7.76 16.24 L 9.88 9.88 Z",
  award: "M15.477 12.89 L 17.5 21.5 L 12 17.5 L 6.5 21.5 L 8.523 12.89 M 6,8 a 6,6 0 1,0 12,0 a 6,6 0 1,0 -12,0",
  trophy: "M 6 9 H 4.5 a 2.5 2.5 0 0 1 0 -5 H 6 M 18 9 h 1.5 a 2.5 2.5 0 0 0 0 -5 H 18 M 4 22 h 16 M 10 14.66 V 17 c 0 .55 -.45 1 -1 1 H 8 v 4 h 8 v -4 h -1 c -.55 0 -1 -.45 -1 -1 v -2.34 M 18 2 H 6 v 7 a 6 6 0 0 0 12 0 V 2 Z",
  bell: "M10.268 21a2 2 0 0 0 3.464 0 M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
  camera: "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z M 9,13 a 3,3 0 1,0 6,0 a 3,3 0 1,0 -6,0",
  image: "M 5,3 h 14 a 2,2 0 0 1 2,2 v 14 a 2,2 0 0 1 -2,2 h -14 a 2,2 0 0 1 -2,2 v -14 a 2,2 0 0 1 2,2 z M 7,9 a 2,2 0 1,0 4,0 a 2,2 0 1,0 -4,0 M21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
  "share-2": "M 15,5 a 3,3 0 1,0 6,0 a 3,3 0 1,0 -6,0 M 3,12 a 3,3 0 1,0 6,0 a 3,3 0 1,0 -6,0 M 15,19 a 3,3 0 1,0 6,0 a 3,3 0 1,0 -6,0 M 8.59,13.51 L 15.42,17.49 M 15.41,6.51 L 8.59,10.49",
  home: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8 M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  house: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8 M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  zap: "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z",
  "trash-2": "M10 11v6 M14 11v6 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
  "sliders-horizontal": "M10 5H3 M12 19H3 M14 3v4 M16 17v4 M21 12h-9 M21 19h-5 M21 5h-7 M8 10v4 M8 12H3",
  "chevron-right": "M 9 18 L 15 12 L 9 6",
  "chevron-left": "M 15 18 L 9 12 L 15 6",
  "chevron-down": "M 6 9 L 12 15 L 18 9",
  "chevron-up": "M 18 15 L 12 9 L 6 15",
  "arrow-right": "M 5 12 h 14 M 12 5 L 19 12 L 12 19",
  "arrow-left": "M 19 12 H 5 M 12 19 L 5 12 L 12 5",
  plus: "M 5 12 h 14 M 12 5 v 14",
  minus: "M 5 12 h 14",
  signal: "M2 20h.01 M7 20v-4 M12 20v-8 M17 20V8 M22 4v16",
  "battery-full": "M 2 7 a 2 2 0 0 1 2-2 h 14 a 2 2 0 0 1 2 2 v 10 a 2 2 0 0 1-2 2 H 4 a 2 2 0 0 1-2-2 Z M 22 11 v 2",
  "badge-check": "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z M 9 12 l 2 2 4-4",
  calendar: "M 8 2 v 4 M 16 2 v 4 M 3 10 h 18 M 5 4 h 14 a 2 2 0 0 1 2 2 v 14 a 2 2 0 0 1 -2 2 H 5 a 2 2 0 0 1 -2 -2 V 6 a 2 2 0 0 1 2 -2 Z",
  clock: "M 12 2 a 10 10 0 1 0 0 20 a 10 10 0 1 0 0 -20 M 12 6 v 6 l 4 2",
  info: "M 12 2 a 10 10 0 1 0 0 20 a 10 10 0 1 0 0 -20 M 12 16 v -4 M 12 8 h .01",
  bookmark: "M 19 21 l -7 -4 l -7 4 V 5 a 2 2 0 0 1 2 -2 h 10 a 2 2 0 0 1 2 2 Z"
};

const ALIASES: Record<string, string> = {
  discover: "compass",
  explore: "compass",
  close: "x",
  cross: "x",
  bin: "trash-2",
  delete: "trash-2",
  profile: "user",
  person: "user",
  photo: "image",
  picture: "image",
  verified: "badge-check",
  "check-badge": "badge-check",
  checkmark: "check",
  tick: "check",
  sliders: "sliders-horizontal",
  filter: "sliders-horizontal",
  filters: "sliders-horizontal"
};

/** Geometry for one icon name, from the core map or the registered catalog. */
export function getLucideIconPath(name: string): string | undefined {
  if (!name) return undefined;
  let normalized = name.toLowerCase().trim().replace(/_/g, "-");
  if (ALIASES[normalized]) {
    normalized = ALIASES[normalized];
  }

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
