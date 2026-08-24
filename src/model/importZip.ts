import { unzipSync } from "fflate";
import type { Document, PenNode, Fill } from "./types";
import { parseDocument } from "./parse";
import { walkNodes } from "./tree";

function replaceFillUrl(fill: Fill, imageMap: Map<string, string>): Fill {
  if (typeof fill === "object" && fill !== null) {
    if (fill.type === "image") {
      const srcUrl = fill.url || (fill as any).src || (fill as any).data;
      if (typeof srcUrl === "string") {
        const clean = srcUrl.replace(/^\.\//, "").trim();
        const fileName = clean.split("/").pop() || clean;
        const matched =
          imageMap.get(srcUrl) ||
          imageMap.get(clean) ||
          imageMap.get(`./${clean}`) ||
          imageMap.get(fileName) ||
          imageMap.get(`images/${fileName}`) ||
          imageMap.get(`./images/${fileName}`) ||
          imageMap.get(`assets/${fileName}`) ||
          imageMap.get(`./assets/${fileName}`);
        if (matched) {
          return { ...fill, url: matched };
        }
      }
    }
  }
  return fill;
}

export function resolveImageUrls(doc: Document, imageMap: Map<string, string>): Document {
  if (imageMap.size === 0) return doc;
  walkNodes(doc.children, (node: PenNode) => {
    if (node.fill) {
      if (Array.isArray(node.fill)) {
        node.fill = node.fill.map((f) => replaceFillUrl(f, imageMap));
      } else {
        node.fill = replaceFillUrl(node.fill, imageMap);
      }
    }
    if (node.fills && Array.isArray(node.fills)) {
      node.fills = node.fills.map((f) => replaceFillUrl(f, imageMap));
    }
  });
  return doc;
}

export function importPenZip(buffer: Uint8Array): Document {
  const unzipped = unzipSync(buffer);

  let docEntryName: string | undefined;
  for (const name of Object.keys(unzipped)) {
    if (name.endsWith(".pen")) {
      docEntryName = name;
      break;
    }
  }
  if (!docEntryName) {
    for (const name of Object.keys(unzipped)) {
      if (name.endsWith(".json") && !name.includes("manifest") && !name.includes("package")) {
        docEntryName = name;
        break;
      }
    }
  }
  if (!docEntryName) {
    throw new Error("No .pen or .json design file found inside the .zip archive");
  }

  const docText = new TextDecoder().decode(unzipped[docEntryName]);
  const doc = parseDocument(docText);

  const imageMap = new Map<string, string>();
  for (const [filePath, data] of Object.entries(unzipped)) {
    if (filePath === docEntryName) continue;
    const lower = filePath.toLowerCase();
    let mime = "";
    if (lower.endsWith(".png")) mime = "image/png";
    else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mime = "image/jpeg";
    else if (lower.endsWith(".webp")) mime = "image/webp";
    else if (lower.endsWith(".svg")) mime = "image/svg+xml";
    else if (lower.endsWith(".gif")) mime = "image/gif";
    else if (lower.endsWith(".avif")) mime = "image/avif";

    if (mime && data.length > 0) {
      let url = "";
      if (typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        const blob = new Blob([data], { type: mime });
        url = URL.createObjectURL(blob);
      } else {
        const base64 = Buffer.from(data).toString("base64");
        url = `data:${mime};base64,${base64}`;
      }

      imageMap.set(filePath, url);
    }
  }

  return resolveImageUrls(doc, imageMap);
}

/**
 * Universal design file loader.
 * Handles .zip packages (extracting documents and images), as well as standalone .pen and .json files.
 */
export async function openDesignFile(file: File): Promise<Document> {
  if (file.name.toLowerCase().endsWith(".zip")) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    return importPenZip(buffer);
  }
  const text = await file.text();
  return parseDocument(text);
}
