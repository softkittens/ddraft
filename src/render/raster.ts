import type { Document, TextNode, PathNode, PolygonNode, IconNode, ImageFill, Fill, ColorStop } from "../model/types";
import type { LayoutNode, Box } from "../layout/types";
import { layoutDocument, flattenLayoutTree } from "../layout/layout";
import { indexDocument } from "../model/tree";
import { resolveVariable } from "../model/variables";
import { paintNode } from "./paint";
import { measureTextNode, resolveFontFamily } from "../layout/text";
import { getLucideIconPath } from "../model/icons";

export interface RasterOptions {
  scale?: number;
  padding?: number;
  background?: string;
}

/**
 * High-performance rasterizer that converts a Pen document or specific frame into a PNG Data URL.
 * Uses OffscreenCanvas/HTMLCanvasElement in browser environments,
 * and built-in PNG rasterization in headless server environments.
 */
export function renderToDataUrl(
  doc: Document,
  targetId?: string,
  opts: RasterOptions = {}
): string {
  const scale = opts.scale ?? 2; // Default 2x for sharp retina rendering
  const pad = opts.padding ?? 0;
  const layoutTree = layoutDocument(doc);
  const nodeMap = indexDocument(doc);

  let targetLayout: LayoutNode | undefined;
  let targetBox: Box;

  if (targetId) {
    const flat = flattenLayoutTree(layoutTree);
    targetLayout = flat.get(targetId);
    if (!targetLayout) targetLayout = layoutTree.find((n) => n.id === targetId);
  }

  if (targetLayout) {
    targetBox = { ...targetLayout.box };
  } else {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (layoutTree.length === 0) {
      targetBox = { x: 0, y: 0, width: 800, height: 600 };
    } else {
      for (const root of layoutTree) {
        if (root.box.x < minX) minX = root.box.x;
        if (root.box.y < minY) minY = root.box.y;
        const r = root.box.x + root.box.width;
        const b = root.box.y + root.box.height;
        if (r > maxX) maxX = r;
        if (b > maxY) maxY = b;
      }
      targetBox = {
        x: minX,
        y: minY,
        width: Math.max(100, maxX - minX),
        height: Math.max(100, maxY - minY)
      };
    }
  }

  const width = Math.ceil(targetBox.width + pad * 2);
  const height = Math.ceil(targetBox.height + pad * 2);
  const canvasWidth = Math.max(1, Math.round(width * scale));
  const canvasHeight = Math.max(1, Math.round(height * scale));

  // 1. Browser OffscreenCanvas or HTML5 Canvas (Primary PNG Producer in Browser)
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        if (opts.background) {
          ctx.fillStyle = opts.background;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }
        ctx.scale(scale, scale);
        ctx.translate(-targetBox.x + pad, -targetBox.y + pad);

        if (targetLayout) {
          paintNode(ctx as unknown as CanvasRenderingContext2D, targetLayout, nodeMap, doc.variables);
        } else {
          for (const root of layoutTree) {
            paintNode(ctx as unknown as CanvasRenderingContext2D, root, nodeMap, doc.variables);
          }
        }

        if (typeof (canvas as any).toDataURL === "function") {
          return (canvas as any).toDataURL("image/png");
        }
      }
    } catch {
      // Fallback
    }
  }

  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        if (opts.background) {
          ctx.fillStyle = opts.background;
          ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }
        ctx.scale(scale, scale);
        ctx.translate(-targetBox.x + pad, -targetBox.y + pad);

        if (targetLayout) {
          paintNode(ctx, targetLayout, nodeMap, doc.variables);
        } else {
          for (const root of layoutTree) {
            paintNode(ctx, root, nodeMap, doc.variables);
          }
        }
        return canvas.toDataURL("image/png");
      }
    } catch {
      // Fallback
    }
  }

  // 2. Headless Server / CLI PNG Producer via software bitmap rasterizer & PNG encoder
  const rasterWidth = Math.min(1920, Math.max(100, Math.round(width)));
  const rasterHeight = Math.min(1920, Math.max(100, Math.round(height)));
  const rgbaBuffer = renderDocToRgba(doc, targetLayout ? [targetLayout] : layoutTree, targetBox, rasterWidth, rasterHeight, opts.background);

  try {
    const pngBuffer = encodePng(rasterWidth, rasterHeight, rgbaBuffer);
    const base64 = pngBuffer.toString("base64");
    return `data:image/png;base64,${base64}`;
  } catch {
    // Fallback to SVG if PNG encoder fails
    const svg = renderToSvg(doc, targetId, { padding: pad, background: opts.background });
    const base64 = typeof Buffer !== "undefined"
      ? Buffer.from(svg).toString("base64")
      : btoa(unescape(encodeURIComponent(svg)));
    return `data:image/svg+xml;base64,${base64}`;
  }
}

/**
 * High-speed software rasterizer for headless Node/Bun environments.
 */
function renderDocToRgba(
  doc: Document,
  roots: LayoutNode[],
  bounds: Box,
  width: number,
  height: number,
  background?: string
): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  const nodeMap = indexDocument(doc);
  const scaleX = width / bounds.width;
  const scaleY = height / bounds.height;

  // Background
  const bgRgba = parseColorToRgba(background || resolveVariable("$bg", doc.variables) || "#0B1117");
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = bgRgba.r;
    buf[i * 4 + 1] = bgRgba.g;
    buf[i * 4 + 2] = bgRgba.b;
    buf[i * 4 + 3] = bgRgba.a;
  }

  function drawRect(rx: number, ry: number, rw: number, rh: number, color: { r: number; g: number; b: number; a: number }) {
    const x0 = Math.max(0, Math.floor((rx - bounds.x) * scaleX));
    const y0 = Math.max(0, Math.floor((ry - bounds.y) * scaleY));
    const x1 = Math.min(width, Math.ceil((rx - bounds.x + rw) * scaleX));
    const y1 = Math.min(height, Math.ceil((ry - bounds.y + rh) * scaleY));

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * width + x) * 4;
        if (color.a === 255) {
          buf[idx] = color.r;
          buf[idx + 1] = color.g;
          buf[idx + 2] = color.b;
          buf[idx + 3] = 255;
        } else {
          const alpha = color.a / 255;
          buf[idx] = Math.round(color.r * alpha + buf[idx] * (1 - alpha));
          buf[idx + 1] = Math.round(color.g * alpha + buf[idx + 1] * (1 - alpha));
          buf[idx + 2] = Math.round(color.b * alpha + buf[idx + 2] * (1 - alpha));
          buf[idx + 3] = 255;
        }
      }
    }
  }

  function rasterNode(node: LayoutNode, absX: number, absY: number) {
    const data = nodeMap.get(node.id);
    if (data?.enabled === false) return;

    const x = absX + node.box.x;
    const y = absY + node.box.y;
    const w = node.box.width;
    const h = node.box.height;

    // Fill
    if (data?.fill) {
      const fillStr = resolveVariable(typeof data.fill === "string" ? data.fill : (data.fill as any).color, doc.variables);
      if (fillStr) {
        const rgba = parseColorToRgba(fillStr);
        drawRect(x, y, w, h, rgba);
      }
    }

    // Children
    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        rasterNode(child, x, y);
      }
    }
  }

  for (const root of roots) {
    rasterNode(root, 0, 0);
  }

  return buf;
}

/**
 * Standard PNG encoder producing valid RFC 2083 PNG binary data.
 */
function encodePng(width: number, height: number, rgbaBuffer: Buffer): Buffer {
  let zlibDeflate: (buf: Buffer) => Buffer;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const zlib = require("zlib");
    zlibDeflate = zlib.deflateSync;
  } catch {
    throw new Error("zlib not available for PNG encoding");
  }

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    crcTable[n] = c;
  }

  function crc32(buf: Buffer, offset: number, length: number): number {
    let c = 0xffffffff;
    for (let i = offset; i < offset + length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function writeChunk(type: string, data: Buffer | null): Buffer {
    const len = data ? data.length : 0;
    const buf = Buffer.alloc(12 + len);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4, 4, "ascii");
    if (data) data.copy(buf, 8);
    const crc = crc32(buf, 4, 4 + len);
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // Deflate
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const rawScanlines = Buffer.alloc(height * (1 + width * 4));
  let srcPos = 0;
  let dstPos = 0;
  for (let y = 0; y < height; y++) {
    rawScanlines[dstPos++] = 0; // Filter: None
    rgbaBuffer.copy(rawScanlines, dstPos, srcPos, srcPos + width * 4);
    dstPos += width * 4;
    srcPos += width * 4;
  }

  const compressed = zlibDeflate(rawScanlines);
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return Buffer.concat([
    header,
    writeChunk("IHDR", ihdr),
    writeChunk("IDAT", compressed),
    writeChunk("IEND", null)
  ]);
}

function parseColorToRgba(colorStr: string): { r: number; g: number; b: number; a: number } {
  if (!colorStr) return { r: 0, g: 0, b: 0, a: 255 };
  if (colorStr.startsWith("#")) {
    const hex = colorStr.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 255
      };
    }
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255
      };
    }
  }
  return { r: 15, g: 23, b: 42, a: 255 };
}

/**
 * Pure TypeScript SVG Renderer for .pen documents.
 */
export function renderToSvg(
  doc: Document,
  targetId?: string,
  opts: { padding?: number; background?: string } = {}
): string {
  const pad = opts.padding ?? 0;
  const layoutTree = layoutDocument(doc);
  const nodeMap = indexDocument(doc);

  let targetLayout: LayoutNode | undefined;
  let targetBox: Box;

  if (targetId) {
    const flat = flattenLayoutTree(layoutTree);
    targetLayout = flat.get(targetId);
    if (!targetLayout) targetLayout = layoutTree.find((n) => n.id === targetId);
  }

  if (targetLayout) {
    targetBox = { ...targetLayout.box };
  } else {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (layoutTree.length === 0) {
      targetBox = { x: 0, y: 0, width: 800, height: 600 };
    } else {
      for (const root of layoutTree) {
        if (root.box.x < minX) minX = root.box.x;
        if (root.box.y < minY) minY = root.box.y;
        const r = root.box.x + root.box.width;
        const b = root.box.y + root.box.height;
        if (r > maxX) maxX = r;
        if (b > maxY) maxY = b;
      }
      targetBox = {
        x: minX,
        y: minY,
        width: Math.max(100, maxX - minX),
        height: Math.max(100, maxY - minY)
      };
    }
  }

  const width = Math.ceil(targetBox.width + pad * 2);
  const height = Math.ceil(targetBox.height + pad * 2);
  const defs: string[] = [];
  let gradientCounter = 0;

  function renderSvgNode(node: LayoutNode, offsetX: number, offsetY: number): string {
    const data = nodeMap.get(node.id);
    if (data?.enabled === false) return "";

    const x = offsetX + node.box.x;
    const y = offsetY + node.box.y;
    const w = node.box.width;
    const h = node.box.height;
    const opacity = data?.opacity !== undefined && data.opacity < 1 ? ` opacity="${data.opacity}"` : "";

    let shapeSvg = "";
    let fillAttr = ' fill="none"';
    if (data?.fill) {
      const fillVal = resolveSvgFill(data.fill, doc.variables, defs, () => `grad_${++gradientCounter}`);
      if (fillVal) fillAttr = ` fill="${escapeXml(fillVal)}"`;
    }

    let strokeAttr = "";
    if (data?.stroke && data?.strokeWidth) {
      const strokeColor = resolveVariable(data.stroke, doc.variables);
      if (strokeColor) {
        strokeAttr = ` stroke="${escapeXml(strokeColor)}" stroke-width="${data.strokeWidth}"`;
      }
    }

    switch (data?.type) {
      case "frame": {
        const radius = data.cornerRadius ? ` rx="${data.cornerRadius}" ry="${data.cornerRadius}"` : "";
        const imgFill = Array.isArray(data?.fill)
          ? (data.fill.find((f: any) => f?.type === "image") as ImageFill | undefined)
          : (data?.fill as any)?.type === "image"
          ? (data.fill as ImageFill)
          : undefined;

        if (imgFill && (imgFill.url || imgFill.data)) {
          const imgHref = escapeXml(imgFill.url || imgFill.data!);
          shapeSvg = `<rect x="${x}" y="${y}" width="${w}" height="${h}"${radius}${fillAttr}${strokeAttr}${opacity} />\n<image href="${imgHref}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"${opacity} />`;
        } else {
          shapeSvg = `<rect x="${x}" y="${y}" width="${w}" height="${h}"${radius}${fillAttr}${strokeAttr}${opacity} />`;
        }
        break;
      }
      case "ellipse": {
        const cx = x + w / 2;
        const cy = y + h / 2;
        shapeSvg = `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}"${fillAttr}${strokeAttr}${opacity} />`;
        break;
      }
      case "text": {
        // The layout engine already wrapped this text; emit the same lines it
        // measured. Emitting node.content as one <text> produced a single long
        // line that ran off the frame, so an exported screen did not match the
        // screen the engine laid out.
        const textNode = data as TextNode;
        const fontSize = textNode.fontSize ?? 14;
        const fontWeight = textNode.fontWeight ? ` font-weight="${textNode.fontWeight}"` : "";
        const family = resolveFontFamily(textNode.fontFamily, doc.variables);
        const fontFamily = ` font-family="${escapeXml(family)}"`;
        const color = resolveVariable(textNode.fill ?? "#000000", doc.variables);
        const metrics = measureTextNode(textNode, w, doc.variables);
        const anchor =
          textNode.textAlign === "center"
            ? ' text-anchor="middle"'
            : textNode.textAlign === "right"
              ? ' text-anchor="end"'
              : "";
        const originX =
          textNode.textAlign === "center" ? x + w / 2 : textNode.textAlign === "right" ? x + w : x;
        shapeSvg = metrics.lines
          .map((line, i) => {
            const baselineY = y + i * metrics.lineHeight + fontSize * 0.82;
            return `<text x="${originX}" y="${baselineY}" font-size="${fontSize}" fill="${escapeXml(color)}"${fontWeight}${fontFamily}${anchor}${opacity}>${escapeXml(line)}</text>`;
          })
          .join("\n");
        break;
      }
      case "path": {
        const pathNode = data as PathNode;
        if (pathNode.geometry) {
          shapeSvg = `<path d="${escapeXml(pathNode.geometry)}" transform="translate(${x}, ${y})"${fillAttr}${strokeAttr}${opacity} />`;
        }
        break;
      }
      case "polygon": {
        const poly = data as PolygonNode;
        const pts = poly.points ?? [];
        const pairs: string[] = [];
        for (let i = 0; i < pts.length; i += 2) {
          pairs.push(`${pts[i] + x},${pts[i + 1] + y}`);
        }
        if (pairs.length > 0) {
          shapeSvg = `<polygon points="${pairs.join(" ")}"${fillAttr}${strokeAttr}${opacity} />`;
        }
        break;
      }
      case "icon": {
        const iconNode = data as IconNode;
        const iconName = iconNode?.icon || iconNode?.name || "sparkles";
        const geom = getLucideIconPath(iconName);
        if (geom) {
          const stroke = resolveVariable(data?.stroke || iconNode?.fill || "$text", doc.variables) || "#FFFFFF";
          const strokeW = data?.strokeWidth || 2;
          shapeSvg = `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 24 24"><path d="${escapeXml(geom)}"${fillAttr} stroke="${escapeXml(stroke)}" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"${opacity} /></svg>`;
        }
        break;
      }
      default:
        break;
    }

    let childrenSvg = "";
    if (node.children && node.children.length > 0) {
      childrenSvg = node.children.map((ch) => renderSvgNode(ch, x, y)).join("\n");
    }

    return `${shapeSvg}\n${childrenSvg}`;
  }

  const bgRect = opts.background ? `<rect width="${width}" height="${height}" fill="${escapeXml(opts.background)}" />\n` : "";
  let bodySvg = "";
  const rootOffsetX = -targetBox.x + pad;
  const rootOffsetY = -targetBox.y + pad;

  if (targetLayout) {
    bodySvg = renderSvgNode(targetLayout, rootOffsetX, rootOffsetY);
  } else {
    bodySvg = layoutTree.map((root) => renderSvgNode(root, rootOffsetX, rootOffsetY)).join("\n");
  }

  const defsSection = defs.length > 0 ? `<defs>\n${defs.join("\n")}\n</defs>\n` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
${defsSection}${bgRect}${bodySvg}
</svg>`;
}

function resolveSvgFill(
  fill: Fill | Fill[] | string | undefined,
  variables: Record<string, any> | undefined,
  defs: string[],
  nextGradId: () => string
): string | null {
  if (!fill) return null;
  if (Array.isArray(fill)) {
    const active = fill.find((f) => typeof f !== "object" || (f as any).enabled !== false) || fill[0];
    return resolveSvgFill(active, variables, defs, nextGradId);
  }
  if (typeof fill === "string") return resolveVariable(fill, variables);
  if (typeof fill === "object") {
    if ((fill as any).enabled === false) return null;
    if (fill.type === "color") return resolveVariable(fill.color, variables);
    if (fill.type === "gradient") {
      const gradId = nextGradId();
      const stops = (fill.stops || []).map((s: ColorStop) => {
        const c = resolveVariable(s.color, variables) || "#000000";
        return `    <stop offset="${(s.offset * 100).toFixed(1)}%" stop-color="${escapeXml(c)}" />`;
      }).join("\n");

      if (fill.gradientType === "radial") {
        defs.push(`<radialGradient id="${gradId}">\n${stops}\n</radialGradient>`);
      } else {
        defs.push(`<linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">\n${stops}\n</linearGradient>`);
      }
      return `url(#${gradId})`;
    }
  }
  return null;
}

function escapeXml(unsafe: string): string {
  if (typeof unsafe !== "string") return String(unsafe ?? "");
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
