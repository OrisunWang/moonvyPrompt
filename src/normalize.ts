import { adaptGenome, isRecord as isGenomeRecord } from "./moonvy-genome.js";
import { basename } from "node:path";
import { extractTokens } from "./tokens.js";
import type { Bounds, LayoutHints, NodeStyle, PipelineWarning, SourceBundle, SpacingRelation, TextStyle, UiNode, UiTreeDocument, UiTreeMeta } from "./types.js";

/** Intermediate flat node used before hierarchy and relative coordinates are finalized. */
interface FlatNode {
  /** Stable source id or generated id. */
  id: string;
  /** Source layer name. */
  name: string;
  /** Normalized node type. */
  type: UiNode["type"];
  /** Absolute bounds in @1x pixels. */
  bounds: Bounds;
  /** Optional source parent id when available. */
  parentId?: string;
  /** Source paint order used as deterministic tie-breaker. */
  zIndex: number;
  /** Optional visual style facts. */
  style?: NodeStyle;
  /** Optional text style facts. */
  text?: TextStyle;
  /** Original children if source hierarchy exists. */
  children: FlatNode[];
  /** Adapter supplies source-backed images; downloader may later replace them with local assets. */
  asset?: UiNode["asset"];
}

/** Converts a fetched or local source bundle into the stable UI tree document. */
export function normalizeToUiTree(bundle: SourceBundle): UiTreeDocument {
  const warnings = [...bundle.warnings];
  if (!bundle.structured) {
    return fallbackPreviewTree(bundle, warnings);
  }

  // Offline Genome imports use the same adapter as network imports; no image is fetched here.
  const structured = isGenomeRecord(bundle.structured) && Array.isArray(bundle.structured.pages)
    ? adaptGenome(bundle.structured, warnings) : bundle.structured;
  const flatInfoNodes = normalizeFlatInfoSource(structured, warnings);
  const sourceRoot = unwrapCommonRoot(structured);
  const tree = flatInfoNodes ? rebuildHierarchy(flatInfoNodes, warnings) : normalizeHierarchicalSource(sourceRoot, warnings);
  const canvas = inferCanvas(tree);
  const meta: UiTreeMeta = {
    sourceUrl: bundle.sourceUrl,
    pageId: bundle.params?.itemId ?? basename(bundle.sourceUrl),
    projectId: bundle.params?.projectId,
    teamId: bundle.params?.teamId,
    sourceType: bundle.sourceType,
    canvas,
    scale: 1,
    generatedAt: new Date().toISOString(),
    confidence: bundle.sourceType === "unknown" ? "low" : warnings.some(warning => warning.severity === "degraded") ? "medium" : "high"
  };
  // Match stable source ids rather than names, which can repeat or differ from exported slice bounds.
  const assetsByNode = new Map(bundle.assets?.map((asset) => [asset.nodeId, asset]));
  /** Attaches downloaded slice references without changing geometry or source hierarchy. */
  function attachAssets(node: UiNode): void {
    const asset = assetsByNode.get(node.id);
    if (asset) node.asset = { source: asset.source, localPath: asset.localPath, archivePath: asset.archivePath, role: asset.role };
    node.children.forEach(attachAssets);
  }
  attachAssets(tree);
  applyLayoutHints(tree);
  return { meta, tokens: extractTokens(tree), tree, assets: bundle.assets, warnings };
}

/** Normalizes ordinary nested source objects that expose children/layers directly. */
function normalizeHierarchicalSource(sourceRoot: unknown, warnings: PipelineWarning[]): UiNode {
  const flatRoot = normalizeStructuredNode(sourceRoot, undefined, 0, warnings);
  return flatRoot.children.length > 0 ? finalizeFromExistingHierarchy(flatRoot) : rebuildHierarchy([flatRoot], warnings);
}

/** Converts a local fixture JSON object into a source bundle suitable for testing. */
export function fixtureBundle(path: string, source: unknown): SourceBundle {
  return { sourceUrl: path, structured: source, sourceType: "fixture", files: [], warnings: [] };
}

/** Creates a low-confidence tree when only a preview image or empty source exists. */
function fallbackPreviewTree(bundle: SourceBundle, warnings: PipelineWarning[]): UiTreeDocument {
  const width = bundle.preview?.width ?? 0;
  const height = bundle.preview?.height ?? 0;
  const bounds: Bounds = { x: 0, y: 0, width, height };
  const image: UiNode = {
    id: "preview-image",
    name: "Preview Image",
    type: "image",
    bounds,
    relative: bounds,
    asset: bundle.preview,
    children: []
  };
  const root: UiNode = {
    id: "root",
    name: "Moonvy Preview Fallback",
    type: "frame",
    bounds,
    relative: bounds,
    layoutHints: { direction: "absolute", positioning: "absolute" },
    children: bundle.preview ? [image] : []
  };
  warnings.push({
    code: "LOW_CONFIDENCE_SCREENSHOT_TREE",
    severity: "degraded",
    message: "Generated a low-confidence tree because structured Moonvy data was unavailable.",
    hint: "Use the screenshot as visual reference and avoid treating missing colors, radius, and typography as confirmed facts."
  });
  return {
    meta: {
      sourceUrl: bundle.sourceUrl,
      pageId: bundle.params?.itemId ?? basename(bundle.sourceUrl),
      projectId: bundle.params?.projectId,
      teamId: bundle.params?.teamId,
      sourceType: "preview-image",
      canvas: { width, height },
      scale: 1,
      generatedAt: new Date().toISOString(),
      confidence: "low"
    },
    assets: bundle.assets,
    tokens: extractTokens(root),
    tree: root,
    warnings
  };
}

/** Handles common adapter and compatible fixture wrapping shapes before node normalization starts. */
function unwrapCommonRoot(source: unknown): unknown {
  if (!isRecord(source)) {
    return source;
  }
  return source.root ?? source.document ?? source.schema ?? source.node ?? source.data ?? source;
}

/** Normalizes compatible Sketch JSON exports whose real design nodes live in a flat `info[]` array. */
function normalizeFlatInfoSource(source: unknown, warnings: PipelineWarning[]): FlatNode[] | undefined {
  if (!isRecord(source) || !Array.isArray(source.info) || source.info.length === 0) {
    return undefined;
  }
  const visibleNodes = source.info.filter((node) => isRecord(node) && node.isVisible !== false);
  const flatNodes = visibleNodes.map((node, index) => normalizeStructuredNode(node, undefined, index, warnings));
  warnings.push({
    code: "COMPATIBLE_INFO_ARRAY_NORMALIZED",
    severity: "notice",
    message: `Normalized ${flatNodes.length} nodes from compatible design-document info[].`,
    hint: "This source is a flat Sketch-style export, so hierarchy is rebuilt from parentID and geometry."
  });
  return flatNodes;
}

/** Recursively normalizes a source node and preserves hierarchy when source children exist. */
function normalizeStructuredNode(source: unknown, parentId: string | undefined, zIndex: number, warnings: PipelineWarning[]): FlatNode {
  const record = isRecord(source) ? source : {};
  const id = stringField(record, ["id", "objectID", "guid", "uuid"]) ?? `node-${zIndex}`;
  const name = stringField(record, ["name", "title", "label"]) ?? id;
  const bounds = extractBounds(record, warnings, id);
  const type = inferNodeType(record, name);
  const node: FlatNode = {
    id,
    name,
    type,
    bounds,
    parentId: stringField(record, ["parentId", "parent_id", "parentID", "parent"]),
    zIndex,
    style: extractStyle(record),
    text: type === "text" ? extractText(record) : undefined,
    children: [],
    asset: isRecord(record.image) && typeof record.image.imageUrl === "string" ? { source: record.image.imageUrl, role: "image" } : undefined
  };
  const sourceChildren = arrayField(record, ["children", "layers", "nodes", "items"]);
  node.children = sourceChildren.map((child, index) => normalizeStructuredNode(child, id, index, warnings));
  return node;
}

/** Converts source hierarchy into final nodes while computing parent-relative bounds. */
function finalizeFromExistingHierarchy(node: FlatNode, parent?: UiNode): UiNode {
  const uiNode = flatToUiNode(node, parent);
  uiNode.children = node.children.map((child) => finalizeFromExistingHierarchy(child, uiNode));
  return uiNode;
}

/** Reconstructs hierarchy for flat sources using smallest containing rectangle as parent. */
export function rebuildHierarchy(flatNodes: FlatNode[], warnings: PipelineWarning[]): UiNode {
  const nodes = flatNodes.slice().sort((a, b) => area(b.bounds) - area(a.bounds) || a.zIndex - b.zIndex);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const rootFlat = nodes.find((node) => !node.parentId || !nodesById.has(node.parentId) || /artboard|frame/i.test(node.type)) ?? nodes[0];
  const childrenById = new Map<string, FlatNode[]>();
  for (const child of nodes.filter((node) => node.id !== rootFlat.id)) {
    const sourceParent = child.parentId ? nodesById.get(child.parentId) : undefined;
    const parent = sourceParent && sourceParent.id !== child.id ? sourceParent : nodes
      .filter((candidate) => candidate.id !== child.id && candidate.id !== child.parentId && contains(candidate.bounds, child.bounds))
      .sort((a, b) => area(a.bounds) - area(b.bounds))[0] ?? rootFlat;
    const siblings = childrenById.get(parent.id) ?? [];
    siblings.push(child);
    childrenById.set(parent.id, siblings);
  }
  warnings.push({
    code: "HIERARCHY_INFERRED",
    severity: "notice",
    message: "Parent-child hierarchy was inferred from rectangle containment.",
    hint: "Review nested groups if the source was a flat annotation export."
  });

  const build = (flat: FlatNode, parent?: UiNode): UiNode => {
    const uiNode = flatToUiNode(flat, parent);
    uiNode.children = (childrenById.get(flat.id) ?? []).sort((a, b) => a.zIndex - b.zIndex).map((child) => build(child, uiNode));
    return uiNode;
  };
  return build(rootFlat);
}

/** Adds layout hints to every node that has multiple children. */
export function applyLayoutHints(node: UiNode): void {
  if (node.children.length > 0) {
    node.layoutHints = inferLayoutHints(node.bounds, node.children.map((child) => child.bounds));
    if (node.layoutHints.gap !== undefined) {
      node.layoutHints.gapUsage = node.children.some(containsTextNode) ? "reference-only" : "layout-spacing";
    }
    const childSpacing = inferSiblingSpacing(node.children);
    if (childSpacing.length > 0) {
      node.layoutHints.childSpacing = childSpacing;
    }
    for (const child of node.children) {
      applyLayoutHints(child);
    }
  }
}

/**
 * Finds the nearest non-overlapping sibling to the right and below each child.
 * Cross-axis overlap keeps the measurement local to a visual row or column,
 * while parent-sized background layers naturally fall out of the candidates.
 */
export function inferSiblingSpacing(children: UiNode[]): SpacingRelation[] {
  const relations: SpacingRelation[] = [];
  for (const axis of ["horizontal", "vertical"] as const) {
    for (const from of children) {
      const candidates = children
        .filter((to) => to.id !== from.id)
        .map((to) => ({ to, gap: directionalGap(from.bounds, to.bounds, axis) }))
        .filter((candidate): candidate is { to: UiNode; gap: number } => candidate.gap !== undefined)
        .sort((a, b) => a.gap - b.gap || a.to.id.localeCompare(b.to.id));
      const nearest = candidates[0];
      if (nearest) {
        const sourceEdgeGap = roundGeometry(nearest.gap);
        relations.push({
          axis,
          fromNodeId: from.id,
          toNodeId: nearest.to.id,
          sourceEdgeGap,
          referenceAnchorDelta: leadingEdgeDelta(from.bounds, nearest.to.bounds, axis),
          anchor: "leading-edge",
          usage: containsTextNode(from) || containsTextNode(nearest.to) ? "reference-only" : "layout-spacing"
        });
      }
    }
  }
  return relations;
}

/** Infers sibling direction, gap, padding, and basic alignment from absolute bounds. */
export function inferLayoutHints(parent: Bounds, children: Bounds[]): LayoutHints {
  if (children.length < 2) {
    return { direction: "absolute", positioning: "absolute" };
  }
  const sortedByX = children.slice().sort((a, b) => a.x - b.x);
  const sortedByY = children.slice().sort((a, b) => a.y - b.y);
  const rowLike = sortedByX.every((child, index) => index === 0 || child.x >= sortedByX[index - 1].x + sortedByX[index - 1].width);
  const columnLike = sortedByY.every((child, index) => index === 0 || child.y >= sortedByY[index - 1].y + sortedByY[index - 1].height);
  const direction: LayoutHints["direction"] = rowLike ? "row" : columnLike ? "column" : hasOverlap(children) ? "overlap" : "absolute";
  const ordered = direction === "row" ? sortedByX : direction === "column" ? sortedByY : [];
  const gaps = ordered.slice(1).map((child, index) => direction === "row" ? child.x - (ordered[index].x + ordered[index].width) : child.y - (ordered[index].y + ordered[index].height));
  const union = unionBounds(children);
  return {
    direction,
    gap: gaps.length > 0 ? median(gaps) : undefined,
    padding: {
      top: union.y - parent.y,
      right: parent.x + parent.width - (union.x + union.width),
      bottom: parent.y + parent.height - (union.y + union.height),
      left: union.x - parent.x
    },
    alignment: inferAlignment(parent, children, direction),
    positioning: direction === "row" || direction === "column" ? "flow-inferred" : "absolute"
  };
}

/** Converts a flat intermediate node into the public UI node shape. */
function flatToUiNode(node: FlatNode, parent?: UiNode): UiNode {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    bounds: node.bounds,
    relative: parent ? { ...node.bounds, x: node.bounds.x - parent.bounds.x, y: node.bounds.y - parent.bounds.y } : { ...node.bounds },
    style: emptyObjectToUndefined(node.style),
    text: node.text,
    asset: node.asset,
    children: []
  };
}

/** Extracts bounds from several common design JSON shapes. */
function extractBounds(record: Record<string, unknown>, warnings: PipelineWarning[], id: string): Bounds {
  const frame = record.frame && isRecord(record.frame) ? record.frame : record;
  const x = numberField(frame, ["x", "left", "absoluteX"]) ?? numberField(record, ["x", "left", "absoluteX"]) ?? 0;
  const y = numberField(frame, ["y", "top", "absoluteY"]) ?? numberField(record, ["y", "top", "absoluteY"]) ?? 0;
  const width = numberField(frame, ["width", "w"]) ?? numberField(record, ["width", "w"]) ?? 0;
  const height = numberField(frame, ["height", "h"]) ?? numberField(record, ["height", "h"]) ?? 0;
  if (width === 0 || height === 0) {
    warnings.push({ code: "NODE_BOUNDS_INCOMPLETE", severity: "notice", message: `Node ${id} has incomplete bounds and was normalized with zero values.` });
  }
  return { x, y, width, height };
}

/** Extracts visual styles from common Moonvy/DDS/Sketch-like field names. */
function extractStyle(record: Record<string, unknown>): NodeStyle {
  const radius = radiusFromSource(record);
  const rawOpacity = numberField(record, ["opacity"]);
  const opacity = rawOpacity && rawOpacity > 1 ? rawOpacity / 100 : rawOpacity;
  const fill = stringField(record, ["fill", "backgroundColor", "bgColor", "color"]) ?? fillFromPaintArray(record.fills);
  const strokeColor = stringField(record, ["stroke", "borderColor", "strokeColor"]) ?? colorFromPaintArray(record.borders);
  const shadow = stringField(record, ["boxShadow", "shadow"]);
  const shadows = shadow ? [{ x: 0, y: 0, blur: 0, spread: 0, color: shadow }] : shadowsFromSource(record.shadow);
  return {
    fill,
    opacity,
    radius,
    stroke: strokeColor ? { color: strokeColor, width: numberField(record, ["strokeWidth", "borderWidth"]) ?? 1, style: "solid" } : undefined,
    shadow: shadows,
    blur: numberField(record, ["blur", "blurRadius"])
  };
}

/** Normalizes scalar, one-value, and four-corner radius encodings used by Moonvy exports. */
function radiusFromSource(record: Record<string, unknown>): NodeStyle["radius"] {
  const scalar = numberField(record, ["cornerRadius", "borderRadius"]);
  if (scalar !== undefined) {
    return scalar;
  }
  const rawRadius = record.radius;
  const numericRadius = numericValue(rawRadius);
  if (numericRadius !== undefined) {
    return numericRadius;
  }
  if (!Array.isArray(rawRadius)) {
    return undefined;
  }
  const values = rawRadius.map(numericValue).filter((value): value is number => value !== undefined);
  if (values.length === 1) {
    return values[0];
  }
  if (values.length >= 4) {
    return [values[0], values[1], values[2], values[3]];
  }
  return undefined;
}

/** Extracts text content and typography from common design fields. */
function extractText(record: Record<string, unknown>): TextStyle {
  const font = isRecord(record.font) ? record.font : undefined;
  const firstStyle = font && Array.isArray(font.styles) && isRecord(font.styles[0]) ? font.styles[0] : undefined;
  return {
    content: stringField(record, ["text", "characters", "content", "value"]) ?? stringField(firstStyle ?? {}, ["content"]) ?? stringField(record, ["name"]) ?? "",
    fontFamily: stringField(record, ["fontFamily"]) ?? stringField(firstStyle ?? {}, ["displayName", "fontFamily"]),
    fontSize: numberField(record, ["fontSize", "size"]) ?? numberField(font ?? {}, ["size"]) ?? numberField(firstStyle ?? {}, ["size"]),
    fontWeight: numberField(record, ["fontWeight", "weight"]) ?? numberField(firstStyle ?? {}, ["fontWeight", "weight"]) ?? stringField(record, ["fontWeight", "weight"]),
    lineHeight: numberField(record, ["lineHeight"]) ?? numberField(font ?? {}, ["line"]) ?? numberField(firstStyle ?? {}, ["line", "minimumLineHeight"]) ?? stringField(record, ["lineHeight"]),
    color: stringField(record, ["textColor", "color", "fill"]) ?? colorFromSource(firstStyle?.color),
    align: stringField(record, ["textAlign", "align"]) ?? stringField(font ?? {}, ["align"]),
    layout: { sizing: "intrinsic", boundsRole: "reference", overflow: "reflow" }
  };
}

/** Extracts the first enabled solid paint color from Moonvy border arrays. */
function colorFromPaintArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const paint = value.find((item) => isRecord(item) && item.isEnabled !== false);
  if (!isRecord(paint)) {
    return undefined;
  }
  return colorFromSource(paint.color) ?? stringField(paint, ["value", "color"]);
}

/** Extracts the first enabled solid or gradient paint from a Moonvy fill array. */
function fillFromPaintArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const paint = value.find((item) => isRecord(item) && item.isEnabled !== false);
  if (!isRecord(paint)) {
    return undefined;
  }
  const gradient = gradientFromPaint(paint);
  return gradient ?? colorFromSource(paint.color) ?? stringField(paint, ["value", "color"]);
}

/** Converts a Moonvy gradient paint into a deterministic CSS-compatible gradient string. */
function gradientFromPaint(paint: Record<string, unknown>): string | undefined {
  const gradient = isRecord(paint.gradient) ? paint.gradient : undefined;
  if (!gradient || !Array.isArray(gradient.colorStops)) {
    return undefined;
  }
  const stops = gradient.colorStops
    .filter(isRecord)
    .map((stop) => {
      const color = colorFromSource(stop.color);
      const position = numberField(stop, ["position", "offset"]);
      if (!color) {
        return undefined;
      }
      return position === undefined ? color : `${color} ${roundGeometry(position * 100)}%`;
    })
    .filter((stop): stop is string => stop !== undefined);
  if (stops.length === 0) {
    return undefined;
  }

  const rawType = String(gradient.type ?? paint.type ?? "linear").toLowerCase();
  if (rawType.includes("radial")) {
    return `radial-gradient(circle, ${stops.join(", ")})`;
  }
  if (rawType.includes("angular") || rawType.includes("conic")) {
    return `conic-gradient(${stops.join(", ")})`;
  }
  return `linear-gradient(${gradientAngle(gradient)}deg, ${stops.join(", ")})`;
}

/** Calculates a CSS gradient angle from Moonvy's normalized start and end points. */
function gradientAngle(gradient: Record<string, unknown>): number {
  const from = isRecord(gradient.from) ? gradient.from : {};
  const to = isRecord(gradient.to) ? gradient.to : {};
  const deltaX = (numberField(to, ["x"]) ?? 0.5) - (numberField(from, ["x"]) ?? 0.5);
  const deltaY = (numberField(to, ["y"]) ?? 1) - (numberField(from, ["y"]) ?? 0);
  const degrees = Math.atan2(deltaY, deltaX) * 180 / Math.PI + 90;
  return roundGeometry((degrees + 360) % 360);
}

/** Converts Moonvy color objects into their CSS-compatible value string. */
function colorFromSource(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.value === "string") {
    return value.value;
  }
  const r = numberField(value, ["r"]);
  const g = numberField(value, ["g"]);
  const b = numberField(value, ["b"]);
  const a = numberField(value, ["a"]);
  if (r !== undefined && g !== undefined && b !== undefined) {
    return `rgba(${r},${g},${b},${a ?? 1})`;
  }
  return undefined;
}

/** Converts Moonvy shadow arrays into normalized shadow objects. */
function shadowsFromSource(value: unknown): NodeStyle["shadow"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const shadows = value
    .filter((item) => isRecord(item) && item.isEnabled !== false)
    .map((item) => ({
      x: numberField(item, ["offsetX", "x"]) ?? 0,
      y: numberField(item, ["offsetY", "y"]) ?? 0,
      blur: numberField(item, ["blurRadius", "blur"]) ?? 0,
      spread: numberField(item, ["spread", "spreadRadius"]) ?? 0,
      color: colorFromSource(item.color) ?? "rgba(0,0,0,0)"
    }));
  return shadows.length > 0 ? shadows : undefined;
}

/** Infers the public node type from source type, name, and available properties. */
function inferNodeType(record: Record<string, unknown>, name: string): UiNode["type"] {
  const rawType = String(record.type ?? record.nodeType ?? record.class ?? "").toLowerCase();
  const ddsType = String(record.ddsType ?? "").toLowerCase();
  // Optional adapter fields may exist with undefined values; only actual text values imply a text node.
  if (rawType.includes("text") || typeof record.text === "string" || typeof record.characters === "string") return "text";
  if (rawType.includes("image") || rawType.includes("bitmap") || ddsType.includes("image") || /(image|photo|img|banner)/i.test(name)) return "image";
  if (rawType.includes("icon") || /icon/i.test(name)) return "icon";
  if (rawType.includes("frame") || rawType.includes("artboard") || rawType.includes("page") || ddsType.includes("artboard")) return "frame";
  if (rawType.includes("group") || ddsType.includes("group") || Array.isArray(record.children) || Array.isArray(record.layers)) return "group";
  if (ddsType.includes("rectangle") || ddsType.includes("shape") || "fill" in record || "backgroundColor" in record || "cornerRadius" in record || "fills" in record) return "shape";
  return "unknown";
}

/** Infers canvas dimensions from the root bounds. */
function inferCanvas(root: UiNode): { width: number; height: number } {
  return { width: root.bounds.width, height: root.bounds.height };
}

/** Returns true when outer fully contains inner. */
function contains(outer: Bounds, inner: Bounds): boolean {
  return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
}

/** Computes rectangle area for hierarchy parent selection. */
function area(bounds: Bounds): number {
  return bounds.width * bounds.height;
}

/** Checks whether any sibling rectangles overlap. */
function hasOverlap(children: Bounds[]): boolean {
  return children.some((a, index) => children.slice(index + 1).some((b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y));
}

/** Computes the bounding box around child rectangles. */
function unionBounds(children: Bounds[]): Bounds {
  const left = Math.min(...children.map((child) => child.x));
  const top = Math.min(...children.map((child) => child.y));
  const right = Math.max(...children.map((child) => child.x + child.width));
  const bottom = Math.max(...children.map((child) => child.y + child.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Computes median for gap values and rounds to two decimals. */
function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const result = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(result * 100) / 100;
}

/** Infers simple cross-axis alignment from child edges and centers. */
function inferAlignment(parent: Bounds, children: Bounds[], direction: LayoutHints["direction"]): LayoutHints["alignment"] {
  const axisValues = children.map((child) => direction === "row" ? child.y : child.x);
  const centers = children.map((child) => direction === "row" ? child.y + child.height / 2 : child.x + child.width / 2);
  const parentStart = direction === "row" ? parent.y : parent.x;
  const parentCenter = direction === "row" ? parent.y + parent.height / 2 : parent.x + parent.width / 2;
  if (axisValues.every((value) => Math.abs(value - parentStart) <= 2)) return "start";
  if (centers.every((value) => Math.abs(value - parentCenter) <= 2)) return "center";
  return "mixed";
}

/** Returns a non-negative directional gap when two boxes overlap on the cross axis. */
function directionalGap(from: Bounds, to: Bounds, axis: SpacingRelation["axis"]): number | undefined {
  if (axis === "horizontal") {
    const crossOverlap = Math.min(from.y + from.height, to.y + to.height) - Math.max(from.y, to.y);
    const gap = to.x - (from.x + from.width);
    return crossOverlap > 0 && gap >= 0 ? gap : undefined;
  }
  const crossOverlap = Math.min(from.x + from.width, to.x + to.width) - Math.max(from.x, to.x);
  const gap = to.y - (from.y + from.height);
  return crossOverlap > 0 && gap >= 0 ? gap : undefined;
}

/** Computes source leading-edge distance so runtime text height cannot distort the reference placement. */
function leadingEdgeDelta(from: Bounds, to: Bounds, axis: SpacingRelation["axis"]): number {
  return roundGeometry(axis === "horizontal" ? to.x - from.x : to.y - from.y);
}

/** Detects direct or nested text so geometry involving text is never advertised as safe stack spacing. */
function containsTextNode(node: UiNode): boolean {
  return node.type === "text" || node.children.some(containsTextNode);
}

/** Rounds derived geometry so floating-point export noise does not leak into the public contract. */
function roundGeometry(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Reads a string field from an object using a list of fallback keys. */
function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

/** Reads a number field from an object using a list of fallback keys. */
function numberField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

/** Converts one scalar source value into a finite number when possible. */
function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

/** Reads an array field from an object using a list of fallback keys. */
function arrayField(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

/** Drops empty style objects so missing facts stay missing in JSON output. */
function emptyObjectToUndefined<T extends object>(value: T | undefined): T | undefined {
  return value && Object.values(value).some((entry) => entry !== undefined) ? value : undefined;
}

/** Type guard for object records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
